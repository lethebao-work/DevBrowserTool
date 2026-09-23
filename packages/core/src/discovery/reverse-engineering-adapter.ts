/**
 * Reverse-Engineering Abstraction & Drivers (Mục 3.5)
 *
 * Cung cấp kiến trúc trừu tượng (Adapter Pattern) cho các công cụ dịch ngược:
 * 1. Interface `IReverseEngineeringAdapter` độc lập với môi trường.
 * 2. `CdpReverseEngineeringAdapter`: Built-in backend dựa trên Chrome DevTools Protocol / Browser evaluate.
 *    - Giải mã escape sequences cơ bản (Hex `\\x61`, Unicode `\\u0061`).
 *    - Nhận diện các kỹ thuật obfuscation nặng (String Array Rotation, Control Flow Flattening, RC4 Cipher).
 *    - Báo cờ `requiresSpecializedMcp = true` và lối thoát rõ ràng khi gặp obfuscation thật thay vì thất bại im lặng.
 * 3. `McpReverseEngineeringAdapter`: Bridge kết nối tới external MCP servers (`jsreverser-mcp`, `jshookmcp`)
 *    khi môi trường có sẵn.
 */

import type { BrowserAdapter } from '../actions/primitives.js';

export interface DeobfuscateResult {
  originalLength: number;
  deobfuscatedCode: string;
  decodedEscapeSequencesCount: number;
  detectedObfuscations: string[];
  isHeavyObfuscationDetected: boolean;
  unsupportedHeavyFeatures: string[];
  requiresSpecializedMcp: boolean;
  recommendation: 'builtin_sufficient' | 'delegate_to_mcp_or_halt';
}

export interface CallGraphAnalysis {
  target: string;
  found: boolean;
  callers: string[];
  callees: string[];
  isNative: boolean;
}

export interface RuntimeHookResult {
  success: boolean;
  hookId: string;
  target: string;
  error?: string;
}

export interface IReverseEngineeringAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;

  /**
   * Giải mã ký tự escape cơ bản và nhận diện mẫu làm mờ nặng (Mục 3.5).
   */
  deobfuscate(code: string): Promise<DeobfuscateResult>;

  /**
   * Phân tích đồ thị gọi hàm (Call Graph) quanh hàm mục tiêu.
   */
  analyzeCallGraph(browser: BrowserAdapter, targetFunction: string): Promise<CallGraphAnalysis>;

  /**
   * Hook một hàm runtime để theo dõi arguments và return value.
   */
  injectHook(browser: BrowserAdapter, targetFunction: string, hookId: string): Promise<RuntimeHookResult>;

  /**
   * Đọc giá trị memory/state của biến hoặc object nội bộ trên runtime.
   */
  inspectMemoryState(browser: BrowserAdapter, objectPath: string): Promise<{ exists: boolean; value?: any; type: string }>;
}

/**
 * Built-in CDP Reverse Engineering Adapter
 * Dùng trực tiếp BrowserAdapter evaluate trên trình duyệt Chromium.
 * Nhận biết chính xác giới hạn: chỉ giải mã escape sequence, nhận diện và báo cờ khi gặp obfuscation nặng.
 */
export class CdpReverseEngineeringAdapter implements IReverseEngineeringAdapter {
  readonly name = 'builtin-cdp-reverser';

  async isAvailable(): Promise<boolean> {
    return true; // Luôn sẵn sàng vì dùng runtime browser có sẵn
  }

