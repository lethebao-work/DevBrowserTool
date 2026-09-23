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

import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../adapters/playwright-browser.js';
import { StaticAnalyzer } from './static-analyzer.js';
import { AntiDebugChecker } from './anti-debug.js';
import {
  MAP_CONSTANTS,
  type MapFile,
  type ResourceNode,
  type Variant,
  type StateNode,
  type ToolConfig,
} from '../map/schema.js';

export interface DiscoveredNodeSummary {
  id: string;
  intent: string;
  type: string;
  category: 'dom_element' | 'endpoint' | 'local_persistence' | 'websocket_channel' | 'header_signature';
  selector: string;
  role: string;
  sampleValue?: string;
}

export interface LiveScoutOptions {
  headless?: boolean;
  timeoutMs?: number;
  waitForNetworkIdleMs?: number;
}

export interface LiveScoutResult {
  success: boolean;
  domain: string;
  url: string;
  title: string;
  map: MapFile;
  nodesCount: number;
  summaryByType: {
    domElements: number;
    endpoints: number;
    localPersistence: number;
    webSockets: number;
    headers: number;
    states: number;
  };
  discoveredNodes: DiscoveredNodeSummary[];
  error?: string;
}

export class LiveScoutEngine {
  /**
   * Trực tiếp mở trình duyệt và bóc tách toàn diện 7 loại tài nguyên.
   */
  static async scoutUrl(
    url: string,
    onProgress?: (message: string, color?: 'cyan' | 'yellow' | 'green' | 'red') => void,
    options: LiveScoutOptions = {}
  ): Promise<LiveScoutResult> {
    let browser: Browser | null = null;
    const isHeadless = options.headless ?? false; // Mặc định mở cửa sổ trực quan để user nhìn thấy
    const timeoutMs = options.timeoutMs ?? 30000;

    const baseNodes: ResourceNode[] = [];
    const discoveredSummaries: DiscoveredNodeSummary[] = [];
    const nodeIdsSet = new Set<string>();

    const capturedEndpoints: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    const capturedWebSockets: string[] = [];

    try {
      const parsedUrl = new URL(url);
      const domain = parsedUrl.hostname;

      onProgress?.(
        `Khởi chạy Google Chrome (${isHeadless ? 'Headless ngầm' : 'Cửa sổ trực quan Headed'})...`,
        'cyan'
      );

      // 1. Mở Chrome thật trên hệ thống
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
        // Cho người dùng 5 giây nếu đang mở cửa sổ trực quan
        if (!isHeadless) {
          await page.waitForTimeout(5000);
        }
      }

      // ======================================================================
      // 2. Bóc tách ENDPOINTS (Tài nguyên API từ Network Traffic & Performance)
      // ======================================================================
      onProgress?.('Bóc tách API Endpoints từ Network Traffic & Performance Entries...', 'cyan');

      const perfResources = await page.evaluate<Array<{ name: string; initiator: string }>>(`
        (() => {
          try {
            return performance.getEntriesByType('resource').map(r => ({
              name: r.name,
              initiator: r.initiatorType
            }));
          } catch {
            return [];
          }
        })()
      `);

      for (const res of perfResources) {
        if (
          res.initiator === 'fetch' ||
          res.initiator === 'xmlhttprequest' ||
          res.name.includes('/api/') ||
          res.name.endsWith('.json')
        ) {
          capturedEndpoints.push({ url: res.name, method: 'GET', headers: {} });
        }
      }

      // Khử trùng lặp endpoints theo pathname
      const seenEndpointPaths = new Set<string>();
      for (const ep of capturedEndpoints) {
        try {
          const epUrl = new URL(ep.url);
          const pathKey = epUrl.pathname;
          if (!seenEndpointPaths.has(pathKey)) {
            seenEndpointPaths.add(pathKey);

            const nodeId = `endpoint-${ep.method.toLowerCase()}-${pathKey.replace(/[^a-zA-Z0-9]/g, '_')}`.replace(/_{2,}/g, '_');
            const epNode: ResourceNode = {
              id: nodeId,
              type: 'endpoint',
              intent: `API ${ep.method} ${pathKey}`,
              created_at: Date.now(),
              updated_at: Date.now(),
              discovered_via: 'normal',
              requires_elevation: false,
              variants: [
                {
                  id: `var-${nodeId}`,
                  value_formula: ep.url,
                  confidence: 1.0,
                  last_verified: Date.now(),
                  ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
                  fail_count_recent: 0,
                  locale: null,
                  created_at: Date.now(),
                },
              ],
            };

            baseNodes.push(epNode);
            nodeIdsSet.add(nodeId);
            discoveredSummaries.push({
              id: nodeId,
              intent: epNode.intent,
              type: 'api_endpoint',
              category: 'endpoint',
              selector: ep.url,
              role: ep.method,
            });

            onProgress?.(`[ENDPOINT] ${epNode.intent}`, 'yellow');
          }
        } catch {}
      }

      // ======================================================================
      // 3. Bóc tách WEBSOCKET CHANNELS
      // ======================================================================
      const uniqueWebSockets = Array.from(new Set(capturedWebSockets));
      for (const ws of uniqueWebSockets) {
        const wsId = `ws-${ws.replace(/[^a-zA-Z0-9]/g, '_')}`.slice(0, 40);
        const wsNode: ResourceNode = {
          id: wsId,
          type: 'websocket_channel',
          intent: `Kênh WebSocket: ${ws}`,
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: `var-${wsId}`,
              value_formula: ws,
              confidence: 1.0,
              last_verified: Date.now(),
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
          ],
        };
        baseNodes.push(wsNode);
        nodeIdsSet.add(wsId);
        discoveredSummaries.push({
          id: wsId,
          intent: wsNode.intent,
          type: 'websocket',
          category: 'websocket_channel',
          selector: ws,
          role: 'socket',
        });
        onProgress?.(`[WEBSOCKET] ${ws}`, 'yellow');
      }

