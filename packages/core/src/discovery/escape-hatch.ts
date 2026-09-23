/**
 * Escape Hatch Engine — Chế độ thoát hiểm Tháp khi bế tắc (Mục 3.6)
 *
 * Điều kiện kích hoạt:
 * 1. Toàn bộ tier định vị đã biết (Tier 1-4) đều thất bại liên tục
 * 2. ĐÃ LOẠI TRỪ 2 nguyên nhân: mất phiên đăng nhập (login check) và site lỗi tạm thời
 *
 * Đặc điểm bắt buộc:
 * - Cấp quyền LLM thao tác CDP tự do với ngân sách giới hạn (max 3 lần thử)
 * - Node tạo ra PHẢI gắn cờ `discovered_via: 'escape_hatch'`
 * - TTL ngắn hơn bình thường: MAP_CONSTANTS.TTL_ESCAPE_HATCH_MS (7 ngày)
 * - Vẫn tuân thủ xác nhận Elevated nếu chạm Closed Shadow Root hoặc patch_runtime (Mục 6.3)
 * - CHỈ tồn tại trong Tháp, TUYỆT ĐỐI KHÔNG đóng gói vào Tool (Mục 3.6)
 *
 * Bước 2 — Codify (Mục 3.6):
 * Sau khi tìm được cách hoạt động, PHẢI quyết định:
 * - Biến thể mới của node-type đã biết, hay cần node-type hoàn toàn mới?
 * - Chỉ chính thức hoá thành node-type mới trong schema chung khi đã gặp
 *   hiện tượng tương tự ở ≥2 domain khác nhau.
 * - Nếu chỉ 1 lần → ghi nhận là biến thể đặc thù riêng của domain đó.
 */

import type { BrowserAdapter } from '../actions/primitives.js';
import { MAP_CONSTANTS, type ResourceNode, type Variant } from '../map/schema.js';

export interface EscapeHatchContext {
  targetIntent: string;
  domain: string;
  attemptCount: number;
  lastKnownFailedTiers: number[];
  isSessionLost: boolean;
  isTransientError: boolean;
}

/**
 * Registry theo dõi các pattern từng phát hiện qua Escape Hatch.
 * Phục vụ bước "codify" (Mục 3.6 bước 2):
 * Chỉ chính thức hoá thành node-type mới khi ≥2 domain khác nhau đều gặp pattern tương tự.
 */
export interface EscapeHatchPatternRegistry {
  /** Tra cứu xem pattern (formula chuẩn hoá) đã được ghi nhận ở những domain nào */
  getDomainsForPattern(normalizedPattern: string): string[];
  /** Ghi nhận thêm 1 lần gặp pattern tại domain cụ thể */
  recordPatternOccurrence(normalizedPattern: string, domain: string): void;
}

export type CodifyDecision =
  | 'domain_specific'    // Chỉ gặp ở 1 domain → biến thể đặc thù, KHÔNG mở rộng schema chung
  | 'new_node_type';     // ≥2 domain → chính thức hoá thành node-type mới trong schema chung

export interface EscapeHatchResult {
  activated: boolean;
  success: boolean;
  reason?: string;
  createdNode?: ResourceNode;
  discoveredVariant?: Variant;
  attemptsUsed: number;
  /** Mục 3.6 bước 2: Kết quả quyết định codify — domain_specific hay new_node_type */
  codifyDecision?: CodifyDecision;
}

export class EscapeHatchEngine {
  static readonly MAX_ATTEMPTS = 3;

  /**
   * Kiểm tra điều kiện tiên quyết để kích hoạt Escape Hatch (Mục 3.6).
   */
  static canActivate(ctx: EscapeHatchContext): { allowed: boolean; reason: string } {
    // 1. Phải loại trừ nguyên nhân mất phiên đăng nhập
    if (ctx.isSessionLost) {
      return {
        allowed: false,
        reason: 'Không thể kích hoạt Escape Hatch: Thất bại do mất phiên đăng nhập (yêu cầu login lại, Mục 3.6 & 7.1).',
      };
    }

    // 2. Phải loại trừ site lỗi tạm thời (5xx, mất mạng)
    if (ctx.isTransientError) {
      return {
        allowed: false,
        reason: 'Không thể kích hoạt Escape Hatch: Site đang gặp lỗi tạm thời (HTTP 5xx/mất mạng, Mục 3.1 & 3.6).',
      };
    }

    // 3. Toàn bộ tiers thông thường phải đã thất bại
    const hasExhaustedStandardTiers = ctx.lastKnownFailedTiers.includes(1) &&
      ctx.lastKnownFailedTiers.includes(2) &&
      ctx.lastKnownFailedTiers.includes(4);

    if (!hasExhaustedStandardTiers) {
      return {
        allowed: false,
        reason: 'Không thể kích hoạt Escape Hatch: Các tier thông thường (1, 2, 4) chưa được thử hết.',
      };
    }

    return {
      allowed: true,
      reason: 'Đủ điều kiện kích hoạt Escape Hatch (Đã thử hết tiers và loại trừ session/transient error).',
    };
  }

