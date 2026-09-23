/**
 * Phase 3 Action Primitives — Site Phức Tạp / Real-time (Mục 6.1, 6.2, 6.3)
 *
 * Gồm:
 * 1. PatchRuntimeAction (Elevated, namespace chung, chuỗi hoá) (Mục 6.2)
 * 2. DeepScanLocalAction (Quét client storage có lọc pattern, cấm dump toàn bộ) (Mục 6.2)
 * 3. ClickCoordinateAction (Tier 5: Computer-vision/coordinate trên Canvas/WebGL) (Mục 6.1 tier 5)
 */

import type { ActionPrimitive, ActionContext, ActionResult, BrowserAdapter } from './primitives.js';

// ============================================================================
// 1. PATCH RUNTIME ACTION (Mục 6.2 & Mục 6.3 — Elevated)
// ============================================================================

export interface PatchRuntimeParams {
  /**
   * Tên API runtime cần hook/patch (ví dụ: 'window.fetch', 'window.WebSocket', 'XMLHttpRequest')
   */
  target: string;

  /**
   * Định danh duy nhất của patch trong namespace chung để tránh xung đột
   */
  patch_id: string;

  /**
   * Mã JS hook/wrap. Hàm nhận `originalFn` và trả về wrapper.
   */
  hook_code: string;

  /**
   * Cho phép cấp quyền elevated (Mục 6.3).
   * BẮT BUỘC = true, nếu không sẽ bị CHẶN LẠI ngay trước khi thực thi.
   */
  allow_elevation?: boolean;
}

/**
 * Action `patch_runtime` — ghi đè hành vi runtime toàn cục.
 * - Phân loại: Elevated (Mục 6.3) — BẮT BUỘC có xác nhận trước.
 * - Chuỗi hoá với override đã tồn tại, lưu vào namespace `window.__devBrowserTool_patches__`.
 * - CHỈ dùng cho mục đích quan sát/thu thập dữ liệu (Mục 6.2).
 * - TUYỆT ĐỐI KHÔNG dùng để vô hiệu hoá phòng thủ site (Mục 8).
 */
export class PatchRuntimeAction implements ActionPrimitive {
  readonly type = 'patch_runtime';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const params = ctx.params as unknown as PatchRuntimeParams;