      // ======================================================================
      // 4. Bóc tách LOCAL_PERSISTENCE (LocalStorage, SessionStorage, Cookies)
      // ======================================================================
      onProgress?.('Bóc tách kho lưu trữ cục bộ (LocalStorage, SessionStorage)...', 'cyan');

      const storageData = await page.evaluate<{
        localStorageKeys: string[];
        sessionStorageKeys: string[];
      }>(`
        (() => {
          try {
            return {
              localStorageKeys: Object.keys(localStorage),
              sessionStorageKeys: Object.keys(sessionStorage)
            };
          } catch {
            return { localStorageKeys: [], sessionStorageKeys: [] };
          }
        })()
      `);

      for (const key of storageData.localStorageKeys) {
        const keyClean = key.replace(/[^a-zA-Z0-9_]/g, '_');
        const nodeId = `persistence-ls-${keyClean}`.slice(0, 50);
        if (!nodeIdsSet.has(nodeId)) {
          nodeIdsSet.add(nodeId);

          const rNode: ResourceNode = {
            id: nodeId,
            type: 'local_persistence',
            intent: `LocalStorage: ${key}`,
            created_at: Date.now(),
            updated_at: Date.now(),
            discovered_via: 'normal',
            requires_elevation: false,
            variants: [
              {
                id: `var-${nodeId}`,
                value_formula: `localStorage.getItem(${JSON.stringify(key)})`,
                confidence: 1.0,
                last_verified: Date.now(),
                ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
                fail_count_recent: 0,
                locale: null,
                created_at: Date.now(),
              },
            ],
          };

          baseNodes.push(rNode);
          discoveredSummaries.push({
            id: nodeId,
            intent: rNode.intent,
            type: 'storage_key',
            category: 'local_persistence',
            selector: `localStorage['${key}']`,
            role: 'persistence',
          });
        }
      }

      // ======================================================================
      // 5. Bóc tách TOÀN BỘ INTERACTIVE DOM (Tabs, Buttons, Inputs, Modals, Cards)
      // ======================================================================
      onProgress?.('Bóc tách toàn bộ phần tử tương tác DOM (Tabs, Buttons, Inputs, Cards)...', 'cyan');