  async deobfuscate(code: string): Promise<DeobfuscateResult> {
    let deobfuscatedCode = code;
    let decodedEscapeSequencesCount = 0;
    const detectedObfuscations: string[] = [];
    const unsupportedHeavyFeatures: string[] = [];

    // 1. Giải mã hex string escape sequences thông thường: \x61\x62\x63 -> 'abc'
    const hexPattern = /(?:\\x[0-9a-fA-F]{2})+/g;
    if (hexPattern.test(code)) {
      detectedObfuscations.push('hex_escape_sequences');
      deobfuscatedCode = deobfuscatedCode.replace(hexPattern, (match) => {
        decodedEscapeSequencesCount++;
        try {
          return match
            .split('\\x')
            .filter(Boolean)
            .map((h) => String.fromCharCode(parseInt(h, 16)))
            .join('');
        } catch {
          return match;
        }
      });
    }

    // 2. Giải mã unicode escape sequences: \u0061\u0062 -> 'ab'
    const unicodePattern = /(?:\\u[0-9a-fA-F]{4})+/g;
    if (unicodePattern.test(code)) {
      detectedObfuscations.push('unicode_escape_sequences');
      deobfuscatedCode = deobfuscatedCode.replace(unicodePattern, (match) => {
        decodedEscapeSequencesCount++;
        try {
          return match
            .split('\\u')
            .filter(Boolean)
            .map((u) => String.fromCharCode(parseInt(u, 16)))
            .join('');
        } catch {
          return match;
        }
      });
    }

    // 3. NHẬN DIỆN OBFUSCATION NẶNG THỰC TẾ (RC4, String Array Rotation, Control Flow Flattening)
    // Các kỹ thuật này vượt quá khả năng giải mã regex cục bộ, bắt buộc cần AST transform hoặc MCP chuyên biệt.
    if (/_0x[a-f0-9]{4,}\s*\[/i.test(code) || /var\s+_0x[a-f0-9]+\s*=\s*\[/.test(code)) {
      detectedObfuscations.push('string_array_rotation');
      unsupportedHeavyFeatures.push('string_array_rotation');
    }

    if (/switch\s*\(\s*_0x[a-f0-9]+\s*\[|while\s*\(\s*!!\[\]\s*\)/i.test(code)) {
      detectedObfuscations.push('control_flow_flattening');
      unsupportedHeavyFeatures.push('control_flow_flattening');
    }

    if (/rc4|cipher|fromCharCode\s*\(\s*\w+\s*\^\s*\w+\s*\)/i.test(code) && /_0x[a-f0-9]+/.test(code)) {
      detectedObfuscations.push('rc4_payload_cipher');
      unsupportedHeavyFeatures.push('rc4_payload_cipher');
    }

    const isHeavyObfuscationDetected = unsupportedHeavyFeatures.length > 0;
    const requiresSpecializedMcp = isHeavyObfuscationDetected;
    const recommendation: 'builtin_sufficient' | 'delegate_to_mcp_or_halt' = isHeavyObfuscationDetected
      ? 'delegate_to_mcp_or_halt'
      : 'builtin_sufficient';

    return {
      originalLength: code.length,
      deobfuscatedCode,
      decodedEscapeSequencesCount,
      detectedObfuscations,
      isHeavyObfuscationDetected,
      unsupportedHeavyFeatures,
      requiresSpecializedMcp,
      recommendation,
    };
  }

  async analyzeCallGraph(browser: BrowserAdapter, targetFunction: string): Promise<CallGraphAnalysis> {
    try {
      const result = await browser.evaluate<CallGraphAnalysis>(`
        (() => {
          try {
            const parts = '${targetFunction}'.split('.');
            let obj = window;
            for (let i = 0; i < parts.length - 1; i++) {
              obj = obj[parts[i]];
              if (!obj) return { target: '${targetFunction}', found: false, callers: [], callees: [], isNative: false };
            }
            const fn = obj[parts[parts.length - 1]];
            if (typeof fn !== 'function') {
              return { target: '${targetFunction}', found: false, callers: [], callees: [], isNative: false };
            }

            const fnStr = Function.prototype.toString.call(fn);
            const isNative = fnStr.includes('[native code]');

            const callees = [];
            if (!isNative) {
              const matches = fnStr.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(/g);
              for (const m of matches) {
                if (m[1] && m[1] !== 'function' && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while') {
                  callees.push(m[1]);
                }
              }
            }

            return {
              target: '${targetFunction}',
              found: true,
              callers: [],
              callees: Array.from(new Set(callees)).slice(0, 20),
              isNative,
            };
          } catch {
            return { target: '${targetFunction}', found: false, callers: [], callees: [], isNative: false };
          }
        })()
      `);

      return result || { target: targetFunction, found: false, callers: [], callees: [], isNative: false };
    } catch {
      return { target: targetFunction, found: false, callers: [], callees: [], isNative: false };
    }
  }

  async injectHook(browser: BrowserAdapter, targetFunction: string, hookId: string): Promise<RuntimeHookResult> {
    try {
      const res = await browser.evaluate<{ success: boolean; error?: string }>(`
        (() => {
          try {
            window.__devBrowserTool_hooks__ = window.__devBrowserTool_hooks__ || {};
            window.__devBrowserTool_hooks_calls__ = window.__devBrowserTool_hooks_calls__ || {};

            const parts = '${targetFunction}'.split('.');
            let obj = window;
            for (let i = 0; i < parts.length - 1; i++) {
              obj = obj[parts[i]];
              if (!obj) return { success: false, error: 'Target path not found: ' + parts.slice(0, i + 1).join('.') };
            }
            const prop = parts[parts.length - 1];
            const originalFn = obj[prop];
            if (typeof originalFn !== 'function') {
              return { success: false, error: 'Target is not a function: ' + '${targetFunction}' };
            }

            window.__devBrowserTool_hooks__['${hookId}'] = originalFn;
            window.__devBrowserTool_hooks_calls__['${hookId}'] = [];

            obj[prop] = function(...args) {
              window.__devBrowserTool_hooks_calls__['${hookId}'].push({
                timestamp: Date.now(),
                argsSummary: args.map(a => typeof a === 'object' ? JSON.stringify(a).slice(0, 100) : String(a)),
              });
              return originalFn.apply(this, args);
            };

            return { success: true };
          } catch (err) {
            return { success: false, error: String(err) };
          }
        })()
      `);

      return {
        success: Boolean(res?.success),
        hookId,
        target: targetFunction,
        error: res?.error,
      };
    } catch (err) {
      return {
        success: false,
        hookId,
        target: targetFunction,
        error: String(err),
      };
    }
  }

  async inspectMemoryState(browser: BrowserAdapter, objectPath: string): Promise<{ exists: boolean; value?: any; type: string }> {
    try {
      return await browser.evaluate(`
        (() => {
          try {
            const parts = '${objectPath}'.split('.');
            let curr = window;
            for (const p of parts) {
              if (curr == null) return { exists: false, type: 'undefined' };
              curr = curr[p];
            }
            if (curr === undefined) return { exists: false, type: 'undefined' };
            const type = typeof curr;
            return {
              exists: true,
              type,
              value: type === 'function' ? '[Function: ' + (curr.name || 'anonymous') + ']' : curr,
            };
          } catch (e) {
            return { exists: false, type: 'error' };
          }
        })()
      `);
    } catch {
      return { exists: false, type: 'error' };
    }
  }
}

/**
 * MCP Reverse Engineering Adapter — Cầu nối ngoại vi tới jsreverser-mcp hoặc jshookmcp
 */
export class McpReverseEngineeringAdapter implements IReverseEngineeringAdapter {
  readonly name = 'mcp-reverse-engineering-bridge';
  private fallbackAdapter: CdpReverseEngineeringAdapter;

  constructor(
    private callMcpToolFn?: (server: string, tool: string, args: any) => Promise<any>,
  ) {
    this.fallbackAdapter = new CdpReverseEngineeringAdapter();
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.callMcpToolFn);
  }

  async deobfuscate(code: string): Promise<DeobfuscateResult> {
    if (this.callMcpToolFn) {
      try {
        const res = await this.callMcpToolFn('jsreverser-mcp', 'deobfuscate_script', { source_code: code });
        if (res && res.deobfuscatedCode) {
          return {
            originalLength: code.length,
            deobfuscatedCode: res.deobfuscatedCode,
            decodedEscapeSequencesCount: res.decodedStringsCount || 0,
            detectedObfuscations: res.detectedObfuscations || ['advanced_ast_deobfuscation'],
            isHeavyObfuscationDetected: true,
            unsupportedHeavyFeatures: [],
            requiresSpecializedMcp: false, // Vì MCP đã xử lý thành công
            recommendation: 'builtin_sufficient',
          };
        }
      } catch {
        // Fallback về CDP built-in khi MCP tool không phản hồi
      }
    }
    return this.fallbackAdapter.deobfuscate(code);
  }

  async analyzeCallGraph(browser: BrowserAdapter, targetFunction: string): Promise<CallGraphAnalysis> {
    return this.fallbackAdapter.analyzeCallGraph(browser, targetFunction);
  }

  async injectHook(browser: BrowserAdapter, targetFunction: string, hookId: string): Promise<RuntimeHookResult> {
    return this.fallbackAdapter.injectHook(browser, targetFunction, hookId);
  }

  async inspectMemoryState(browser: BrowserAdapter, objectPath: string): Promise<{ exists: boolean; value?: any; type: string }> {
    return this.fallbackAdapter.inspectMemoryState(browser, objectPath);
  }
}
