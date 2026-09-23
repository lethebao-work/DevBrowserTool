/**
 * Browser Adapters — Cầu nối giữa BrowserAdapter interface và browser thật.
 *
 * Hai implementation:
 * 1. McpBrowserAdapter: gọi MCP tools qua callable function (browser-mcp)
 * 2. CdpBrowserAdapter: gọi chrome-devtools MCP (cần pageId)
 *
 * Cả 2 đều implement cùng BrowserAdapter interface,
 * cho phép actions/engine chạy mà không biết backend nào đang dùng.
 */

import type { BrowserAdapter } from '../actions/primitives.js';

// ============================================================================
// MCP CALL INTERFACE
// ============================================================================

/**
 * Interface cho việc gọi MCP tool.
 * Người dùng inject implementation tuỳ theo runtime:
 * - Trong VS Code Extension: gọi qua VS Code MCP client
 * - Trong test: mock
 * - Trong CLI: gọi qua MCP client SDK (e.g. @anthropic-ai/sdk)
 */
export interface McpCaller {
  /**
   * Gọi 1 MCP tool và trả về kết quả.
   * @param serverName - Tên MCP server (e.g. 'browser-mcp', 'chrome-devtools')
   * @param toolName - Tên tool (e.g. 'browser_execute_script')
   * @param args - Arguments cho tool
   * @returns Kết quả trả về từ MCP tool (dạng string hoặc parsed)
   */
  call(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

// ============================================================================
// BROWSER-MCP ADAPTER
// ============================================================================

/**
 * BrowserAdapter implementation dùng browser-mcp MCP server.
 *
 * Mapping:
 * - evaluate() → browser_execute_script (code param)
 * - navigate() → browser_navigate (url param)
 * - waitFor() → browser_wait (selector/timeout) + browser_execute_script
 * - screenshot() → browser_screenshot
 * - currentUrl() → browser_execute_script("window.location.href")
 * - currentTitle() → browser_execute_script("document.title")
 */
export class McpBrowserAdapter implements BrowserAdapter {
  private readonly mcp: McpCaller;

  constructor(mcp: McpCaller) {
    this.mcp = mcp;
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const rawResult = await this.mcp.call('browser-mcp', 'browser_execute_script', {
      code: expression,
    });

    // browser-mcp returns { result: ..., method: "..." }
    let result = rawResult;
    if (typeof rawResult === 'object' && rawResult !== null && 'result' in rawResult) {
      result = (rawResult as { result: unknown }).result;
    }

    // browser-mcp might return a JSON string
    if (typeof result === 'string') {
      try {
        return JSON.parse(result) as T;
      } catch {
        return result as unknown as T;
      }
    }

    return result as T;
  }

  async navigate(url: string): Promise<void> {
    await this.mcp.call('browser-mcp', 'browser_navigate', { url });
  }

  async waitFor(condition: string, timeoutMs: number = 10000): Promise<boolean> {
    // Dùng browser_wait với timeout, rồi evaluate condition
    try {
      await this.mcp.call('browser-mcp', 'browser_wait', {
        time: Math.min(timeoutMs, 5000), // Wait tối đa 5s per call
      });

      const result = await this.evaluate<boolean>(condition);
      return result === true;
    } catch {
      return false;
    }
  }

  async screenshot(): Promise<Buffer> {
    const result = await this.mcp.call('browser-mcp', 'browser_screenshot', {});

    // browser-mcp trả về base64 PNG
    if (typeof result === 'string') {
      // Loại bỏ data URL prefix nếu có
      const base64 = result.replace(/^data:image\/\w+;base64,/, '');
      return Buffer.from(base64, 'base64');
    }

    return Buffer.from('');
  }

  async currentUrl(): Promise<string> {
    return await this.evaluate<string>('window.location.href');
  }

  async currentTitle(): Promise<string> {
    return await this.evaluate<string>('document.title');
  }
}

// ============================================================================
// CHROME-DEVTOOLS MCP ADAPTER
// ============================================================================

/**
 * BrowserAdapter implementation dùng chrome-devtools MCP server.
 * Cần pageId để target đúng page.
 *
 * Mapping:
 * - evaluate() → evaluate_script (function param, pageId)
 * - navigate() → navigate_page (url, type:'url', pageId)
 * - waitFor() → wait_for (selector, pageId)
 * - screenshot() → take_screenshot (pageId)
 * - currentUrl() → evaluate_script("() => window.location.href")
 * - currentTitle() → evaluate_script("() => document.title")
 */
export class CdpBrowserAdapter implements BrowserAdapter {
  private readonly mcp: McpCaller;
  private readonly pageId: number;

  constructor(mcp: McpCaller, pageId: number) {
    this.mcp = mcp;
    this.pageId = pageId;
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    // chrome-devtools evaluate_script yêu cầu function declaration, không phải expression
    // Bọc expression trong arrow function
    const wrappedFunction = `() => (${expression})`;

    const rawResult = await this.mcp.call('chrome-devtools', 'evaluate_script', {
      pageId: this.pageId,
      function: wrappedFunction,
      waitForStableDom: false, // Chỉ đọc data, không đợi DOM settle
    });

    let result = rawResult;
    if (typeof rawResult === 'object' && rawResult !== null && 'result' in rawResult) {
      result = (rawResult as { result: unknown }).result;
    }

    if (typeof result === 'string') {
      try {
        return JSON.parse(result) as T;
      } catch {
        return result as unknown as T;
      }
    }

    return result as T;
  }

  async navigate(url: string): Promise<void> {
    await this.mcp.call('chrome-devtools', 'navigate_page', {
      pageId: this.pageId,
      url,
      type: 'url',
    });
  }

  async waitFor(condition: string, timeoutMs: number = 10000): Promise<boolean> {
    try {
      // chrome-devtools có wait_for tool
      await this.mcp.call('chrome-devtools', 'wait_for', {
        pageId: this.pageId,
        selector: condition, // Simplified — cần map condition type
        timeout: timeoutMs,
      });
      return true;
    } catch {
      return false;
    }
  }

  async screenshot(): Promise<Buffer> {
    const result = await this.mcp.call('chrome-devtools', 'take_screenshot', {
      pageId: this.pageId,
    });

    if (typeof result === 'string') {
      const base64 = result.replace(/^data:image\/\w+;base64,/, '');
      return Buffer.from(base64, 'base64');
    }

    return Buffer.from('');
  }

  async currentUrl(): Promise<string> {
    return await this.evaluate<string>('window.location.href');
  }

  async currentTitle(): Promise<string> {
    return await this.evaluate<string>('document.title');
  }
}