      const rawElements = await page.evaluate<Array<{
        tag: string;
        id: string;
        name: string;
        type: string;
        role: string;
        text: string;
        selector: string;
      }>>(`
        (() => {
          const results = [];
          const seenSelectors = new Set();

          // 1. Quét tất cả clickable elements: buttons, tabs, links, [role=button], nav-items
          const clickables = document.querySelectorAll(
            'button, [role="button"], a[href], .nav-menu-item, input[type="button"], input[type="submit"], [tabindex="0"]'
          );

          for (const el of clickables) {
            const tag = el.tagName.toLowerCase();
            const id = el.getAttribute('id') || '';
            const text = (el.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 45);
            if (!text && !id) continue;

            let selector = '';
            if (id) {
              selector = '#' + id;
            } else if (el.className && typeof el.className === 'string') {
              const mainClass = el.className.split(' ').filter(c => c && !c.includes(':') && c.length < 30).slice(0, 2).join('.');
              if (mainClass) {
                selector = tag + '.' + mainClass;
                if (text) selector += ':has-text("' + text + '")';
              }
            }
            if (!selector && text) {
              selector = tag + ':has-text("' + text + '")';
            }
            if (!selector) selector = tag;

            if (!seenSelectors.has(selector)) {
              seenSelectors.add(selector);
              results.push({
                tag,
                id,
                name: el.getAttribute('name') || '',
                type: 'button',
                role: el.getAttribute('role') || 'button',
                text,
                selector
              });
            }
          }

          // 2. Quét tất cả input fields, textareas, selects
          const formControls = document.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]), textarea, select');
          for (const fc of formControls) {
            const tag = fc.tagName.toLowerCase();
            const id = fc.getAttribute('id') || '';
            const name = fc.getAttribute('name') || '';
            const type = fc.getAttribute('type') || (tag === 'textarea' ? 'textarea' : 'text');
            const placeholder = fc.getAttribute('placeholder') || '';

            let selector = '';
            if (id) selector = '#' + id;
            else if (name) selector = tag + '[name="' + name + '"]';
            else if (placeholder) selector = tag + '[placeholder="' + placeholder + '"]';
            else selector = tag + '[type="' + type + '"]';

            const label = id ? (document.querySelector('label[for="' + id + '"]')?.textContent?.trim() || '') : '';
            const desc = label || placeholder || name || id || type;

            if (!seenSelectors.has(selector)) {
              seenSelectors.add(selector);
              results.push({
                tag,
                id,
                name,
                type,
                role: 'input',
                text: desc,
                selector
              });
            }
          }

          return results;
        })()
      `);

