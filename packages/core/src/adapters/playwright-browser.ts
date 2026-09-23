/**
 * Playwright Browser Adapter
 *
 * Cho phép chạy ExecutionEngine trên browser thật thông qua Playwright Page.
 * Rất hữu ích cho:
 * - End-to-end integration test
 * - Chạy headless trong CI hoặc CLI
 * - Tự động hoá không cần MCP server
 */

import type { Page } from 'playwright';
import type { BrowserAdapter } from '../actions/primitives.js';

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    // Playwright evaluates strings in browser context
    return await (this.page as unknown as { evaluate: (expr: string) => Promise<T> }).evaluate(expression);
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async waitFor(condition: string, timeoutMs: number = 10000): Promise<boolean> {
    try {
      // Thử xem condition là selector CSS hay JS expression
      if (condition.startsWith('(') || condition.includes('document.') || condition.includes('return')) {
        await this.page.waitForFunction(condition, { timeout: timeoutMs });
      } else {
        await this.page.waitForSelector(condition, { timeout: timeoutMs });
      }
      return true;
    } catch {
      return false;
    }
  }

  async screenshot(): Promise<Buffer> {
    return await this.page.screenshot();
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async getUrl(): Promise<string> {
    return this.page.url();
  }

  async currentTitle(): Promise<string> {
    return await this.page.title();
  }
}
