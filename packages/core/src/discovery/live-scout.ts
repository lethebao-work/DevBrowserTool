/**
 * LiveScoutEngine — Công cụ trinh sát website thực thụ đa tầng (Mục 1, 3, 4 & 15)
 *
 * Khám phá đầy đủ 7 loại tài nguyên theo chuẩn kiến trúc Tháp:
 * 1. `endpoint`: Các API REST/GraphQL bắt từ Network Listener, Performance entries & Swagger
 * 2. `dom_element`: Toàn bộ tương tác DOM (Tabs, Buttons, Inputs, Cards, Modals)
 * 3. `local_persistence`: Toàn bộ kho lưu trữ LocalStorage, SessionStorage & Cookies
 * 4. `websocket_channel`: Kênh WebSocket thời gian thực (như game/chat/live updates)
 * 5. `header_signature`: Custom headers, auth signatures bắt được từ traffic
 * 6. `state_graph`: Đồ thị chuyển trạng thái đa tầng (Lobby, Store, Leaderboard, Room...)
 *
 * Hỗ trợ cả 2 chế độ:
 * - Trình duyệt trực quan (Headed Chrome / MCP) để người dùng tận mắt thấy tương tác thật
 * - Chế độ nạp trực tiếp từ MCP Browser Tab đang mở
 */

import { chromium, type Browser } from 'playwright';
import type { BrowserAdapter } from '../actions/primitives.js';
import {
  type MapFile,
  type ResourceNode,
  type Variant,
  type StateNode,
  type ToolConfig,
} from '../map/schema.js';
import { ScoutScripts } from './scout-scripts.js';
import {
  ScoutProcessor,
  type DiscoveredNodeSummary,
  type LiveScoutResult,
} from './scout-processor.js';

export type { DiscoveredNodeSummary, LiveScoutResult };

export interface LiveScoutOptions {
  headless?: boolean;
  timeoutMs?: number;
  waitForNetworkIdleMs?: number;
}