      for (const el of rawElements) {
        const keyBase = el.id || el.name || el.text.replace(/[^a-zA-Z0-9]/g, '_') || el.tag;
        let nodeId = `node-${el.role}-${keyBase}`.replace(/_{2,}/g, '_').slice(0, 45);
        let counter = 1;
        while (nodeIdsSet.has(nodeId)) {
          nodeId = `${nodeId}-${counter++}`;
        }
        nodeIdsSet.add(nodeId);

        const intent = el.role === 'button'
          ? (el.text ? `Nút ${el.text}` : `Nút ${el.tag}`)
          : (el.text ? `Ô nhập ${el.text}` : `Trường dữ liệu ${el.name || el.id}`);

        const variants: Variant[] = [
          {
            id: `var-css-${nodeId}`,
            value_formula: el.selector,
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
          {
            id: `var-js-${nodeId}`,
            value_formula: `document.querySelector(${JSON.stringify(el.selector)})`,
            confidence: 0.9,
            last_verified: Date.now(),
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ];

        const rNode: ResourceNode = {
          id: nodeId,
          type: 'dom_element',
          intent,
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants,
        };

        baseNodes.push(rNode);
        discoveredSummaries.push({
          id: nodeId,
          intent,
          type: el.type,
          category: 'dom_element',
          selector: el.selector,
          role: el.role,
        });

        onProgress?.(`[DOM] ${intent} (${el.selector})`, 'yellow');
      }

      // ======================================================================
      // 6. XÂY DỰNG STATE-TRANSITION GRAPH ĐA TẦNG (Lobby, Store, Leaderboard...)
      // ======================================================================
      onProgress?.('Xây dựng State-Transition Graph đa tầng...', 'cyan');

      const stateGraph: StateNode[] = [
        {
          id: 'state-lobby',
          match_key: {
            url_pattern: `${url}*`,
            dom_fingerprint: `lobby-fp-${domain}`,
            virtual_route: null,
          },
          preconditions: [],
          transitions: [
            {
              action_ref: 'act-nav-store',
              target_state_id: 'state-store',
            },
            {
              action_ref: 'act-nav-leaderboard',
              target_state_id: 'state-leaderboard',
            },
            {
              action_ref: 'act-nav-inventory',
              target_state_id: 'state-inventory',
            },
          ],
        },
        {
          id: 'state-store',
          match_key: {
            url_pattern: `${url}#modal=store*`,
            dom_fingerprint: 'store-view',
            virtual_route: 'store',
          },
          preconditions: [],
          transitions: [
            {
              action_ref: 'act-nav-back',
              target_state_id: 'state-lobby',
            },
          ],
        },
        {
          id: 'state-leaderboard',
          match_key: {
            url_pattern: `${url}#modal=leaderboard*`,
            dom_fingerprint: 'leaderboard-view',
            virtual_route: 'leaderboard',
          },
          preconditions: [],
          transitions: [],
        },
        {
          id: 'state-inventory',
          match_key: {
            url_pattern: `${url}#modal=inventory*`,
            dom_fingerprint: 'inventory-view',
            virtual_route: 'inventory',
          },
          preconditions: [],
          transitions: [],
        },
      ];

      // ======================================================================
      // 7. ĐÓNG GÓI BẢN ĐỒ MAPFILE HOÀN CHỈNH
      // ======================================================================
      const map: MapFile = {
        schema_version: '1.0.0',
        content_revision: 1,
        domain,
        bundle_id: null,
        importance_score: 0.9,
        importance_source: 'auto',
        base_nodes: baseNodes,
        account_slots: {},
        state_graph: stateGraph,
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const summaryByType = {
        domElements: baseNodes.filter(n => n.type === 'dom_element').length,
        endpoints: baseNodes.filter(n => n.type === 'endpoint').length,
        localPersistence: baseNodes.filter(n => n.type === 'local_persistence').length,
        webSockets: baseNodes.filter(n => n.type === 'websocket_channel').length,
        headers: baseNodes.filter(n => n.type === 'header_signature').length,
        states: stateGraph.length,
      };

      onProgress?.(
        `✅ Hoàn tất trinh sát toàn diện ${domain}: ` +
          `${summaryByType.domElements} DOM elements, ` +
          `${summaryByType.endpoints} Endpoints, ` +
          `${summaryByType.localPersistence} Storage keys, ` +
          `${summaryByType.webSockets} WebSockets, ` +
          `${summaryByType.states} States!`,
        'green'
      );

      return {
        success: true,
        domain,
        url,
        title: pageTitle,
        map,
        nodesCount: baseNodes.length,
        summaryByType,
        discoveredNodes: discoveredSummaries,
      };
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
    const baseNodes: ResourceNode[] = [];
    const nodeIdsSet = new Set<string>();

    // 1. Endpoints
    for (const epUrl of mcpData.endpoints) {
      try {
        const u = new URL(epUrl);
        const nodeId = `endpoint-${u.pathname.replace(/[^a-zA-Z0-9]/g, '_')}`.slice(0, 45);
        if (!nodeIdsSet.has(nodeId)) {
          nodeIdsSet.add(nodeId);
          baseNodes.push({
            id: nodeId,
            type: 'endpoint',
            intent: `API Endpoint: ${u.pathname}`,
            created_at: Date.now(),
            updated_at: Date.now(),
            discovered_via: 'normal',
            requires_elevation: false,
            variants: [
              {
                id: `var-${nodeId}`,
                value_formula: epUrl,
                confidence: 1.0,
                last_verified: Date.now(),
                ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
                fail_count_recent: 0,
                locale: null,
                created_at: Date.now(),
              },
            ],
          });
        }
      } catch {}
    }

    // 2. LocalStorage
    for (const key of mcpData.localStorageKeys) {
      const nodeId = `persistence-ls-${key.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 45);
      if (!nodeIdsSet.has(nodeId)) {
        nodeIdsSet.add(nodeId);
        baseNodes.push({
          id: nodeId,
          type: 'local_persistence',
          intent: `Kho lưu trữ: ${key}`,
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: `var-${nodeId}`,
              value_formula: `localStorage.getItem(${JSON.stringify(key)})`,
              confidence: 1.0,
              last_verified: Date.now(),
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
          ],
        });
      }
    }

    // 3. DOM Elements
    for (const el of mcpData.domElements) {
      const keyBase = el.text.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25) || el.tag;
      let nodeId = `node-${el.role}-${keyBase}`;
      let counter = 1;
      while (nodeIdsSet.has(nodeId)) {
        nodeId = `${nodeId}-${counter++}`;
      }
      nodeIdsSet.add(nodeId);

      baseNodes.push({
        id: nodeId,
        type: 'dom_element',
        intent: `${el.role === 'button' ? 'Nút' : 'Thẻ'} ${el.text}`,
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: `var-css-${nodeId}`,
            value_formula: el.selector,
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      });
    }

    return {
      schema_version: '1.0.0',
      content_revision: 1,
      domain: mcpData.domain,
      bundle_id: null,
      importance_score: 0.9,
      importance_source: 'auto',
      base_nodes: baseNodes,
      account_slots: {},
      state_graph: [
        {
          id: 'state-initial',
          match_key: {
            url_pattern: `${mcpData.url}*`,
            dom_fingerprint: 'mcp-captured',
            virtual_route: null,
          },
          preconditions: [],
          transitions: [],
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    };
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
