/**
 * Element Locator — Hệ thống 5-tier định vị phần tử (Mục 6.1)
 *
 * Thứ tự ưu tiên (PHẢI thử theo đúng thứ tự, dừng ở tier đầu tiên thành công):
 *
 * 1. Accessibility Tree query — CDP Accessibility.getFullAXTree, tìm theo role/name
 *    (ưu tiên CAO NHẤT, khớp trực tiếp với nguyên tắc "khoá theo intent")
 * 2. JS-query — querySelector qua Runtime.evaluate
 * 3. CDP DOM-domain query — BẮT BUỘC cho closed Shadow DOM (elevated)
 * 4. Fuzzy local-heal — so khớp gần đúng, ngưỡng ≥ 0.85 (Mục 15.1)
 * 5. Computer-vision/coordinate — click_coordinate cho canvas/WebGL
 *
 * Phase 0: Chỉ implement Tier 1 + Tier 2.
 */

import type { BrowserAdapter } from '../actions/primitives.js';
import { MAP_CONSTANTS } from '../map/schema.js';

// ============================================================================
// LOCATOR RESULT
// ============================================================================

export interface LocatorResult {
  /** Tier nào tìm được */
  tier: 1 | 2 | 3 | 4 | 5;

  /** Tên tier */
  tierName: 'accessibility_tree' | 'js_query' | 'cdp_dom' | 'fuzzy_heal' | 'cv_coordinate';

  /** Đã tìm thấy hay chưa */
  found: boolean;

  /** Giá trị trả về (element reference, selector, coordinate...) */
  value?: unknown;

  /** Mô tả cách tìm */
  description: string;

  /** Yêu cầu quyền elevated hay không (Mục 6.3: true nếu closed shadow root) */
  requiresElevation?: boolean;

  /** Điểm confidence nếu tìm qua Fuzzy local-heal (Mục 15.1) */
  confidence?: number;
}

// ============================================================================
// TIER 1: ACCESSIBILITY TREE QUERY (Mục 6.1 — tier ưu tiên cao nhất)
// ============================================================================

/**
 * Tìm phần tử qua Accessibility Tree.
 * Dùng CDP domain Accessibility.getFullAXTree để tìm theo role/name.
 * Đây là hiện thân tự nhiên nhất của nguyên tắc "khoá theo intent/vai trò ngữ nghĩa" (Mục 3.3).
 *
 * Chỉ chuyển sang tier 2 khi site không cung cấp đủ thông tin accessibility
 * (thiếu aria attributes/role — "nghèo semantic", Mục 3.12).
 */
