import { describe, it, expect } from 'vitest';
import { ScoutScripts } from '../src/discovery/scout-scripts.js';
import { ScoutProcessor } from '../src/discovery/scout-processor.js';

describe('ScoutScripts & ScoutProcessor (Kiến trúc B - Agent-Driven)', () => {
  it('ScoutScripts trả về các đoạn JS scripts hợp lệ cho Agent thực thi', () => {
    const pageInfo = ScoutScripts.getPageInfoScript();
    expect(pageInfo.id).toBe('page_info');
    expect(pageInfo.code).toContain('document.title');

    const domExtraction = ScoutScripts.getDomExtractionScript();
    expect(domExtraction.id).toBe('dom_elements');
    expect(domExtraction.code).toContain('querySelectorAll');

    const perfScript = ScoutScripts.getPerformanceExtractionScript();
    expect(perfScript.id).toBe('performance_entries');
    expect(perfScript.code).toContain('getEntriesByType');

    const storageScript = ScoutScripts.getStorageExtractionScript();
    expect(storageScript.id).toBe('storage_keys');
    expect(storageScript.code).toContain('localStorage');

    const wsScript = ScoutScripts.getWebSocketDetectionScript();
    expect(wsScript.id).toBe('websocket_detection');
    expect(wsScript.code).toContain('ws://');

    const all = ScoutScripts.getAllScoutScripts();
    expect(all.length).toBe(5);
  });

  it('ScoutProcessor xử lý raw scout data từ Agent thành MapFile đầy đủ 7 loại tài nguyên', () => {
    const rawData = {
      url: 'https://openfront.io/game',
      pageInfo: {
        title: 'OpenFront Alpha Arena',
        url: 'https://openfront.io/game',
      },
      domElements: [
        { tag: 'input', id: 'player-name', name: 'pname', type: 'text', role: 'input', text: 'Tên nhân vật', selector: '#player-name' },
        { tag: 'button', id: 'btn-join', name: '', type: 'button', role: 'button', text: 'Vào trận', selector: '#btn-join' },
      ],
      performanceEntries: [
        { name: 'https://openfront.io/api/v1/players', initiator: 'fetch' },
        { name: 'https://openfront.io/api/v1/servers.json', initiator: 'xmlhttprequest' },
      ],
      storageKeys: {
        localStorageKeys: ['auth_token', 'user_settings'],
        sessionStorageKeys: ['temp_session'],
      },
      networkRequests: [
        { url: 'https://openfront.io/api/v1/matchmake', method: 'POST' },
      ],
      webSocketUrls: ['wss://openfront.io/ws/arena-1'],
    };

    const result = ScoutProcessor.processRawScoutData(rawData);
    expect(result.success).toBe(true);
    expect(result.domain).toBe('openfront.io');
    expect(result.map).toBeDefined();

    // Endpoints: 2 từ perf + 1 từ network = 3 (hoặc 3 unique paths)
    const endpointNodes = result.map.base_nodes.filter(n => n.type === 'endpoint');
    expect(endpointNodes.length).toBe(3);

    // Persistence: 2 localStorage + 1 sessionStorage = 3
    const persistenceNodes = result.map.base_nodes.filter(n => n.type === 'local_persistence');
    expect(persistenceNodes.length).toBe(3);

    // DOM Elements: 2
    const domNodes = result.map.base_nodes.filter(n => n.type === 'dom_element');
    expect(domNodes.length).toBe(2);

    // WebSocket: 1
    const wsNodes = result.map.base_nodes.filter(n => n.type === 'websocket_channel');
    expect(wsNodes.length).toBe(1);

    // State Graph
    expect(result.map.state_graph.length).toBeGreaterThanOrEqual(4);

    // Summary counts
    expect(result.summaryByType.domElements).toBe(2);
    expect(result.summaryByType.endpoints).toBe(3);
    expect(result.summaryByType.localPersistence).toBe(3);
    expect(result.summaryByType.webSockets).toBe(1);
  });
});