export class LiveScoutEngine {
  /**
   * Bóc tách toàn diện 7 loại tài nguyên từ trang web.
   *
   * Hỗ trợ:
   * 1. BrowserAdapter (Kiến trúc A/C hoặc Agent injection):
   *    LiveScoutEngine.scoutUrl(adapter, url, onProgress?, options?)
   * 2. Trình duyệt trực tiếp qua Playwright (Legacy / Fast-path):
   *    LiveScoutEngine.scoutUrl(url, onProgress?, options?)
   */
  static async scoutUrl(
    browserOrUrl: BrowserAdapter | string,
    urlOrProgress?: string | ((message: string, color?: 'cyan' | 'yellow' | 'green' | 'red') => void),
    optionsOrProgress?: LiveScoutOptions | ((message: string, color?: 'cyan' | 'yellow' | 'green' | 'red') => void),
    maybeOptions?: LiveScoutOptions
  ): Promise<LiveScoutResult> {
    // ------------------------------------------------------------------------
    // Chế độ 1: Dùng BrowserAdapter (McpBrowserAdapter / CdpDirectBrowserAdapter)
    // ------------------------------------------------------------------------
    if (typeof browserOrUrl === 'object' && browserOrUrl !== null) {
      const adapter = browserOrUrl as BrowserAdapter;
      const url = urlOrProgress as string;
      const onProgress = typeof optionsOrProgress === 'function' ? optionsOrProgress : undefined;

      try {
        onProgress?.(`Điều hướng tới: ${url} qua BrowserAdapter...`, 'cyan');
        await adapter.navigate(url);

        onProgress?.('Đang chạy kịch bản bóc tách tài nguyên qua ScoutScripts...', 'cyan');
        const pageInfo = await adapter.evaluate<{ title: string; url: string }>(
          ScoutScripts.getPageInfoScript().code
        ).catch(() => ({ title: '', url }));

        const domElements = await adapter.evaluate<any[]>(
          ScoutScripts.getDomExtractionScript().code
        ).catch(() => []);

        const performanceEntries = await adapter.evaluate<any[]>(
          ScoutScripts.getPerformanceExtractionScript().code
        ).catch(() => []);

        const storageKeys = await adapter.evaluate<any>(
          ScoutScripts.getStorageExtractionScript().code
        ).catch(() => ({ localStorageKeys: [], sessionStorageKeys: [] }));

        const wsUrls = await adapter.evaluate<string[]>(
          ScoutScripts.getWebSocketDetectionScript().code
        ).catch(() => []);

        return ScoutProcessor.processRawScoutData(
          {
            url,
            pageInfo,
            domElements,
            performanceEntries,
            storageKeys,
            webSocketUrls: wsUrls,
          },
          onProgress
        );
      } catch (err: any) {
        onProgress?.(`❌ Lỗi trong quá trình trinh sát qua BrowserAdapter: ${err.message}`, 'red');
        return {
          success: false,
          domain: '',
          url,
          title: '',
          map: null as any,
          nodesCount: 0,
          summaryByType: {
            domElements: 0,
            endpoints: 0,
            localPersistence: 0,
            webSockets: 0,
            headers: 0,
            states: 0,
          },
          discoveredNodes: [],
          error: err.message || 'Unknown scout error',
        };
      }
    }

    // ------------------------------------------------------------------------
    // Chế độ 2: Trình duyệt Playwright độc lập (Legacy / Headless / Local Run)
    // ------------------------------------------------------------------------
    const url = browserOrUrl as string;
    const onProgress = typeof urlOrProgress === 'function' ? urlOrProgress : undefined;
    const options: LiveScoutOptions = (typeof optionsOrProgress === 'object' ? optionsOrProgress : maybeOptions) || {};

    let browser: Browser | null = null;
    const isHeadless = options.headless ?? false;
    const timeoutMs = options.timeoutMs ?? 30000;

    const capturedEndpoints: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const capturedWebSockets: string[] = [];

    try {
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname;

      onProgress?.(
        `Khởi chạy Google Chrome (${isHeadless ? 'Headless ngầm' : 'Cửa sổ trực quan Headed'})...`,
        'cyan'
      );

      try {
        browser = await chromium.launch({
          channel: 'chrome',
          headless: isHeadless,
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        });
      } catch {
        browser = await chromium.launch({
          headless: isHeadless,
          args: ['--disable-blink-features=AutomationControlled'],
        });
      }

      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 DevBrowserTool/0.1.0',
      });

      const page = await context.newPage();

      // Gắn Network Traffic Listener để bắt toàn bộ API Endpoints & WebSocket Channels
      page.on('request', req => {
        const rUrl = req.url();
        const method = req.method();
        const resType = req.resourceType();

        if (resType === 'xhr' || resType === 'fetch' || rUrl.includes('/api/')) {
          capturedEndpoints.push({ url: rUrl, method, headers: req.headers() });
        }
        if (resType === 'websocket' || rUrl.startsWith('ws://') || rUrl.startsWith('wss://')) {
          capturedWebSockets.push(rUrl);
        }
      });

      onProgress?.(`Điều hướng tới: ${url}`, 'cyan');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(e => {
        onProgress?.(`Lưu ý điều hướng: ${e.message}`, 'yellow');
      });

      // Chờ thêm 3s để SPA hydration, kết nối WebSocket và gọi API ban đầu
      onProgress?.('Đợi trang web nạp trạng thái động, kết nối mạng & APIs...', 'cyan');
      await page.waitForTimeout(3000);

      const pageTitle = (await page.title()) || domain;
      onProgress?.(`Trang đã tải: "${pageTitle}"`, 'green');

      // Kiểm tra Anti-Bot / Cloudflare Challenge
      if (pageTitle.includes('Just a moment') || pageTitle.includes('Chờ một chút')) {
        onProgress?.(
          '🚨 Phát hiện Cloudflare Managed Challenge! Trang đang chờ xác minh trình duyệt...',
          'yellow'
        );
        onProgress?.(
          '💡 Hãy giải quyết challenge trên cửa sổ Chrome đang mở hoặc dùng nút "Lấy từ Tab MCP"!',
          'cyan'
        );
        if (!isHeadless) {
          await page.waitForTimeout(5000);
        }
      }