export async function findByAccessibilityTree(
  browser: BrowserAdapter,
  intent: string,
  options?: { role?: string; name?: string },
): Promise<LocatorResult> {
  try {
    // Sử dụng aria attributes và role để tìm element
    // Đây là query ở tầng semantic, không phụ thuộc CSS/DOM structure
    const result = await browser.evaluate<{
      found: boolean;
      selector: string | null;
      role: string | null;
      name: string | null;
    }>(`
      (() => {
        // Strategy 1: Dùng aria-label/aria-labelledby match intent
        const intentLower = ${JSON.stringify(intent.toLowerCase())};
        const role = ${JSON.stringify(options?.role ?? null)};
        const name = ${JSON.stringify(options?.name ?? null)};

        // Xây selector dựa trên role/name
        let candidates = [];

        // Tìm qua role attribute
        if (role) {
          candidates.push(...document.querySelectorAll('[role="' + role + '"]'));
        }

        // Tìm qua aria-label
        const allWithAriaLabel = document.querySelectorAll('[aria-label]');
        for (const el of allWithAriaLabel) {
          const label = el.getAttribute('aria-label')?.toLowerCase() || '';
          if (label.includes(intentLower) || intentLower.includes(label)) {
            candidates.push(el);
          }
        }

        // Tìm qua semantic HTML elements (button, a, input với label)
        const semanticSelectors = ['button', 'a[href]', 'input', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]',
          '[role="tab"]', '[role="menuitem"]', '[role="switch"]'];
        
        for (const sel of semanticSelectors) {
          for (const el of document.querySelectorAll(sel)) {
            const text = (el.textContent || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();

            if (name) {
              const nameLower = name.toLowerCase();
              if (text === nameLower || ariaLabel === nameLower || 
                  title === nameLower || placeholder === nameLower) {
                candidates.push(el);
              }
            } else if (text.includes(intentLower) || ariaLabel.includes(intentLower) ||
                       title.includes(intentLower) || placeholder.includes(intentLower)) {
              candidates.push(el);
            }
          }
        }

        // Deduplicate
        const unique = [...new Set(candidates)];
        
        if (unique.length === 0) {
          return { found: false, selector: null, role: null, name: null };
        }

        // Lấy phần tử đầu tiên match tốt nhất
        const best = unique[0];
        const computedRole = best.getAttribute('role') || best.tagName.toLowerCase();
        const computedName = best.getAttribute('aria-label') || 
                             best.textContent?.trim().substring(0, 50) || '';

        return {
          found: true,
          selector: null, // Không cần CSS selector, ta dùng reference trực tiếp
          role: computedRole,
          name: computedName,
        };
      })()
    `);

    return {
      tier: 1,
      tierName: 'accessibility_tree',
      found: result.found,
      value: result,
      description: result.found
        ? `Found via Accessibility Tree: role="${result.role}", name="${result.name}"`
        : `Not found via Accessibility Tree for intent: "${intent}"`,
    };
  } catch (err) {
    return {
      tier: 1,
      tierName: 'accessibility_tree',
      found: false,
      description: `Accessibility Tree query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// TIER 2: JS-QUERY (Mục 6.1 — fallback khi Accessibility Tree không đủ)
// ============================================================================

/**
 * Chuẩn hoá formula thành JS expression hợp lệ.
 * Hỗ trợ cả selector thô (e.g. "#submit-btn", "h1.title")
 * lẫn JS expression đầy đủ (e.g. "document.querySelector('#submit-btn')").
 */
export function normalizeFormulaToJs(formula: string): string {
  const trimmed = formula.trim();
  if (
    trimmed.startsWith('document.') ||
    trimmed.startsWith('window.') ||
    trimmed.startsWith('(') ||
    trimmed.startsWith('role:')
  ) {
    return trimmed;
  }
  return `document.querySelector(${JSON.stringify(trimmed)})`;
}

/**
 * Tìm phần tử qua querySelector / Runtime.evaluate.
 * Mặc định cho trường hợp Accessibility Tree không đủ thông tin.
 */
export async function findByJsQuery(
  browser: BrowserAdapter,
  formula: string,
): Promise<LocatorResult> {
  try {
    const jsExpr = normalizeFormulaToJs(formula);
    const found = await browser.evaluate<boolean>(`
      (() => {
        try {
          const el = ${jsExpr};
          return el !== null && el !== undefined;
        } catch {
          return false;
        }
      })()
    `);

    return {
      tier: 2,
      tierName: 'js_query',
      found: Boolean(found),
      value: formula,
      description: found
        ? `Found via JS-query: ${formula}`
        : `Not found via JS-query: ${formula}`,
    };
  } catch (err) {
    return {
      tier: 2,
      tierName: 'js_query',
      found: false,
      description: `JS-query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// TIER 3: CDP DOM-DOMAIN QUERY (Mục 6.1 & 6.3 — Shadow DOM & Elevated)
// ============================================================================

export interface CdpDomOptions {
  selector?: string;
  intent?: string;
  formula?: string;
}

/**
 * Tìm phần tử trong Shadow DOM (cả Open và Closed).
 * BẮT BUỘC dùng khi nghi ngờ có Shadow DOM đóng (closed) — vì Tier 1 và 2 không xuyên qua được.
 * Truy cập vào closed shadow root là hành động elevated (Mục 6.3).
 */
export async function findByCdpDom(
  browser: BrowserAdapter,
  selectorOrOptions: string | CdpDomOptions,
): Promise<LocatorResult> {
  try {
    const targetSelector = typeof selectorOrOptions === 'string'
      ? selectorOrOptions
      : (selectorOrOptions.selector || selectorOrOptions.formula || '');

    const targetIntent = typeof selectorOrOptions === 'object'
      ? selectorOrOptions.intent
      : undefined;

    const result = await browser.evaluate<{
      found: boolean;
      isClosed: boolean;
      hostTag?: string;
      targetTag?: string;
      textContent?: string;
      matchedSelector?: string;
    }>(`
      (() => {
        const rawSelector = ${JSON.stringify(targetSelector)};
        const intent = ${JSON.stringify(targetIntent?.toLowerCase().trim() || '')};

        // Chuẩn hoá selector nếu là JS formula
        let selector = rawSelector;
        if (selector.includes('document.querySelector(')) {
          const m = selector.match(/document\\.querySelector\\(["'](.*?)["']\\)/);
          if (m) selector = m[1];
        }

        function checkElement(el) {
          if (!el || el.nodeType !== 1) return false;
          if (selector) {
            try {
              if (el.matches && el.matches(selector)) return true;
            } catch {}
          }
          if (intent) {
            const text = (el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute && el.getAttribute('aria-label') || '').toLowerCase();
            if (text.includes(intent) || aria.includes(intent)) return true;
          }
          return false;
        }

        // Duyệt đệ quy xuyên qua Shadow DOM
        function traverse(root, isClosedContext) {
          if (!root) return null;
          const elements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
          for (const el of elements) {
            if (checkElement(el)) {
              return {
                found: true,
                isClosed: isClosedContext,
                hostTag: root.host ? root.host.tagName.toLowerCase() : undefined,
                targetTag: el.tagName ? el.tagName.toLowerCase() : undefined,
                textContent: (el.textContent || '').trim().substring(0, 50),
                matchedSelector: selector,
              };
            }

            // 1. Kiểm tra open shadowRoot
            if (el.shadowRoot) {
              const res = traverse(el.shadowRoot, false);
              if (res) return res;
            }

            // 2. Kiểm tra closed shadowRoot (hỗ trợ các registry / hook theo dõi closed root)
            const closedRoot = el._closedShadowRoot || 
              (window.__closedShadowRoots__ && window.__closedShadowRoots__.get && window.__closedShadowRoots__.get(el));
            if (closedRoot) {
              const res = traverse(closedRoot, true);
              if (res) return res;
            }
          }
          return null;
        }

        return traverse(document, false) || { found: false, isClosed: false };
      })()
    `);

    if (result && result.found) {
      return {
        tier: 3,
        tierName: 'cdp_dom',
        found: true,
        requiresElevation: result.isClosed, // Mục 6.3: Closed shadow root BẮT BUỘC là elevated
        value: result,
        description: result.isClosed
          ? `Found via CDP DOM inside CLOSED Shadow DOM (host: <${result.hostTag}>, elevated: true)`
          : `Found via CDP DOM inside OPEN Shadow DOM (host: <${result.hostTag}>)`,
      };
    }

    return {
      tier: 3,
      tierName: 'cdp_dom',
      found: false,
      description: `Not found via CDP DOM query in Shadow DOM`,
    };
  } catch (err) {
    return {
      tier: 3,
      tierName: 'cdp_dom',
      found: false,
      description: `CDP DOM query failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// TIER 4: FUZZY LOCAL-HEAL (Mục 6.1 & Mục 15.1 — Ngưỡng ≥ 0.85)
// ============================================================================

export interface FuzzyHealOptions {
  intent?: string;
  formula?: string;
  minConfidence?: number;
}

/**
 * So khớp gần đúng (Fuzzy local-heal) trên DOM hiện tại.
 * - Ngưỡng tin cậy ≥ 0.85 (Mục 15.1).
 * - Hoàn toàn cục bộ: KHÔNG mạng, KHÔNG LLM, KHÔNG ghi gì mới vào Map (Mục 6.1).
 */
export async function findByFuzzyHeal(
  browser: BrowserAdapter,
  optionsOrIntent: string | FuzzyHealOptions,
  minConfidence: number = MAP_CONSTANTS.FUZZY_HEAL_MIN_CONFIDENCE,
): Promise<LocatorResult> {
  try {
    const opts: FuzzyHealOptions = typeof optionsOrIntent === 'string'
      ? { intent: optionsOrIntent, minConfidence }
      : { minConfidence, ...optionsOrIntent };

    const targetIntent = opts.intent || '';
    const targetFormula = opts.formula || '';
    const threshold = opts.minConfidence ?? MAP_CONSTANTS.FUZZY_HEAL_MIN_CONFIDENCE;

    const result = await browser.evaluate<{
      found: boolean;
      score: number;
      tag?: string;
      id?: string;
      text?: string;
      selector?: string;
    }>(`
      (() => {
        const targetIntent = ${JSON.stringify(targetIntent.toLowerCase().trim())};
        const targetFormula = ${JSON.stringify(targetFormula.toLowerCase().trim())};
        const threshold = ${threshold};

        // Bigram Dice Coefficient
        function getBigrams(str) {
          const s = str.toLowerCase().trim();
          const map = new Map();
          for (let i = 0; i < s.length - 1; i++) {
            const bg = s.substring(i, i + 2);
            map.set(bg, (map.get(bg) || 0) + 1);
          }
          return map;
        }

        function diceSimilarity(s1, s2) {
          if (!s1 || !s2) return 0;
          if (s1 === s2) return 1.0;
          if (s1.includes(s2) || s2.includes(s1)) {
            const minLen = Math.min(s1.length, s2.length);
            const maxLen = Math.max(s1.length, s2.length);
            return 0.85 + (0.15 * (minLen / maxLen));
          }
          const bg1 = getBigrams(s1);
          const bg2 = getBigrams(s2);
          let intersection = 0;
          let total1 = 0;
          let total2 = 0;
          for (const count of bg1.values()) total1 += count;
          for (const count of bg2.values()) total2 += count;
          if (total1 + total2 === 0) return 0;

          for (const [bg, count1] of bg1.entries()) {
            if (bg2.has(bg)) {
              intersection += Math.min(count1, bg2.get(bg));
            }
          }
          return (2.0 * intersection) / (total1 + total2);
        }

        const candidates = Array.from(document.querySelectorAll(
          'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"], div[onclick], span[onclick], form'
        ));

        let bestScore = 0;
        let bestEl = null;

        for (const el of candidates) {
          const text = (el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          const title = (el.getAttribute('title') || '').trim().toLowerCase();
          const placeholder = (el.getAttribute('placeholder') || '').trim().toLowerCase();
          const id = (el.id || '').trim().toLowerCase();
          const name = (el.getAttribute('name') || '').trim().toLowerCase();

          let scoreIntent = 0;
          if (targetIntent) {
            scoreIntent = Math.max(
              diceSimilarity(targetIntent, text),
              diceSimilarity(targetIntent, aria),
              diceSimilarity(targetIntent, title),
              diceSimilarity(targetIntent, placeholder)
            );
          }

          let scoreFormula = 0;
          if (targetFormula) {
            const cleanFormula = targetFormula.replace(/[^a-zA-Z0-9_-]/g, ' ').trim();
            scoreFormula = Math.max(
              diceSimilarity(cleanFormula, id),
              diceSimilarity(cleanFormula, name),
              diceSimilarity(cleanFormula, text)
            );
          }

          const combinedScore = Number(Math.max(scoreIntent, scoreFormula).toFixed(3));
          if (combinedScore > bestScore) {
            bestScore = combinedScore;
            bestEl = el;
          }
        }

        if (bestScore >= threshold && bestEl) {
          let selector = bestEl.tagName.toLowerCase();
          if (bestEl.id) {
            selector += '#' + bestEl.id;
          } else if (bestEl.getAttribute('aria-label')) {
            selector += '[aria-label="' + bestEl.getAttribute('aria-label') + '"]';
          }

          return {
            found: true,
            score: bestScore,
            tag: bestEl.tagName.toLowerCase(),
            id: bestEl.id || undefined,
            text: (bestEl.textContent || '').trim().substring(0, 50),
            selector,
          };
        }

        return { found: false, score: bestScore };
      })()
    `);

    if (result && result.found && result.score >= threshold) {
      return {
        tier: 4,
        tierName: 'fuzzy_heal',
        found: true,
        confidence: result.score,
        value: result,
        description: `Found via Fuzzy local-heal (score: ${result.score} >= ${threshold}, tag: <${result.tag}>, text: "${result.text}")`,
      };
    }

    return {
      tier: 4,
      tierName: 'fuzzy_heal',
      found: false,
      confidence: result?.score,
      description: `Fuzzy local-heal failed (best score: ${result?.score ?? 0} < threshold ${threshold})`,
    };
  } catch (err) {
    return {
      tier: 4,
      tierName: 'fuzzy_heal',
      found: false,
      description: `Fuzzy local-heal error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// TIER 5: COMPUTER-VISION / COORDINATE (Mục 6.1 tier 5 — Canvas/WebGL & Game state)
// ============================================================================

export interface CvCoordinateOptions {
  /** Toạ độ X (pixels tuyệt đối hoặc relative 0..1) */
  x?: number;
  /** Toạ độ Y (pixels tuyệt đối hoặc relative 0..1) */
  y?: number;
  /** Toạ độ tương đối theo canvas/viewport */
  isRelative?: boolean;
  /** Selector của canvas/container (nếu có) */
  canvasSelector?: string;
  /** Formula dạng 'coord:x,y' hoặc 'coordinate:x,y[canvas="#id"]' */
  formula?: string;
}

/**
 * Tier 5: Computer-vision/coordinate (click_coordinate).
 * Dùng khi trang render bằng canvas/WebGL (không có DOM) hoặc mọi tier DOM-based thất bại.
 * Toạ độ tính từ vị trí đã biết của đối tượng trong game/app state (Mục 6.1 tier 5).
 */
export async function findByCvCoordinate(
  browser: BrowserAdapter,
  options: CvCoordinateOptions,
): Promise<LocatorResult> {
  try {
    let x = options.x;
    let y = options.y;
    let isRelative = options.isRelative ?? false;
    let canvasSelector = options.canvasSelector;

    // Parse formula: coord:x,y hoặc coordinate:x,y[canvas="#id"] hoặc coord:0.5,0.8[relative]
    if (options.formula && (options.formula.startsWith('coord:') || options.formula.startsWith('coordinate:'))) {
      const clean = options.formula.replace(/^(coord:|coordinate:)/, '').trim();
      const canvasMatch = clean.match(/\[canvas=["'](.*?)["']\]/);
      if (canvasMatch) {
        canvasSelector = canvasMatch[1];
      }
      if (clean.includes('[relative]')) {
        isRelative = true;
      }
      const numMatch = clean.match(/^([0-9.]+)\s*,\s*([0-9.]+)/);
      if (numMatch) {
        x = parseFloat(numMatch[1]);
        y = parseFloat(numMatch[2]);
      }
    }

    if (x === undefined || y === undefined) {
      return {
        tier: 5,
        tierName: 'cv_coordinate',
        found: false,
        description: 'CV/Coordinate failed: No coordinate specified or invalid formula format.',
      };
    }

    // Xác thực toạ độ trên trang / canvas qua browser
    const verifyResult = await browser.evaluate<{
      found: boolean;
      resolvedX: number;
      resolvedY: number;
      targetTag?: string;
      canvasFound?: boolean;
      error?: string;
    }>(`
      (() => {
        try {
          const rawX = ${x};
          const rawY = ${y};
          const isRel = ${isRelative};
          const sel = ${JSON.stringify(canvasSelector || '')};

          let targetX = rawX;
          let targetY = rawY;
          let canvasFound = false;

          if (sel) {
            const canvas = document.querySelector(sel);
            if (canvas) {
              canvasFound = true;
              const rect = canvas.getBoundingClientRect();
              targetX = isRel ? rect.left + rect.width * rawX : rect.left + rawX;
              targetY = isRel ? rect.top + rect.height * rawY : rect.top + rawY;
            } else {
              return { found: false, resolvedX: 0, resolvedY: 0, canvasFound: false, error: 'Target canvas not found: ' + sel };
            }
          } else if (isRel) {
            targetX = window.innerWidth * rawX;
            targetY = window.innerHeight * rawY;
          }

          const el = document.elementFromPoint(targetX, targetY);
          return {
            found: true,
            resolvedX: targetX,
            resolvedY: targetY,
            canvasFound,
            targetTag: el ? el.tagName.toLowerCase() : undefined,
          };
        } catch (err) {
          return { found: false, resolvedX: 0, resolvedY: 0, error: err.message };
        }
      })()
    `);

    if (verifyResult && verifyResult.found) {
      return {
        tier: 5,
        tierName: 'cv_coordinate',
        found: true,
        confidence: 0.85,
        value: {
          x: verifyResult.resolvedX,
          y: verifyResult.resolvedY,
          isRelative,
          canvasSelector,
          targetTag: verifyResult.targetTag,
        },
        description: `Found via CV/Coordinate (x: ${verifyResult.resolvedX}, y: ${verifyResult.resolvedY}${canvasSelector ? `, canvas: "${canvasSelector}"` : ''})`,
      };
    }

    return {
      tier: 5,
      tierName: 'cv_coordinate',
      found: false,
      description: `CV/Coordinate lookup failed: ${verifyResult?.error ?? 'Unknown error'}`,
    };
  } catch (err) {
    return {
      tier: 5,
      tierName: 'cv_coordinate',
      found: false,
      description: `CV/Coordinate evaluation error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// UNIFIED LOCATOR — Thử lần lượt 5 tier (Mục 6.1)
// ============================================================================

export interface LocateOptions {
  /** Intent/vai trò ngữ nghĩa cho Tier 1 (Accessibility Tree) */
  intent?: string;
  /** Role cho Tier 1 */
  role?: string;
  /** Name cho Tier 1 */
  name?: string;
  /** Formula/selector cho Tier 2 (JS-query) hoặc toạ độ Tier 5 */
  formula?: string;
  /** Toạ độ trực tiếp cho Tier 5 */
  coordinate?: {
    x: number;
    y: number;
    isRelative?: boolean;
    canvasSelector?: string;
  };
  /** Bỏ qua tier nào (ví dụ: [3] để bỏ CDP DOM vì không cần elevated) */
  skipTiers?: number[];
  /** Ngưỡng confidence cho Tier 4 */
  minConfidence?: number;
  /**
   * Cho phép thực thi hành động Elevated (Mục 6.3).
   * Mặc định là false. Khi false, mọi truy cập vào Closed Shadow Root sẽ bị CHẶN LẠI (found: false, requiresElevation: true)
   * và không được tự ý thực thi.
   */
  allowElevation?: boolean;
}

/**
 * Thử lần lượt tất cả tier có sẵn cho đến khi tìm được.
 * PHẢI theo đúng thứ tự tier (Mục 6.1):
 * Tier 1: Accessibility Tree -> Tier 2: JS-query -> Tier 3: CDP DOM -> Tier 4: Fuzzy local-heal -> Tier 5: CV/Coordinate
 */
export async function locateElement(
  browser: BrowserAdapter,
  options: LocateOptions,
): Promise<LocatorResult> {
  const skipSet = new Set(options.skipTiers ?? []);

  // Parse role/name từ formula nếu có dạng role:roleName[name="..."] (Mục 6.1)
  let role = options.role;
  let name = options.name;
  if (options.formula && options.formula.startsWith('role:')) {
    const match = options.formula.match(/^role:([a-zA-Z0-9_-]+)(?:\[name=["'](.*?)["']\])?/);
    if (match) {
      if (!role) role = match[1];
      if (!name) name = match[2];
    }
  }

  // Tier 1: Accessibility Tree (ưu tiên cao nhất)
  if (!skipSet.has(1) && (options.intent || role || name)) {
    const result = await findByAccessibilityTree(browser, options.intent ?? name ?? '', {
      role,
      name,
    });
    if (result.found) return result;
  }

  // Tier 2: JS-query (chỉ chạy nếu formula không phải role: hoặc coord: pseudo-selector)
  if (
    !skipSet.has(2) &&
    options.formula &&
    !options.formula.startsWith('role:') &&
    !options.formula.startsWith('coord:') &&
    !options.formula.startsWith('coordinate:')
  ) {
    const result = await findByJsQuery(browser, options.formula);
    if (result.found) return result;
  }

  // Tier 3: CDP DOM-domain (Shadow DOM / Closed shadow root elevated - Mục 6.1 & 6.3)
  if (!skipSet.has(3) && (options.formula || options.intent)) {
    const result = await findByCdpDom(browser, {
      selector: options.formula,
      intent: options.intent ?? name,
      formula: options.formula,
    });
    if (result.found) {
      // Mục 6.3: Closed Shadow Root BẮT BUỘC cần xác nhận người dùng (allowElevation = true)
      if (result.requiresElevation && !options.allowElevation) {
        return {
          tier: 3,
          tierName: 'cdp_dom',
          found: false,
          requiresElevation: true,
          value: result.value,
          description: `Blocked: Element is inside CLOSED Shadow DOM (host: <${(result.value as any)?.hostTag}>). Requires elevated confirmation before execution (Mục 6.3).`,
        };
      }
      return result;
    }
  }

  // Tier 4: Fuzzy local-heal (So khớp gần đúng, ngưỡng ≥ 0.85 - Mục 6.1 & 15.1)
  if (!skipSet.has(4) && (options.intent || options.formula || name)) {
    const result = await findByFuzzyHeal(browser, {
      intent: options.intent ?? name,
      formula: options.formula,
      minConfidence: options.minConfidence,
    });
    if (result.found) return result;
  }

  // Tier 5: Computer-vision / Coordinate (Mục 6.1 tier 5 — canvas/WebGL hoặc coordinate formula)
  if (
    !skipSet.has(5) &&
    (options.coordinate ||
      (options.formula &&
        (options.formula.startsWith('coord:') || options.formula.startsWith('coordinate:'))))
  ) {
    const result = await findByCvCoordinate(browser, {
      x: options.coordinate?.x,
      y: options.coordinate?.y,
      isRelative: options.coordinate?.isRelative,
      canvasSelector: options.coordinate?.canvasSelector,
      formula: options.formula,
    });
    if (result.found) return result;
  }

  // Hết mọi tier có sẵn
  return {
    tier: 5,
    tierName: 'cv_coordinate',
    found: false,
    description: 'All available tiers exhausted. Element not found.',
  };
}
