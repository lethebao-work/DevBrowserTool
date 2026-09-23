/**
 * Action Primitives — Đặc tả Mục 6
 *
 * Định nghĩa interface và base implementation cho các action primitive.
 * Phase 0: navigate, click, fill, call_api, extract.
 * Click/Fill đi qua locator 5-tier (Mục 6.1): Accessibility Tree → JS-query → ...
 *
 * Mọi action PHẢI có field `on_failure` tường minh (Mục 6.2).
 * KHÔNG được có hành vi mặc định ẩn trong engine.
 */

import type { OnFailure, ResourceNode, Variant } from '../map/schema.js';
import { locateElement, normalizeFormulaToJs } from '../locator/index.js';
import { WaitForAction, BranchAction, LoopAction, CallLlmAction } from './advanced.js';
import { PatchRuntimeAction, DeepScanLocalAction, ClickCoordinateAction } from './phase3-primitives.js';

// ============================================================================
// EXECUTION CONTEXT — Ngữ cảnh thực thi chung cho mọi action
// ============================================================================

/**
 * Interface cho browser adapter — abstract layer trên CDP/Playwright/MCP.
 * Cho phép đổi implementation mà không ảnh hưởng action logic.
 */
export interface BrowserAdapter {
  /**
   * Thực thi JavaScript trong context của trang.
   * Tương đương CDP Runtime.evaluate
   */
  evaluate<T = unknown>(expression: string): Promise<T>;

  /**
   * Điều hướng tới URL.
   */
  navigate(url: string): Promise<void>;

  /**
   * Chờ điều kiện.
   * @param condition - Biểu thức JS trả về boolean
   * @param timeoutMs - Timeout tính bằng ms
   */
  waitFor(condition: string, timeoutMs?: number): Promise<boolean>;

  /**
   * Chụp screenshot (dùng cho debug/log).
   */
  screenshot(): Promise<Buffer>;

  /**
   * Lấy URL hiện tại.
   */
  currentUrl(): Promise<string>;

  /**
   * Alias lấy URL hiện tại (tương thích các module discovery).
   */
  getUrl?(): Promise<string>;

  /**
   * Lấy title hiện tại.
   */
  currentTitle(): Promise<string>;
}

/**
 * Ngữ cảnh thực thi — truyền vào mỗi action.
 */
export interface ActionContext {
  /** Browser adapter */
  browser: BrowserAdapter;

  /** Node liên quan từ Map (nếu có) */
  node: ResourceNode | null;

  /** Variant đang thử (đã sắp xếp theo priority) */
  currentVariant: Variant | null;

  /** Tham số runtime */
  params: Record<string, unknown>;
}

// ============================================================================
// ACTION RESULT
// ============================================================================

export interface ActionResult {
  /** Thành công hay thất bại */
  success: boolean;

  /** Dữ liệu trả về (nếu có) */
  data?: unknown;

  /** Thông báo lỗi (nếu thất bại) */
  error?: string;

  /** Variant ID đã dùng (nếu có) */
  used_variant_id?: string;

  /** Có phải dùng fallback variant không */
  used_fallback: boolean;

  /** Thời gian thực thi (ms) */
  duration_ms: number;
}

// ============================================================================
// ACTION INTERFACE
// ============================================================================

export interface ActionPrimitive {
  /** Loại action */
  readonly type: string;

  /**
   * Thực thi action.
   * @returns ActionResult — luôn trả về kết quả, KHÔNG throw exception cho business logic.
   */
  execute(ctx: ActionContext): Promise<ActionResult>;
}

// ============================================================================
// NAVIGATE ACTION
// ============================================================================

export class NavigateAction implements ActionPrimitive {
  readonly type = 'navigate';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const url = ctx.params['url'] as string;