    if (!params || !params.target || !params.patch_id || !params.hook_code) {
      return {
        success: false,
        error: 'Missing required params: target, patch_id, hook_code',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    // Mục 6.3: Phân loại Elevated — BẮT BUỘC kiểm tra quyền xác nhận
    const isElevatedAllowed = ctx.node?.requires_elevation || Boolean(params.allow_elevation);
    if (!isElevatedAllowed) {
      return {
        success: false,
        error: `Blocked: Action "patch_runtime" on "${params.target}" is ELEVATED. Requires explicit user confirmation before execution (Mục 6.3).`,
        used_fallback: false,
        duration_ms: Date.now() - start,
        data: { requires_elevation: true, blocked: true },
      };
    }

    // Chính sách Anti-detection Nhóm 2 (Mục 8.1 & 8.2): Cấm vô hiệu hoá browser lock.
    // LƯU Ý: Kiểm tra bằng regex keyword là biện pháp PHÒNG THỦ LỚP ĐẦU (best-effort),
    // KHÔNG phải đảm bảo tuyệt đối — code có thể viết lại theo cách không khớp pattern.
    // Đây là 1 trong nhiều lớp phòng vệ, cùng với: review thủ công, audit log,
    // và nguyên tắc thiết kế (Tháp không tạo ra node-type bypass anti-detection).
    const lowerCode = params.hook_code.toLowerCase();
    const prohibitedKeywords = ['anti-bot', 'bypass_lock', 'disable_security', 'fake_useragent_strict'];
    if (prohibitedKeywords.some(kw => lowerCode.includes(kw))) {
      return {
        success: false,
        error: 'Rejected: patch_runtime violates Anti-detection Policy (Group 2 bypass forbidden - Mục 8).',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    try {
      const result = await ctx.browser.evaluate<{
        success: boolean;
        message: string;
        target: string;
        active_patches_count: number;
      }>(`
        (() => {
          try {
            // Khởi tạo namespace chung nếu chưa có
            window.__devBrowserTool_patches__ = window.__devBrowserTool_patches__ || {
              registry: {},
              originals: {},
            };

            const ns = window.__devBrowserTool_patches__;
            const targetPath = ${JSON.stringify(params.target)};
            const patchId = ${JSON.stringify(params.patch_id)};
            const hookSource = ${JSON.stringify(params.hook_code)};

            // Phân rã target path: ví dụ window.fetch -> obj=window, prop='fetch'
            const parts = targetPath.split('.');
            let obj = window;
            for (let i = 0; i < parts.length - 1; i++) {
              const part = parts[i] === 'window' ? null : parts[i];
              if (part) obj = obj[part];
              if (!obj) throw new Error('Target object not found: ' + parts.slice(0, i + 1).join('.'));
            }
            const prop = parts[parts.length - 1];
            const currentFn = obj[prop];

            if (typeof currentFn !== 'function') {
              throw new Error('Target property is not a function: ' + targetPath);
            }

            // Lưu original function lần đầu tiên (chuỗi hoá)
            if (!ns.originals[targetPath]) {
              ns.originals[targetPath] = currentFn;
            }

            // Đánh giá hook function từ source: (originalFn) => wrapperFn
            const hookFactory = new Function('originalFn', 'return (' + hookSource + ')(originalFn);');
            const newFn = hookFactory(currentFn);

            // Gán đè có bảo vệ
            obj[prop] = newFn;
            ns.registry[patchId] = {
              target: targetPath,
              installed_at: Date.now(),
            };

            return {
              success: true,
              message: 'Runtime patched successfully with chaining in shared namespace',
              target: targetPath,
              active_patches_count: Object.keys(ns.registry).length,
            };
          } catch (err) {
            return {
              success: false,
              message: err instanceof Error ? err.message : String(err),
              target: ${JSON.stringify(params.target)},
              active_patches_count: 0,
            };
          }
        })()
      `);

      if (!result.success) {
        return {
          success: false,
          error: `Failed to patch runtime: ${result.message}`,
          used_fallback: false,
          duration_ms: Date.now() - start,
        };
      }

      return {
        success: true,
        data: result,
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
// 2. DEEP SCAN LOCAL ACTION (Mục 6.2 — Lọc Pattern Client Storage)
// ============================================================================

export interface DeepScanLocalParams {
  /**
   * Nguồn quét: 'localStorage' | 'sessionStorage' | 'cookies' | 'global_var'
   */
  source: 'localStorage' | 'sessionStorage' | 'cookies' | 'global_var';

  /**
   * BẮT BUỘC (Mục 6.2): Schema key hoặc regex pattern lọc dữ liệu.
   * TUYỆT ĐỐI KHÔNG dump toàn bộ storage ra LLM.
   */
  filter_pattern: string;

  /**
   * Tên biến global (chỉ dùng khi source = 'global_var')
   */
  global_var_name?: string;
}

/**
 * Action `deep_scan_local` — quét dữ liệu client-side không qua mạng.
 * - Quy tắc bắt buộc Mục 6.2: "PHẢI chỉ trả về giá trị khớp đúng pattern/schema định trước,
 *   TUYỆT ĐỐI KHÔNG trả nguyên dump toàn bộ cho LLM đọc".
 */
export class DeepScanLocalAction implements ActionPrimitive {
  readonly type = 'deep_scan_local';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const params = ctx.params as unknown as DeepScanLocalParams;

    if (!params || !params.source || !params.filter_pattern) {
      return {
        success: false,
        error: 'Missing required params: source, filter_pattern (Dump toàn bộ bị cấm theo Mục 6.2).',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    try {
      const scanResult = await ctx.browser.evaluate<{
        success: boolean;
        source: string;
        matched_entries: Record<string, unknown>;
        filtered_count: number;
        error?: string;
      }>(`
        (() => {
          try {
            const source = ${JSON.stringify(params.source)};
            const patternStr = ${JSON.stringify(params.filter_pattern)};
            const globalVarName = ${JSON.stringify(params.global_var_name || '')};
            const regex = new RegExp(patternStr, 'i');
            const matched = {};

            if (source === 'localStorage') {
              try {
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key && regex.test(key)) {
                    try {
                      matched[key] = JSON.parse(localStorage.getItem(key));
                    } catch {
                      matched[key] = localStorage.getItem(key);
                    }
                  }
                }
              } catch (storageErr) {
                if (window.__localStorageMock__) {
                  for (const [k, v] of Object.entries(window.__localStorageMock__)) {
                    if (regex.test(k)) matched[k] = v;
                  }
                } else {
                  throw storageErr;
                }
              }
            } else if (source === 'sessionStorage') {
              for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key && regex.test(key)) {
                  try {
                    matched[key] = JSON.parse(sessionStorage.getItem(key));
                  } catch {
                    matched[key] = sessionStorage.getItem(key);
                  }
                }
              }
            } else if (source === 'cookies') {
              const rawCookies = document.cookie ? document.cookie.split('; ') : [];
              for (const c of rawCookies) {
                const [k, ...vParts] = c.split('=');
                if (k && regex.test(k.trim())) {
                  matched[k.trim()] = decodeURIComponent(vParts.join('='));
                }
              }
            } else if (source === 'global_var') {
              if (globalVarName && window[globalVarName] !== undefined) {
                const val = window[globalVarName];
                if (typeof val === 'object' && val !== null) {
                  for (const [k, v] of Object.entries(val)) {
                    if (regex.test(k)) {
                      matched[k] = v;
                    }
                  }
                } else if (regex.test(globalVarName)) {
                  matched[globalVarName] = val;
                }
              }
            } else {
              throw new Error('Unsupported scan source: ' + source);
            }

            return {
              success: true,
              source,
              matched_entries: matched,
              filtered_count: Object.keys(matched).length,
            };
          } catch (err) {
            return {
              success: false,
              source: ${JSON.stringify(params.source)},
              matched_entries: {},
              filtered_count: 0,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })()
      `);

      if (!scanResult.success) {
        return {
          success: false,
          error: `Deep scan local failed: ${scanResult.error}`,
          used_fallback: false,
          duration_ms: Date.now() - start,
        };
      }

      return {
        success: true,
        data: scanResult.matched_entries,
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
// 3. CLICK COORDINATE ACTION (Mục 6.1 Tier 5 — Canvas/WebGL Coordinate Click)
// ============================================================================

export interface ClickCoordinateParams {
  /** Toạ độ X (pixels hoặc relative 0..1) */
  x: number;

  /** Toạ độ Y (pixels hoặc relative 0..1) */
  y: number;

  /**
   * Có phải toạ độ tương đối (0.0 đến 1.0) theo canvas/viewport không.
   * Mặc định là false (pixels tuyệt đối).
   */
  is_relative?: boolean;

  /** Selector của phần tử Canvas/WebGL đích (nếu có) */
  canvas_selector?: string;
}

/**
 * Action `click_coordinate` — Click theo toạ độ đối tượng.
 * - Dùng cho Tier 5 khi trang render bằng canvas / WebGL (không có DOM) hoặc DOM fail.
 * - Toạ độ tính từ vị trí đã biết của đối tượng trong game/app state (Mục 6.1 tier 5).
 */
export class ClickCoordinateAction implements ActionPrimitive {
  readonly type = 'click_coordinate';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const params = ctx.params as unknown as ClickCoordinateParams;

    if (params?.x === undefined || params?.y === undefined) {
      return {
        success: false,
        error: 'Missing required coordinate params: x, y',
        used_fallback: false,
        duration_ms: Date.now() - start,
      };
    }

    try {
      const clickResult = await ctx.browser.evaluate<{
        success: boolean;
        resolved_x: number;
        resolved_y: number;
        target_tag?: string;
        error?: string;
      }>(`
        (() => {
          try {
            const rawX = ${params.x};
            const rawY = ${params.y};
            const isRelative = ${Boolean(params.is_relative)};
            const canvasSelector = ${JSON.stringify(params.canvas_selector || '')};

            let targetX = rawX;
            let targetY = rawY;
            let targetEl = null;

            if (canvasSelector) {
              const canvas = document.querySelector(canvasSelector);
              if (canvas) {
                const rect = canvas.getBoundingClientRect();
                targetX = isRelative ? rect.left + rect.width * rawX : rect.left + rawX;
                targetY = isRelative ? rect.top + rect.height * rawY : rect.top + rawY;
                targetEl = canvas;
              }
            } else if (isRelative) {
              targetX = window.innerWidth * rawX;
              targetY = window.innerHeight * rawY;
            }

            // Tìm phần tử tại toạ độ
            if (!targetEl) {
              targetEl = document.elementFromPoint(targetX, targetY);
            }

            if (!targetEl) {
              return {
                success: false,
                resolved_x: targetX,
                resolved_y: targetY,
                error: 'No element found at coordinate (' + targetX + ', ' + targetY + ')',
              };
            }

            // Dispatch full mouse & pointer sequence
            const eventInit = {
              clientX: targetX,
              clientY: targetY,
              screenX: targetX,
              screenY: targetY,
              bubbles: true,
              cancelable: true,
              view: window,
            };

            targetEl.dispatchEvent(new PointerEvent('pointerdown', eventInit));
            targetEl.dispatchEvent(new MouseEvent('mousedown', eventInit));
            targetEl.dispatchEvent(new PointerEvent('pointerup', eventInit));
            targetEl.dispatchEvent(new MouseEvent('mouseup', eventInit));
            targetEl.dispatchEvent(new MouseEvent('click', eventInit));

            return {
              success: true,
              resolved_x: targetX,
              resolved_y: targetY,
              target_tag: targetEl.tagName.toLowerCase(),
            };
          } catch (err) {
            return {
              success: false,
              resolved_x: 0,
              resolved_y: 0,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        })()
      `);

      if (!clickResult.success) {
        return {
          success: false,
          error: `Coordinate click failed: ${clickResult.error}`,
          used_fallback: false,
          duration_ms: Date.now() - start,
        };
      }

      return {
        success: true,
        data: clickResult,
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