  /**
   * Thực hiện Escape Hatch: cho phép agent thao tác CDP linh hoạt để tìm cách tương tác thành công.
   */
  static async execute(
    browser: BrowserAdapter,
    ctx: EscapeHatchContext,
    customExplorer?: (browser: BrowserAdapter) => Promise<{ success: boolean; formula: string; requiresElevation?: boolean }>,
    allowElevation: boolean = false,
    patternRegistry?: EscapeHatchPatternRegistry,
  ): Promise<EscapeHatchResult> {
    const check = this.canActivate(ctx);
    if (!check.allowed) {
      return {
        activated: false,
        success: false,
        reason: check.reason,
        attemptsUsed: 0,
      };
    }

    let attempts = 0;
    let foundFormula: string | null = null;
    let isElevated = false;

    while (attempts < this.MAX_ATTEMPTS) {
      attempts++;
      try {
        if (customExplorer) {
          const res = await customExplorer(browser);
          if (res.success && res.formula) {
            foundFormula = res.formula;
            isElevated = Boolean(res.requiresElevation);
            break;
          }
        } else {
          // Thao tác CDP thăm dò mặc định: quét cây DOM sâu, event listeners, frame coordinates
          const cdpExploration = await browser.evaluate<{ found: boolean; formula?: string; isElevated?: boolean }>(`
            (() => {
              // Dò tìm phần tử có onclick listener hoặc role tuỳ biến
              const allElements = Array.from(document.querySelectorAll('*'));
              for (const el of allElements) {
                if (el.onclick || el.getAttribute('role') === 'button' || el.hasAttribute('data-action')) {
                  const id = el.id ? '#' + el.id : '';
                  const className = el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '';
                  return { found: true, formula: el.tagName.toLowerCase() + id + className, isElevated: false };
                }
              }
              return { found: false };
            })()
          `);

          if (cdpExploration && cdpExploration.found && cdpExploration.formula) {
            foundFormula = cdpExploration.formula;
            isElevated = Boolean(cdpExploration.isElevated);
            break;
          }
        }
      } catch {
        // Tiếp tục thử cho đến hết ngân sách
      }
    }

    if (!foundFormula) {
      return {
        activated: true,
        success: false,
        reason: `Escape Hatch exhausted all ${this.MAX_ATTEMPTS} attempts without finding a viable formula.`,
        attemptsUsed: attempts,
      };
    }

    // Mục 6.3: Nếu chạm vào hành động Elevated mà chưa có sự đồng ý của người dùng -> Chặn lại
    if (isElevated && !allowElevation) {
      return {
        activated: true,
        success: false,
        reason: 'Blocked: Escape Hatch discovered an ELEVATED interaction (Closed Shadow Root/patch_runtime). Requires explicit confirmation before persisting (Mục 3.6 & 6.3).',
        attemptsUsed: attempts,
      };
    }

    const now = Date.now();
    const variantId = `v_esc_${now}_${Math.random().toString(36).substring(2, 6)}`;

    // ========================================================================
    // Mục 3.6 bước 2: CODIFY — quyết định biến thể mới hay node-type mới
    // Chuẩn hoá formula để so pattern (bỏ id/class cụ thể, giữ tagName + kỹ thuật)
    // ========================================================================
    const normalizedPattern = foundFormula
      .replace(/#[\w-]+/g, '')     // bỏ ID selectors (#my-id)
      .replace(/\.[\w-]+/g, '')    // bỏ class selectors (.my-class)
      .replace(/\[.*?\]/g, '')     // bỏ attribute selectors [data-x="y"]
      .trim()
      .toLowerCase() || foundFormula.toLowerCase();

    let codifyDecision: CodifyDecision = 'domain_specific';

    if (patternRegistry) {
      // Ghi nhận lần gặp pattern tại domain hiện tại
      patternRegistry.recordPatternOccurrence(normalizedPattern, ctx.domain);
      const domainsWithSamePattern = patternRegistry.getDomainsForPattern(normalizedPattern);

      if (domainsWithSamePattern.length >= 2) {
        // ≥2 domain → chính thức hoá thành node-type mới trong schema chung
        codifyDecision = 'new_node_type';
      }
      // Ngược lại: chỉ 1 domain → giữ domain_specific (mặc định)
    }

    // Mục 3.6 & 15.1: Node sinh từ Escape Hatch PHẢI có cờ discovered_via: 'escape_hatch' và TTL ngắn (7 ngày)
    const discoveredVariant: Variant = {
      id: variantId,
      value_formula: foundFormula,
      confidence: 0.70, // Ban đầu thấp hơn bình thường vì do thoát hiểm tìm ra
      last_verified: now,
      fail_count_recent: 0,
      locale: null,
      created_at: now,
      ttl_ms: MAP_CONSTANTS.TTL_ESCAPE_HATCH_MS, // 7 ngày = 604,800,000 ms
    };

    const createdNode: ResourceNode = {
      id: `node_esc_${now}`,
      intent: ctx.targetIntent,
      type: 'dom_element',
      variants: [discoveredVariant],
      created_at: now,
      updated_at: now,
      discovered_via: 'escape_hatch', // BẮT BUỘC
      requires_elevation: isElevated,
    };

    return {
      activated: true,
      success: true,
      createdNode,
      discoveredVariant,
      attemptsUsed: attempts,
      codifyDecision, // Mục 3.6 bước 2: caller dùng để quyết định lưu riêng domain hay mở rộng schema chung
    };
  }
}