    if (!url) {
      return {
        success: false,
        error: 'Missing required param: url',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    try {
      await ctx.browser.navigate(url);
      return {
        success: true,
        data: { url },
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }
  }
}

// ============================================================================
// CLICK ACTION — 5-tier locator (Mục 6.1)
// ============================================================================

export class ClickAction implements ActionPrimitive {
  readonly type = 'click';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();

    if (!ctx.currentVariant) {
      return {
        success: false,
        error: 'No variant available for click action',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    try {
      // Bước 1: Định vị phần tử qua locator 5-tier (Mục 6.1)
      // Tier 1 (Accessibility Tree) ưu tiên nếu có node.intent
      // Tier 2 (JS-query) dùng variant.value_formula làm fallback
      const locateResult = await locateElement(ctx.browser, {
        intent: ctx.node?.intent,
        formula: ctx.currentVariant.value_formula,
        skipTiers: [4, 5], // Mục 7 bước 5: Khi chạy variant cụ thể, chỉ dùng Tier 1-3. Tier 4 Fuzzy Heal chỉ gọi ở engine fallback sau khi thử hết variants
        allowElevation: ctx.node?.requires_elevation || Boolean(ctx.params?.['allow_elevation']),
      });

      if (!locateResult.found) {
        return {
          success: false,
          error: `Element not found by any tier. Last: ${locateResult.description}`,
          used_variant_id: ctx.currentVariant.id,
          used_fallback: false,
          duration_ms: Date.now() - start,
          data: { locator_tier: locateResult.tier, locator_tier_name: locateResult.tierName },
        };
      }

      // Bước 2: Click phần tử đã tìm được
      // Dùng cách tìm phù hợp với tier đã match
      let clickFormula: string;
      if (locateResult.tier === 1) {
        clickFormula = this.buildAccessibilityClickFormula(ctx.node?.intent ?? '', locateResult.value);
      } else if (locateResult.tier === 3) {
        clickFormula = this.buildShadowClickFormula(ctx.currentVariant.value_formula);
      } else {
        clickFormula = normalizeFormulaToJs(ctx.currentVariant.value_formula);
      }

      const clicked = await ctx.browser.evaluate<boolean>(`
        (() => {
          try {
            const el = ${clickFormula};
            if (!el) return false;
            el.click();
            return true;
          } catch {
            return false;
          }
        })()
      `);

      if (!clicked) {
        return {
          success: false,
          error: `Element found by ${locateResult.tierName} but click failed`,
          used_variant_id: ctx.currentVariant.id,
          used_fallback: locateResult.tier > 1,
          duration_ms: Date.now() - start,
        };
      }

      return {
        success: true,
        used_variant_id: ctx.currentVariant.id,
        used_fallback: locateResult.tier > 1,
        duration_ms: Date.now() - start,
        data: { locator_tier: locateResult.tier, locator_tier_name: locateResult.tierName },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        used_variant_id: ctx.currentVariant?.id,
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }
  }

  /**
   * Xây dựng formula click dựa trên kết quả Accessibility Tree.
   * Dùng role/name/aria-label để tái tìm element khi click.
   */
  private buildAccessibilityClickFormula(
    intent: string,
    locateValue: unknown,
  ): string {
    const result = locateValue as { role?: string; name?: string } | undefined;
    const nameStr = JSON.stringify(result?.name ?? '');
    const roleStr = JSON.stringify(result?.role ?? '');
    const intentStr = JSON.stringify(intent.toLowerCase());

    return `(() => {
      const name = ${nameStr};
      const role = ${roleStr};
      // 1. Match aria-label trực tiếp
      if (name) {
        const elByAria = document.querySelector('[aria-label=' + JSON.stringify(name) + ']');
        if (elByAria) return elByAria;
      }
      // 2. Match role + text
      const roleSelector = role
        ? '[role=' + JSON.stringify(role) + ']' + (role === 'button' ? ', button' : role === 'link' ? ', a[href]' : '')
        : 'button, a[href], [role]';
      const candidates = Array.from(document.querySelectorAll(roleSelector));
      if (name) {
        const byText = candidates.find(el => (el.textContent || '').trim().toLowerCase() === name.toLowerCase());
        if (byText) return byText;
      }
      // 3. Fallback theo intent trong text/aria-label
      const intent = ${intentStr};
      return Array.from(document.querySelectorAll('button, a[href], [role], [aria-label]')).find(el => {
        const text = (el.textContent || '').toLowerCase();
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        return (text && text.includes(intent)) || (label && label.includes(intent));
      }) || null;
    })()`;
  }

  /**
   * Xây dựng formula click duyệt xuyên qua Shadow DOM (cả Open và Closed) cho Tier 3.
   */
  private buildShadowClickFormula(selector: string): string {
    let cleanSel = selector;
    if (cleanSel.includes('document.querySelector(')) {
      const m = cleanSel.match(/document\.querySelector\(["'](.*?)["']\)/);
      if (m) cleanSel = m[1];
    }
    const selStr = JSON.stringify(cleanSel);

    return `(() => {
      function findInShadow(root, sel) {
        if (!root) return null;
        try {
          if (root.querySelector) {
            const found = root.querySelector(sel);
            if (found) return found;
          }
        } catch {}
        const all = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
        for (const el of all) {
          if (el.shadowRoot) {
            const found = findInShadow(el.shadowRoot, sel);
            if (found) return found;
          }
          const closed = el._closedShadowRoot || 
            (window.__closedShadowRoots__ && window.__closedShadowRoots__.get && window.__closedShadowRoots__.get(el));
          if (closed) {
            const found = findInShadow(closed, sel);
            if (found) return found;
          }
        }
        return null;
      }
      return findInShadow(document, ${selStr});
    })()`;
  }
}

// ============================================================================
// FILL ACTION — locator 5-tier + value + prototype setter fallback (Mục 6.1, 6.2)
// ============================================================================

export class FillAction implements ActionPrimitive {
  readonly type = 'fill';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const value = ctx.params['value'] as string;

    if (value === undefined || value === null) {
      return {
        success: false,
        error: 'Missing required param: value',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    if (!ctx.currentVariant) {
      return {
        success: false,
        error: 'No variant available for fill action',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    try {
      // Bước 1: Định vị input qua locator 5-tier (Mục 6.1)
      const locateResult = await locateElement(ctx.browser, {
        intent: ctx.node?.intent,
        formula: ctx.currentVariant.value_formula,
        skipTiers: [4, 5], // Mục 7 bước 5: Thử hết các variants trước khi tới Fuzzy Local-Heal
        allowElevation: ctx.node?.requires_elevation || Boolean(ctx.params?.['allow_elevation']),
      });

      if (!locateResult.found) {
        return {
          success: false,
          error: `Input not found by any tier. Last: ${locateResult.description}`,
          used_variant_id: ctx.currentVariant.id,
          used_fallback: false,
          duration_ms: Date.now() - start,
          data: { locator_tier: locateResult.tier, locator_tier_name: locateResult.tierName },
        };
      }

      // Bước 2: Fill giá trị — dùng formula phù hợp với tier đã match
      // Giữ nguyên variant.value_formula cho Tier 2 (JS-query)
      // Xây formula accessibility-based cho Tier 1
      const fillFormula = locateResult.tier === 1
        ? this.buildAccessibilityFillFormula(ctx.node?.intent ?? '', locateResult.value)
        : normalizeFormulaToJs(ctx.currentVariant.value_formula);

      const escapedValue = JSON.stringify(value);

      // Mục 6.2: PHẢI tự dò — thử gán .value trực tiếp → đọc lại → nếu không đổi,
      // PHẢI chuyển sang prototype setter (React/framework controlled inputs)
      const result = await ctx.browser.evaluate<{ success: boolean; method: string }>(`
        (() => {
          const el = ${fillFormula};
          if (!el) return { success: false, method: 'not_found' };
          
          const targetValue = ${escapedValue};
          
          // Phương pháp 1: Gán .value trực tiếp
          el.value = targetValue;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Đọc lại xác nhận
          if (el.value === targetValue) {
            return { success: true, method: 'direct_value' };
          }
          
          // Phương pháp 2: Prototype setter (React/framework controlled)
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
          )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          )?.set;
          
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, targetValue);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            
            if (el.value === targetValue) {
              return { success: true, method: 'prototype_setter' };
            }
          }
          
          return { success: false, method: 'both_failed' };
        })()
      `);

      const tierFallback = locateResult.tier > 1;
      const methodFallback = result.method === 'prototype_setter';

      return {
        success: result.success,
        data: { method: result.method, locator_tier: locateResult.tier, locator_tier_name: locateResult.tierName },
        error: result.success ? undefined : `Fill failed with method: ${result.method}`,
        used_variant_id: ctx.currentVariant.id,
        used_fallback: tierFallback || methodFallback,
        duration_ms: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        used_variant_id: ctx.currentVariant?.id,
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }
  }

  /**
   * Xây formula tìm input dựa trên Accessibility Tree result.
   */
  private buildAccessibilityFillFormula(
    intent: string,
    locateValue: unknown,
  ): string {
    const result = locateValue as { role?: string; name?: string } | undefined;
    const nameStr = JSON.stringify(result?.name ?? '');
    const intentStr = JSON.stringify(intent.toLowerCase());

    return `(() => {
      const name = ${nameStr};
      const intent = ${intentStr};
      if (name) {
        const el = document.querySelector('input[aria-label=' + JSON.stringify(name) + '], textarea[aria-label=' + JSON.stringify(name) + '], input[placeholder=' + JSON.stringify(name) + '], textarea[placeholder=' + JSON.stringify(name) + ']');
        if (el) return el;
      }
      return Array.from(document.querySelectorAll('input, textarea, select')).find(el => {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const nameAttr = (el.getAttribute('name') || '').toLowerCase();
        return (label && label.includes(intent)) || (placeholder && placeholder.includes(intent)) || (nameAttr && nameAttr.includes(intent));
      }) || null;
    })()`;
  }
}

// ============================================================================
// CALL API ACTION
// ============================================================================

export class CallApiAction implements ActionPrimitive {
  readonly type = 'call_api';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();

    if (!ctx.currentVariant) {
      return {
        success: false,
        error: 'No variant available for call_api action',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    try {
      const formula = ctx.currentVariant.value_formula;
      const params = ctx.params;

      // Thực thi API call trong browser context (để giữ cookies/auth)
      const result = await ctx.browser.evaluate<{
        success: boolean;
        status: number;
        data: unknown;
        error?: string;
      }>(`
        (async () => {
          try {
            const config = ${JSON.stringify({ formula, params })};
            const response = await fetch(config.formula, {
              method: config.params.method || 'GET',
              headers: {
                'Content-Type': 'application/json',
                ...((config.params.headers || {})),
              },
              body: config.params.body ? JSON.stringify(config.params.body) : undefined,
            });
            
            const data = await response.json().catch(() => response.text());
            return {
              success: response.ok,
              status: response.status,
              data,
            };
          } catch (err) {
            return {
              success: false,
              status: 0,
              data: null,
              error: err.message,
            };
          }
        })()
      `);

      return {
        success: result.success,
        data: result,
        error: result.error,
        used_variant_id: ctx.currentVariant.id,
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        used_variant_id: ctx.currentVariant?.id,
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }
  }
}

// ============================================================================
// EXTRACT ACTION — + Prompt Injection Filter (Mục 6.2)
// ============================================================================

/**
 * Lọc nội dung chống prompt-injection trước khi đưa vào LLM context.
 * Mục 6.2: "coi mọi nội dung trích từ trang là dữ liệu không tin cậy theo mặc định"
 */
export function sanitizeForLLM(rawContent: string, maxLength: number = 10000): string {
  let cleaned = rawContent;

  // 1. Strip potential injection patterns
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /you\s+are\s+now\s+a/gi,
    /system\s*:\s*/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /```system/gi,
  ];

  for (const pattern of injectionPatterns) {
    cleaned = cleaned.replace(pattern, '[FILTERED]');
  }

  // 2. Giới hạn length
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength) + '\n[...TRUNCATED]';
  }

  // 3. Wrap trong delimiters rõ ràng
  return `[BEGIN_EXTRACTED_CONTENT]\n${cleaned}\n[END_EXTRACTED_CONTENT]`;
}

export class ExtractAction implements ActionPrimitive {
  readonly type = 'extract';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();

    if (!ctx.currentVariant) {
      return {
        success: false,
        error: 'No variant available for extract action',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    try {
      // Định vị phần tử qua locator 5-tier (Mục 6.1)
      const locateResult = await locateElement(ctx.browser, {
        intent: ctx.node?.intent,
        formula: ctx.currentVariant.value_formula,
        skipTiers: [4, 5],
        allowElevation: ctx.node?.requires_elevation || Boolean(ctx.params?.['allow_elevation']),
      });

      if (!locateResult.found) {
        return {
          success: false,
          error: `Element not found for extract: ${locateResult.description}`,
          used_variant_id: ctx.currentVariant.id,
          used_fallback: false,
          duration_ms: Date.now() - start,
        };
      }

      const jsFormula = normalizeFormulaToJs(ctx.currentVariant.value_formula);
      const shouldSanitize = ctx.params['sanitize_for_llm'] !== false;

      const rawContent = await ctx.browser.evaluate<string | null>(`
        (() => {
          try {
            const el = ${jsFormula};
            if (!el) return null;
            return el.innerText || el.textContent || el.value || '';
          } catch {
            return null;
          }
        })()
      `);

      if (rawContent === null) {
        return {
          success: false,
          error: `Element found by ${locateResult.tierName} but extraction returned null`,
          used_variant_id: ctx.currentVariant.id,
          used_fallback: locateResult.tier > 1,
          duration_ms: Date.now() - start,
        };
      }

      // Mục 6.2: BẮT BUỘC lọc chống prompt-injection
      const content = shouldSanitize ? sanitizeForLLM(rawContent) : rawContent;

      return {
        success: true,
        data: { raw: rawContent, sanitized: content },
        used_variant_id: ctx.currentVariant.id,
        used_fallback: locateResult.tier > 1,
        duration_ms: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        used_variant_id: ctx.currentVariant?.id,
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }
  }
}

// ============================================================================
// ACTION REGISTRY
// ============================================================================

/** Registry — mapping action type → implementation */
export class ActionRegistry {
  private actions: Map<string, ActionPrimitive> = new Map();

  register(action: ActionPrimitive): void {
    this.actions.set(action.type, action);
  }

  get(type: string): ActionPrimitive | undefined {
    return this.actions.get(type);
  }

  listTypes(): string[] {
    return Array.from(this.actions.keys());
  }

  /**
   * Tạo registry mặc định với đầy đủ các primitives cơ bản và nâng cao.
   */
  static createDefault(): ActionRegistry {
    const registry = new ActionRegistry();
    // Phase 0 primitives
    registry.register(new NavigateAction());
    registry.register(new ClickAction());
    registry.register(new FillAction());
    registry.register(new CallApiAction());
    registry.register(new ExtractAction());
    // Phase 1 advanced primitives
    registry.register(new WaitForAction());
    registry.register(new BranchAction());
    registry.register(new LoopAction());
    registry.register(new CallLlmAction());
    // Phase 3 complex/real-time primitives (Mục 6.1, 6.2)
    registry.register(new PatchRuntimeAction());
    registry.register(new DeepScanLocalAction());
    registry.register(new ClickCoordinateAction());
    return registry;
  }
}
