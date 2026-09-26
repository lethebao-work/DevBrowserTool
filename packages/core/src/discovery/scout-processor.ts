/**
 * ScoutProcessor — Xử lý dữ liệu trinh sát thô (Raw Scout Data) thành MapFile có cấu trúc (Kiến trúc B)
 *
 * Module này KHÔNG tương tác với browser. Nó nhận dữ liệu bóc tách thô do Agent
 * (hoặc BrowserAdapter) thu thập, chạy pipeline xử lý 7 loại tài nguyên:
 * 1. endpoints: Khử trùng lặp API endpoints từ network traffic & performance entries
 * 2. websocket_channels: Lọc các kênh WebSocket
 * 3. local_persistence: Chuẩn hóa key localStorage / sessionStorage
 * 4. dom_elements: Tạo các node tương tác DOM với đa tầng Locator (CSS, JS) + Confidence + TTL
 * 5. state_graph: Xây dựng đồ thị trạng thái chuyển đổi
 * 6. MapFile: Đóng gói toàn bộ thành MapFile chuẩn
 */

import {
  MAP_CONSTANTS,
  type MapFile,
  type ResourceNode,
  type Variant,
  type StateNode,
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

export interface RawScoutInput {
  url: string;
  pageInfo?: {
    title?: string;
    url?: string;
  };
  domElements?: Array<{
    tag: string;
    id?: string;
    name?: string;
    type?: string;
    role?: string;
    text?: string;
    selector: string;
  }>;
  performanceEntries?: Array<{
    name: string;
    initiator?: string;
  }>;
  storageKeys?: {
    localStorageKeys?: string[];
    sessionStorageKeys?: string[];
    localStorage?: string[];
    sessionStorage?: string[];
  };
  networkRequests?: Array<{
    url: string;
    method?: string;
    headers?: Record<string, string>;
    resourceType?: string;
  }>;
  webSocketUrls?: string[];
}

export class ScoutProcessor {
  /**
   * Xử lý raw data thu thập được từ page thành MapFile chuẩn và LiveScoutResult.
   */
  static processRawScoutData(
    input: RawScoutInput,
    onProgress?: (message: string, color?: 'cyan' | 'yellow' | 'green' | 'red') => void
  ): LiveScoutResult {
    const rawUrl = input.url || input.pageInfo?.url || 'https://unknown-domain.local';
    let domain = 'unknown-domain.local';
    try {
      const parsed = new URL(rawUrl);
      domain = parsed.hostname;
    } catch {
      domain = rawUrl.replace(/^https?:\/\//, '').split('/')[0] || 'unknown-domain.local';
    }

    const pageTitle = input.pageInfo?.title || domain;
    const baseNodes: ResourceNode[] = [];
    const discoveredSummaries: DiscoveredNodeSummary[] = [];
    const nodeIdsSet = new Set<string>();

    // ======================================================================
    // 1. Bóc tách ENDPOINTS (Tài nguyên API từ Network Traffic & Performance)
    // ======================================================================
    const capturedEndpoints: Array<{ url: string; method: string; headers: Record<string, string> }> = [];

    // Từ network requests
    if (input.networkRequests) {
      for (const req of input.networkRequests) {
        const method = (req.method || 'GET').toUpperCase();
        capturedEndpoints.push({
          url: req.url,
          method,
          headers: req.headers || {},
        });
      }
    }

    // Từ performance entries
    if (input.performanceEntries) {
      for (const res of input.performanceEntries) {
        if (
          res.initiator === 'fetch' ||
          res.initiator === 'xmlhttprequest' ||
          res.name.includes('/api/') ||
          res.name.endsWith('.json')
        ) {
          capturedEndpoints.push({ url: res.name, method: 'GET', headers: {} });
        }
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

          const nodeId = `endpoint-${ep.method.toLowerCase()}-${pathKey.replace(/[^a-zA-Z0-9]/g, '_')}`.replace(/_{2,}/g, '_').slice(0, 50);
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
    // 2. Bóc tách WEBSOCKET CHANNELS
    // ======================================================================
    const capturedWebSockets: string[] = [];
    if (input.webSocketUrls) {
      capturedWebSockets.push(...input.webSocketUrls);
    }
    if (input.networkRequests) {
      for (const r of input.networkRequests) {
        if (r.resourceType === 'websocket' || r.url.startsWith('ws://') || r.url.startsWith('wss://')) {
          capturedWebSockets.push(r.url);
        }
      }
    }
    if (input.performanceEntries) {
      for (const p of input.performanceEntries) {
        if (p.name.startsWith('ws://') || p.name.startsWith('wss://')) {
          capturedWebSockets.push(p.name);
        }
      }
    }

    const uniqueWebSockets = Array.from(new Set(capturedWebSockets));
    for (const ws of uniqueWebSockets) {
      const wsId = `ws-${ws.replace(/[^a-zA-Z0-9]/g, '_')}`.slice(0, 40);
      if (!nodeIdsSet.has(wsId)) {
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
    }

    // ======================================================================
    // 3. Bóc tách LOCAL_PERSISTENCE (LocalStorage, SessionStorage)
    // ======================================================================
    const lsKeys = input.storageKeys?.localStorageKeys || input.storageKeys?.localStorage || [];
    for (const key of lsKeys) {
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

    const ssKeys = input.storageKeys?.sessionStorageKeys || input.storageKeys?.sessionStorage || [];
    for (const key of ssKeys) {
      const keyClean = key.replace(/[^a-zA-Z0-9_]/g, '_');
      const nodeId = `persistence-ss-${keyClean}`.slice(0, 50);
      if (!nodeIdsSet.has(nodeId)) {
        nodeIdsSet.add(nodeId);

        const rNode: ResourceNode = {
          id: nodeId,
          type: 'local_persistence',
          intent: `SessionStorage: ${key}`,
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: `var-${nodeId}`,
              value_formula: `sessionStorage.getItem(${JSON.stringify(key)})`,
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
          selector: `sessionStorage['${key}']`,
          role: 'persistence',
        });
      }
    }

    // ======================================================================
    // 4. Bóc tách TOÀN BỘ INTERACTIVE DOM (Buttons, Inputs, Cards, etc.)
    // ======================================================================
    const rawElements = input.domElements || [];
    for (const el of rawElements) {
      const role = el.role || (el.tag === 'button' || el.type === 'button' ? 'button' : 'input');
      const text = el.text || '';
      const keyBase = el.id || el.name || text.replace(/[^a-zA-Z0-9]/g, '_') || el.tag;
      let nodeId = `node-${role}-${keyBase}`.replace(/_{2,}/g, '_').slice(0, 45);
      let counter = 1;
      while (nodeIdsSet.has(nodeId)) {
        nodeId = `${nodeId}-${counter++}`;
      }
      nodeIdsSet.add(nodeId);

      const intent = role === 'button'
        ? (text ? `Nút ${text}` : `Nút ${el.tag}`)
        : (text ? `Ô nhập ${text}` : `Trường dữ liệu ${el.name || el.id || el.tag}`);

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
        type: el.type || 'element',
        category: 'dom_element',
        selector: el.selector,
        role,
      });

      onProgress?.(`[DOM] ${intent} (${el.selector})`, 'yellow');
    }

    // ======================================================================
    // 5. XÂY DỰNG STATE-TRANSITION GRAPH ĐA TẦNG
    // ======================================================================
    const stateGraph: StateNode[] = [
      {
        id: 'state-lobby',
        match_key: {
          url_pattern: `${rawUrl}*`,
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
          url_pattern: `${rawUrl}#modal=store*`,
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
          url_pattern: `${rawUrl}#modal=leaderboard*`,
          dom_fingerprint: 'leaderboard-view',
          virtual_route: 'leaderboard',
        },
        preconditions: [],
        transitions: [],
      },
      {
        id: 'state-inventory',
        match_key: {
          url_pattern: `${rawUrl}#modal=inventory*`,
          dom_fingerprint: 'inventory-view',
          virtual_route: 'inventory',
        },
        preconditions: [],
        transitions: [],
      },
    ];

    // ======================================================================
    // 6. ĐÓNG GÓI BẢN ĐỒ MAPFILE HOÀN CHỈNH
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
      url: rawUrl,
      title: pageTitle,
      map,
      nodesCount: baseNodes.length,
      summaryByType,
      discoveredNodes: discoveredSummaries,
    };
  }
}