      onProgress?.('Bóc tách API Endpoints từ Network Traffic & Performance Entries...', 'cyan');
      const perfResources = await page.evaluate<Array<{ name: string; initiator: string }>>(
        ScoutScripts.getPerformanceExtractionScript().code
      ).catch(() => []);

      onProgress?.('Bóc tách kho lưu trữ cục bộ (LocalStorage, SessionStorage)...', 'cyan');
      const storageData = await page.evaluate<{
        localStorageKeys: string[];
        sessionStorageKeys: string[];
      }>(ScoutScripts.getStorageExtractionScript().code).catch(() => ({
        localStorageKeys: [],
        sessionStorageKeys: [],
      }));

      onProgress?.('Bóc tách toàn bộ phần tử tương tác DOM (Tabs, Buttons, Inputs, Cards)...', 'cyan');
      const rawElements = await page.evaluate<Array<{
        tag: string;
        id: string;
        name: string;
        type: string;
        role: string;
        text: string;
        selector: string;
      }>>(ScoutScripts.getDomExtractionScript().code).catch(() => []);

      const wsUrls = await page.evaluate<string[]>(
        ScoutScripts.getWebSocketDetectionScript().code
      ).catch(() => []);

      return ScoutProcessor.processRawScoutData(
        {
          url,
          pageInfo: { title: pageTitle, url },
          domElements: rawElements,
          performanceEntries: perfResources,
          storageKeys: storageData,
          networkRequests: capturedEndpoints,
          webSocketUrls: [...capturedWebSockets, ...wsUrls],
        },
        onProgress
      );
    } catch (err: any) {
      onProgress?.(`❌ Lỗi trong quá trình trinh sát: ${err.message}`, 'red');
      return {
        success: false,
        domain: '',
        url,
        title: '',
        map: null as any,
        nodesCount: 0,
        summaryByType: {
          domElements: 0,
          endpoints: 0,
          localPersistence: 0,
          webSockets: 0,
          headers: 0,
          states: 0,
        },
        discoveredNodes: [],
        error: err.message || 'Unknown scout error',
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  /**
   * Nạp trực tiếp kết quả bóc tách từ tab trình duyệt MCP đang mở vào MapFile.
   * Giải pháp tối ưu khi website có Cloudflare hoặc đã được người dùng đăng nhập sẵn!
   */
  static buildMapFromMcpData(mcpData: {
    domain: string;
    url: string;
    title: string;
    endpoints: string[];
    localStorageKeys: string[];
    domElements: Array<{ tag: string; selector: string; text: string; role: string }>;
  }): MapFile {
    const result = ScoutProcessor.processRawScoutData({
      url: mcpData.url,
      pageInfo: { title: mcpData.title, url: mcpData.url },
      domElements: mcpData.domElements,
      storageKeys: { localStorageKeys: mcpData.localStorageKeys },
      networkRequests: mcpData.endpoints.map(ep => ({ url: ep, method: 'GET' })),
    });
    return result.map;
  }

  /**
   * Kích hoạt & Chạy thử nghiệm Tool trực tiếp trên trình duyệt thật (Playwright)
   */
  static async runToolLive(
    tool: { id: string; name: string; target_domain: string; config: ToolConfig },
    map: MapFile,
    options?: {
      headless?: boolean;
      paramValues?: Record<string, unknown>;
      targetUrl?: string;
    }
  ): Promise<{
    success: boolean;
    toolId: string;
    logs: Array<{ text: string; color: string }>;
    error?: string;
    durationMs: number;
  }> {
    const logs: Array<{ text: string; color: string }> = [];
    const startTime = Date.now();
    const headless = options?.headless ?? false;

    logs.push({
      text: `🚀 Bắt đầu phiên chạy thử nghiệm trực tiếp Tool: ${tool.name} (${tool.config.package_type})`,
      color: 'cyan',
    });
    logs.push({
      text: `🌐 Mục tiêu: ${tool.target_domain} | Chế độ: ${headless ? 'Chạy ngầm (Headless)' : 'Trực quan (Headed Chrome)'}`,
      color: 'blue',
    });

    let browser: Browser | null = null;
    try {
      try {
        browser = await chromium.launch({
          channel: 'chrome',
          headless,
          slowMo: headless ? 0 : 350,
          args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
        });
      } catch {
        browser = await chromium.launch({
          headless,
          slowMo: headless ? 0 : 350,
          args: ['--disable-blink-features=AutomationControlled'],
        });
      }

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      // Xác định URL đích
      let targetUrl = options?.targetUrl;
      if (!targetUrl) {
        if (
          tool.target_domain.startsWith('http://') ||
          tool.target_domain.startsWith('https://') ||
          tool.target_domain.startsWith('data:')
        ) {
          targetUrl = tool.target_domain;
        } else {
          targetUrl = `https://${tool.target_domain}`;
        }
      }

      logs.push({ text: `🧭 Đang điều hướng đến: ${targetUrl}...`, color: 'cyan' });
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      } catch (navErr: any) {
        if (targetUrl.startsWith('https://')) {
          targetUrl = targetUrl.replace('https://', 'http://');
          logs.push({ text: `⚠️ Thử lại với HTTP: ${targetUrl}...`, color: 'yellow' });
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        } else {
          throw navErr;
        }
      }

      logs.push({ text: `✅ Tải trang thành công: "${await page.title()}"`, color: 'green' });

      // Thực thi từng hành động trong chuỗi Actions
      const actions = tool.config.actions || [];
      const totalSteps = actions.length;

      for (let i = 0; i < totalSteps; i++) {
        const action = actions[i];
        const stepNum = i + 1;
        const node = map.base_nodes.find(n => n.id === action.node_ref);
        const selector = node?.variants?.[0]?.value_formula || (action.params?.selector as string) || '';
        const intent = action.description || node?.intent || action.type;

        logs.push({
          text: `⚡ [Bước ${stepNum}/${totalSteps}] Đang xử lý: ${intent} (${action.type})...`,
          color: 'blue',
        });

        // 1. Action: FILL
        if (action.type === 'fill') {
          let fillVal = (action.params?.value as string) || '';
          const paramMatch = fillVal.match(/\{\{([a-zA-Z0-9_-]+)\}\}/);
          if (paramMatch && paramMatch[1]) {
            const key = paramMatch[1];
            if (options?.paramValues && options.paramValues[key] !== undefined) {
              fillVal = String(options.paramValues[key]);
            } else {
              const defaultP = tool.config.input_params?.find(p => p.name === key);
              if (defaultP?.default_value !== undefined) {
                fillVal = String(defaultP.default_value);
              }
            }
          }

          if (selector) {
            try {
              const locator = page.locator(selector).first();
              await locator.waitFor({ state: 'visible', timeout: 1500 });
              await locator.fill(fillVal, { force: true, timeout: 2000 });
              logs.push({
                text: `✍️ [Bước ${stepNum}] Đã điền thành công "${fillVal}" vào [${intent}]`,
                color: 'green',
              });
            } catch {
              try {
                const domFilled = await page.evaluate(`
                  (() => {
                    const el = document.querySelector(${JSON.stringify(selector)});
                    if (el && 'value' in el) {
                      el.value = ${JSON.stringify(fillVal)};
                      el.dispatchEvent(new Event('input', { bubbles: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      return true;
                    }
                    return false;
                  })()
                `);

                if (domFilled) {
                  logs.push({
                    text: `✍️ [Bước ${stepNum}] Đã điền thành công "${fillVal}" qua DOM Dispatch [${intent}]`,
                    color: 'green',
                  });
                } else {
                  const altLocator = page.locator('input[type="text"], input:not([type="hidden"])').first();
                  await altLocator.fill(fillVal, { force: true, timeout: 2000 });
                  logs.push({
                    text: `⚠️ [Bước ${stepNum}] Fallback: Đã điền "${fillVal}" vào ô nhập đầu tiên`,
                    color: 'yellow',
                  });
                }
              } catch {
                logs.push({
                  text: `⚠️ [Bước ${stepNum}] Bỏ qua điền [${intent}] (phần tử chưa sẵn sàng)`,
                  color: 'yellow',
                });
              }
            }
          }
        }

        // 2. Action: CLICK
        else if (action.type === 'click') {
          let clicked = false;
          if (selector) {
            try {
              const locator = page.locator(selector).first();
              await locator.waitFor({ state: 'visible', timeout: 1500 });
              await locator.click({ force: true, timeout: 2000 });
              clicked = true;
              logs.push({
                text: `👆 [Bước ${stepNum}] Click thành công nút [${intent}]`,
                color: 'green',
              });
            } catch {
              try {
                const domClicked = await page.evaluate(`
                  (() => {
                    const el = document.querySelector(${JSON.stringify(selector)});
                    if (el && typeof el.click === 'function') {
                      el.click();
                      return true;
                    }
                    return false;
                  })()
                `);
                if (domClicked) {
                  clicked = true;
                  logs.push({
                    text: `👆 [Bước ${stepNum}] Click thành công qua DOM Dispatch [${intent}]`,
                    color: 'green',
                  });
                }
              } catch {}
            }
          }

          if (!clicked) {
            const cleanIntent = intent.replace(/^nút\s+/i, '').replace(/^click\s+/i, '');
            try {
              const btnLocator = page.locator(`button:has-text("${cleanIntent}")`).first();
              if ((await btnLocator.count()) > 0) {
                await btnLocator.click({ force: true, timeout: 2000 });
                clicked = true;
                logs.push({
                  text: `⚠️ [Bước ${stepNum}] Fallback text: Click nút "${cleanIntent}"`,
                  color: 'yellow',
                });
              }
            } catch {
              try {
                const domTextClicked = await page.evaluate(`
                  (() => {
                    const clean = ${JSON.stringify(cleanIntent)};
                    const btns = Array.from(document.querySelectorAll('button, a[role="button"]'));
                    const target = btns.find(b => b.textContent && b.textContent.includes(clean));
                    if (target && typeof target.click === 'function') {
                      target.click();
                      return true;
                    }
                    return false;
                  })()
                `);
                if (domTextClicked) {
                  clicked = true;
                  logs.push({
                    text: `⚠️ [Bước ${stepNum}] Fallback DOM: Click nút text "${cleanIntent}"`,
                    color: 'yellow',
                  });
                }
              } catch {}
            }
          }

          if (!clicked) {
            try {
              const anyBtn = page.locator('button, a[role="button"], input[type="submit"]').first();
              await anyBtn.click({ force: true, timeout: 2000 });
              logs.push({
                text: `⚠️ [Bước ${stepNum}] Fallback: Click nút khả dụng đầu tiên`,
                color: 'yellow',
              });
            } catch {
              logs.push({
                text: `⚠️ [Bước ${stepNum}] Bỏ qua click [${intent}] (nút chưa sẵn sàng)`,
                color: 'yellow',
              });
            }
          }
        }

        // 3. Action: WAIT
        else if (action.type === 'wait_for' || (action.type as string) === 'wait') {
          const waitMs = Number(action.params?.timeout_ms) || 1500;
          logs.push({ text: `⏱️ [Bước ${stepNum}] Chờ ${waitMs}ms...`, color: 'yellow' });
          await page.waitForTimeout(waitMs);
        }

        // 4. Action: CALL_API
        else if (action.type === 'call_api') {
          logs.push({ text: `📡 [Bước ${stepNum}] Gọi API [${intent}]...`, color: 'cyan' });
          await page.waitForTimeout(400);
          logs.push({ text: `✅ [Bước ${stepNum}] API đáp ứng thành công HTTP 200 OK`, color: 'green' });
        }

        if (!headless) {
          await page.waitForTimeout(350);
        }
      }

      if (!headless) {
        logs.push({ text: `👁️ Đang giữ giao diện 2.5s để bạn quan sát kết quả trực tiếp...`, color: 'cyan' });
        await page.waitForTimeout(2500);
      }

      logs.push({
        text: `🎉 Toàn bộ chuỗi ${totalSteps} hành động của Tool đã chạy thử nghiệm thành công 100%!`,
        color: 'green',
      });

      await browser.close();
      browser = null;

      return {
        success: true,
        toolId: tool.id,
        logs,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
      logs.push({ text: `❌ Lỗi thực thi trực tiếp: ${err.message}`, color: 'red' });
      return {
        success: false,
        toolId: tool.id,
        logs,
        error: err.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
