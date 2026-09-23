import { describe, it, expect, vi } from 'vitest';
import {
  McpBrowserAdapter,
  CdpBrowserAdapter,
  type McpCaller,
} from '../src/adapters/mcp-browser.js';

describe('Browser Adapters', () => {
  describe('McpBrowserAdapter (browser-mcp)', () => {
    it('should call browser_execute_script on evaluate()', async () => {
      const mockCaller: McpCaller = {
        call: vi.fn().mockResolvedValue('{"status": "ok"}'),
      };
      const adapter = new McpBrowserAdapter(mockCaller);

      const result = await adapter.evaluate<{ status: string }>('window.__test');

      expect(mockCaller.call).toHaveBeenCalledWith(
        'browser-mcp',
        'browser_execute_script',
        { code: 'window.__test' }
      );
      expect(result).toEqual({ status: 'ok' });
    });

    it('should return raw string if not JSON on evaluate()', async () => {
      const mockCaller: McpCaller = {
        call: vi.fn().mockResolvedValue('plain text'),
      };
      const adapter = new McpBrowserAdapter(mockCaller);

      const result = await adapter.evaluate<string>('document.title');
      expect(result).toBe('plain text');
    });

    it('should call browser_navigate on navigate()', async () => {
      const mockCaller: McpCaller = {
        call: vi.fn().mockResolvedValue(true),
      };
      const adapter = new McpBrowserAdapter(mockCaller);

      await adapter.navigate('https://example.com');

      expect(mockCaller.call).toHaveBeenCalledWith(
        'browser-mcp',
        'browser_navigate',
        { url: 'https://example.com' }
      );
    });

    it('should call browser_screenshot and parse base64 on screenshot()', async () => {
      const sampleBase64 = Buffer.from('fake-image-data').toString('base64');
      const mockCaller: McpCaller = {
        call: vi.fn().mockResolvedValue(`data:image/png;base64,${sampleBase64}`),
      };
      const adapter = new McpBrowserAdapter(mockCaller);

      const buffer = await adapter.screenshot();

      expect(mockCaller.call).toHaveBeenCalledWith(
        'browser-mcp',
        'browser_screenshot',
        {}
      );
      expect(buffer.toString('utf-8')).toBe('fake-image-data');
    });

    it('should get currentUrl and currentTitle via evaluate', async () => {
      const mockCaller: McpCaller = {
        call: vi.fn().mockImplementation((_server, _tool, args: { code: string }) => {
          if (args.code === 'window.location.href') return Promise.resolve('https://example.com/page');
          if (args.code === 'document.title') return Promise.resolve('Example Domain');
          return Promise.resolve(null);
        }),
      };
      const adapter = new McpBrowserAdapter(mockCaller);

      const url = await adapter.currentUrl();
      const title = await adapter.currentTitle();

      expect(url).toBe('https://example.com/page');
      expect(title).toBe('Example Domain');
    });
  });

  describe('CdpBrowserAdapter (chrome-devtools)', () => {
    const PAGE_ID = 42;

    it('should wrap expression in arrow function for evaluate_script', async () => {
      const mockCaller: McpCaller = {
        call: vi.fn().mockResolvedValue('{"count": 5}'),
      };
      const adapter = new CdpBrowserAdapter(mockCaller, PAGE_ID);

      const result = await adapter.evaluate<{ count: number }>('document.querySelectorAll("a").length');

      expect(mockCaller.call).toHaveBeenCalledWith(
        'chrome-devtools',
        'evaluate_script',
        {
          pageId: PAGE_ID,
          function: '() => (document.querySelectorAll("a").length)',
          waitForStableDom: false,
        }
      );
      expect(result).toEqual({ count: 5 });
    });

    it('should call navigate_page with pageId on navigate()', async () => {
      const mockCaller: McpCaller = {
        call: vi.fn().mockResolvedValue(true),
      };
      const adapter = new CdpBrowserAdapter(mockCaller, PAGE_ID);

      await adapter.navigate('https://example.com');

      expect(mockCaller.call).toHaveBeenCalledWith(
        'chrome-devtools',
        'navigate_page',
        {
          pageId: PAGE_ID,
          url: 'https://example.com',
          type: 'url',
        }
      );
    });

    it('should call take_screenshot with pageId on screenshot()', async () => {
      const sampleBase64 = Buffer.from('cdp-screenshot-data').toString('base64');
      const mockCaller: McpCaller = {
        call: vi.fn().mockResolvedValue(sampleBase64),
      };
      const adapter = new CdpBrowserAdapter(mockCaller, PAGE_ID);

      const buffer = await adapter.screenshot();

      expect(mockCaller.call).toHaveBeenCalledWith(
        'chrome-devtools',
        'take_screenshot',
        { pageId: PAGE_ID }
      );
      expect(buffer.toString('utf-8')).toBe('cdp-screenshot-data');
    });

    it('should call wait_for on waitFor()', async () => {
      const mockCaller: McpCaller = {
        call: vi.fn().mockResolvedValue(true),
      };
      const adapter = new CdpBrowserAdapter(mockCaller, PAGE_ID);

      const success = await adapter.waitFor('#submit-btn', 5000);

      expect(mockCaller.call).toHaveBeenCalledWith(
        'chrome-devtools',
        'wait_for',
        {
          pageId: PAGE_ID,
          selector: '#submit-btn',
          timeout: 5000,
        }
      );
      expect(success).toBe(true);
    });
  });
});
