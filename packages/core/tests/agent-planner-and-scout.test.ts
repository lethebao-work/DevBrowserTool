/**
 * Agent Planner and Live Scout Tests
 */

import { describe, it, expect } from 'vitest';
import { ToolAgentPlanner } from '../src/factory/agent-planner.js';
import type { MapFile } from '../src/map/schema.js';

describe('ToolAgentPlanner (AI Prompt Designer)', () => {
  const mockPizzaMap: MapFile = {
    schema_version: '1.0.0',
    content_revision: 1,
    domain: 'httpbin.org',
    bundle_id: null,
    importance_score: 0.8,
    importance_source: 'auto',
    base_nodes: [
      {
        id: 'node-input-custname',
        type: 'dom_element',
        intent: 'Trường Tên Khách Hàng',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'var-css-custname',
            value_formula: 'input[name="custname"]',
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      },
      {
        id: 'node-input-custtel',
        type: 'dom_element',
        intent: 'Trường Số Điện Thoại',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'var-css-custtel',
            value_formula: 'input[name="custtel"]',
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      },
      {
        id: 'node-textarea-comments',
        type: 'dom_element',
        intent: 'Trường Ghi Chú Đơn Hàng',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'var-css-comments',
            value_formula: 'textarea[name="comments"]',
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      },
      {
        id: 'node-button-submit',
        type: 'dom_element',
        intent: 'Nút Submit order',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'var-css-submit',
            value_formula: 'button:has-text("Submit order")',
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      },
    ],
    account_slots: {},
    state_graph: [],
    created_at: Date.now(),
    updated_at: Date.now(),
  };

  it('phân tích prompt tự nhiên và ánh xạ thành chuỗi ActionSpecs + Parameters', () => {
    const prompt = 'Tự động điền form đặt pizza: tên khách hàng, số điện thoại, ghi chú và bấm submit order';
    const plan = ToolAgentPlanner.analyzeAndPropose(mockPizzaMap, prompt);

    expect(plan.domain).toBe('httpbin.org');
    expect(plan.matchedNodes.length).toBe(4);
    expect(plan.parameters.length).toBe(3);
    expect(plan.actionSpecs.length).toBe(4);

    // Kiểm tra tham số
    const paramKeys = plan.parameters.map(p => p.key);
    expect(paramKeys).toContain('custname');
    expect(paramKeys).toContain('custtel');
    expect(paramKeys).toContain('comments');

    // Kiểm tra đề xuất
    expect(plan.proposals.length).toBe(2);
    expect(plan.proposals[0].packageType).toBe('chrome_extension');
    expect(plan.proposals[0].recommended).toBe(true);
    expect(plan.proposals[1].packageType).toBe('advisor_overlay');
  });

  it('LiveScoutEngine bóc tách các trường input và button từ trang web thật', async () => {
    const { LiveScoutEngine } = await import('../src/discovery/live-scout.js');
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <form action="/submit" method="POST">
            <label for="username">Tên người dùng:</label>
            <input type="text" id="username" name="username" placeholder="Nhập tên" />
            <label for="password">Mật khẩu:</label>
            <input type="password" id="password" name="password" />
            <button type="submit">Đăng Nhập</button>
          </form>
        </body>
      </html>
    `;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    const logs: string[] = [];

    const scoutResult = await LiveScoutEngine.scoutUrl(
      dataUrl,
      (msg, color) => {
        logs.push(`[${color}] ${msg}`);
      },
      { headless: true }
    );

    expect(scoutResult.success).toBe(true);
    expect(scoutResult.nodesCount).toBeGreaterThanOrEqual(3);
    const intents = scoutResult.map.base_nodes.map(n => n.intent);
    expect(intents.some(i => i.includes('Tên người dùng') || i.includes('username'))).toBe(true);
    expect(intents.some(i => i.includes('Đăng Nhập'))).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
  }, 20000);

  it('LiveScoutEngine.buildMapFromMcpData tạo MapFile đầy đủ 3 lớp từ MCP Browser Tab', async () => {
    const { LiveScoutEngine } = await import('../src/discovery/live-scout.js');
    const mcpData = {
      domain: 'openfront.io',
      url: 'https://openfront.io/',
      title: 'OpenFront (ALPHA)',
      endpoints: [
        'https://api.openfront.io/cosmetics.json',
        'https://api.openfront.io/cluster.json',
      ],
      localStorageKeys: ['settings.keybinds', 'map-favorites'],
      domElements: [
        { tag: 'button', selector: '.nav-menu-item:has-text("Chơi")', text: 'Chơi', role: 'button' },
        { tag: 'button', selector: '.nav-menu-item:has-text("Cửa hàng")', text: 'Cửa hàng', role: 'button' },
        { tag: 'input', selector: '#player-name', text: 'Tên người chơi', role: 'input' },
      ],
    };

    const map = LiveScoutEngine.buildMapFromMcpData(mcpData);
    expect(map.domain).toBe('openfront.io');
    expect(map.base_nodes.some(n => n.type === 'endpoint')).toBe(true);
    expect(map.base_nodes.some(n => n.type === 'local_persistence')).toBe(true);
    expect(map.base_nodes.some(n => n.type === 'dom_element')).toBe(true);
    expect(map.base_nodes.length).toBe(7);
  });

  it('ToolAgentPlanner.generateSmartPresets tự động tạo các Preset 1-click từ Map', async () => {
    const { LiveScoutEngine } = await import('../src/discovery/live-scout.js');
    const { ToolAgentPlanner } = await import('../src/factory/agent-planner.js');
    const mcpData = {
      domain: 'openfront.io',
      url: 'https://openfront.io/',
      title: 'OpenFront (ALPHA)',
      endpoints: ['https://api.openfront.io/cosmetics.json'],
      localStorageKeys: ['settings.keybinds'],
      domElements: [
        { tag: 'input', selector: '#player-name', text: 'Tên người chơi', role: 'input' },
        { tag: 'button', selector: 'button:has-text("CHƠI ĐƠN")', text: 'CHƠI ĐƠN', role: 'button' },
        { tag: 'button', selector: 'button:has-text("Cửa hàng")', text: 'Cửa hàng', role: 'button' },
      ],
    };

    const map = LiveScoutEngine.buildMapFromMcpData(mcpData);
    const presets = ToolAgentPlanner.generateSmartPresets(map);

    expect(presets.length).toBeGreaterThanOrEqual(2);
    expect(presets.some(p => p.title.includes('Đổi Tên') || p.title.includes('Vào Trận'))).toBe(true);
    expect(presets.some(p => p.title.includes('Cửa Hàng'))).toBe(true);
  });

  it('MapStore.deleteMap và deleteNode hoạt động chuẩn xác', async () => {
    const { MapStore } = await import('../src/map/store.js');
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tempDir = mkdtempSync(join(tmpdir(), 'mapstore-delete-test-'));
    try {
      const store = new MapStore(tempDir);
      const map = store.createMap('deletetest.com');
      expect(store.hasMap('deletetest.com')).toBe(true);

      // Thêm node rồi xóa node
      const updatedMap = store.addNode(map, {
        id: 'test-input-node',
        intent: 'Test Input',
        type: 'dom_element',
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [{
          id: 'v1',
          value_formula: '#input',
          confidence: 0.9,
          last_verified: Date.now(),
          fail_count_recent: 0,
          locale: null,
          created_at: Date.now(),
          ttl_ms: 10000,
        }],
      });
      expect(updatedMap.base_nodes.length).toBe(1);

      const nodeDeletedMap = store.deleteNode(updatedMap, updatedMap.base_nodes[0].id);
      expect(nodeDeletedMap.base_nodes.length).toBe(0);

      // Xóa Map
      const deleted = store.deleteMap('deletetest.com');
      expect(deleted).toBe(true);
      expect(store.hasMap('deletetest.com')).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ToolRegistry.deleteTool xóa tool khỏi danh sách', async () => {
    const { ToolRegistry } = await import('../src/packager/tool-registry.js');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const tempDir = mkdtempSync(join(tmpdir(), 'tool-reg-test-'));
    try {
      const registry = new ToolRegistry(tempDir);
      const tool = registry.registerTool({
        name: 'QuickPlay_Tool',
        description: 'Auto play',
        target_domain: 'example.com',
        package_type: 'chrome_extension',
        built_at: Date.now(),
        map_schema_version: '1.0.0',
        map_content_revision: 1,
        actions: [],
      });

      expect(registry.getTool(tool.id)).not.toBeNull();
      const deleted = registry.deleteTool(tool.id);
      expect(deleted).toBe(true);
      expect(registry.getTool(tool.id)).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('LiveScoutEngine.runToolLive thực thi tuần tự các hành động trực tiếp trên browser', async () => {
    const { LiveScoutEngine } = await import('../src/discovery/live-scout.js');
    const html = `
      <!DOCTYPE html>
      <html>
        <body>
          <input type="text" id="username" placeholder="Nhập tên" />
          <button id="submit-btn" onclick="document.body.setAttribute('data-clicked', 'true')">Bấm Chơi</button>
        </body>
      </html>
    `;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

    const fakeTool = {
      id: 'example_com_play',
      name: 'PlayTool',
      target_domain: dataUrl,
      config: {
        name: 'PlayTool',
        description: 'Auto play test',
        target_domain: dataUrl,
        package_type: 'chrome_extension' as const,
        built_at: Date.now(),
        map_schema_version: '1.0.0',
        map_content_revision: 1,
        actions: [
          {
            id: 'act-fill',
            type: 'fill' as const,
            node_ref: 'node-user',
            params: { value: 'TesterVN' },
            on_failure: 'stop' as const,
          },
          {
            id: 'act-click',
            type: 'click' as const,
            node_ref: 'node-btn',
            params: {},
            on_failure: 'stop' as const,
          },
        ],
      },
    };

    const fakeMap = {
      schema_version: '1.0.0',
      content_revision: 1,
      domain: dataUrl,
      bundle_id: null,
      importance_score: 0.5,
      importance_source: 'auto' as const,
      base_nodes: [
        {
          id: 'node-user',
          intent: 'Ô nhập tên',
          type: 'dom_element' as const,
          category: 'interactive' as const,
          discovered_via: 'normal' as const,
          requires_elevation: false,
          variants: [{ id: 'v1', value_formula: '#username', confidence: 0.9, last_verified: Date.now(), ttl_ms: 10000, fail_count_recent: 0, locale: null, created_at: Date.now() }],
        },
        {
          id: 'node-btn',
          intent: 'Nút Chơi',
          type: 'dom_element' as const,
          category: 'interactive' as const,
          discovered_via: 'normal' as const,
          requires_elevation: false,
          variants: [{ id: 'v2', value_formula: '#submit-btn', confidence: 0.9, last_verified: Date.now(), ttl_ms: 10000, fail_count_recent: 0, locale: null, created_at: Date.now() }],
        },
      ],
      account_slots: {},
      state_graph: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const result = await LiveScoutEngine.runToolLive(fakeTool, fakeMap, {
      headless: true,
      targetUrl: dataUrl,
    });

    if (!result.success) {
      console.log('RUN_TOOL_LIVE_FAIL:', result.error, result.logs);
    }
    expect(result.success).toBe(true);
    expect(result.logs.some(l => l.text.includes('TesterVN'))).toBe(true);
    expect(result.logs.some(l => l.text.includes('thành công'))).toBe(true);
  }, 20000);
});


