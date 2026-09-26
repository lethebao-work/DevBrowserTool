import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebAppServer } from '../../ui/src/web-server.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('MCP REST Endpoints (Bước 3 - Kiến trúc B Agent-Driven)', () => {
  let server: WebAppServer;
  let tempDir: string;
  let baseUrl: string;
  const testPort = 3599;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dbt-mcp-test-'));
    server = new WebAppServer({
      port: testPort,
      mapsDir: join(tempDir, 'maps'),
      toolsDir: tempDir,
    });
    await server.start();
    baseUrl = `http://127.0.0.1:${testPort}`;
  });

  afterAll(async () => {
    await server.stop();
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('Từ chối truy cập khi không có Bearer token (401 Unauthorized)', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/get-scout-scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://openfront.io' }),
    });
    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.error).toContain('Unauthorized');
  });

  it('1. get_scout_scripts: trả về danh sách JS expressions cho Agent chạy', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/get-scout-scripts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({ url: 'https://openfront.io' }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.domain).toBe('openfront.io');
    expect(Array.isArray(json.scripts)).toBe(true);
    expect(json.scripts.length).toBeGreaterThanOrEqual(4);
    expect(json.scripts.some((s: any) => s.id === 'dom_elements')).toBe(true);
  });

  it('2. ingest_scout_data: validate Zod và bóc tách thành MapFile lưu vào MapStore', async () => {
    // 2a. Invalid body -> 400
    const invalidRes = await fetch(`${baseUrl}/api/mcp/ingest-scout-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({}),
    });
    expect(invalidRes.status).toBe(400);

    // 2b. Valid body -> 200
    const validData = {
      url: 'https://openfront.io',
      page_info: { title: 'OpenFront Alpha', url: 'https://openfront.io' },
      dom_elements: [
        { tag: 'input', id: 'player-name', name: 'player', type: 'text', role: 'input', text: 'Tên nhân vật', selector: '#player-name' },
        { tag: 'button', id: 'btn-join', name: '', type: 'button', role: 'button', text: 'Vào trận', selector: '#btn-join' },
      ],
      performance_entries: [
        { name: 'https://openfront.io/api/v1/cluster.json', initiator: 'fetch' },
      ],
      storage_keys: {
        localStorage: ['settings.keybinds'],
      },
    };

    const res = await fetch(`${baseUrl}/api/mcp/ingest-scout-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify(validData),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.domain).toBe('openfront.io');
    expect(json.nodes_count).toBeGreaterThanOrEqual(4);
  });

  it('3. query_map: đọc Map đã lưu từ MapStore', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/query-map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({ domain: 'openfront.io' }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.map.domain).toBe('openfront.io');
    expect(json.map.base_nodes.length).toBeGreaterThanOrEqual(4);
  });

  it('4. propose_actions: liệt kê các controls khả dụng (inputs, buttons) để Agent suy luận', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/propose-actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({ domain: 'openfront.io' }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.input_nodes.length).toBeGreaterThanOrEqual(1);
    expect(json.button_nodes.length).toBeGreaterThanOrEqual(1);
    expect(json.endpoints.length).toBeGreaterThanOrEqual(1);
  });

  it('5. compile_actions: biên dịch chuỗi action do Agent thiết kế thành spec hoàn chỉnh', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/compile-actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({
        domain: 'openfront.io',
        actions: [
          { intent: 'node-input-player-name', type: 'fill', params: { value: 'ProPlayer99' } },
          { intent: 'node-button-btn-join', type: 'click' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.actions.length).toBe(2);
    expect(json.map_snapshot.length).toBeGreaterThanOrEqual(1);
  });

  it('6. get_execution_scripts: sinh JS để Agent tự chạy dry-run trên trình duyệt thật', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/get-execution-scripts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({
        domain: 'openfront.io',
        action_specs: [
          { intent: 'node-input-player-name', type: 'fill', params: { value: 'Tester' } },
          { intent: 'node-button-btn-join', type: 'click' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.total_steps).toBe(2);
    expect(json.steps[0].script).toContain('querySelector');
  });

  it('7. ingest_execution_result: ghi nhận kết quả dry-run từ Agent', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/ingest-execution-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({
        domain: 'openfront.io',
        results: [
          { step: 1, action_id: 'act-1', success: true },
          { step: 2, action_id: 'act-2', success: true },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.all_passed).toBe(true);
  });

  it('8. build_tool: đóng gói tool thành Chrome Extension hoàn chỉnh', async () => {
    const res = await fetch(`${baseUrl}/api/mcp/build-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({
        domain: 'openfront.io',
        tool_name: 'openfront_autojoin',
        package_type: 'chrome_extension',
        action_specs: [
          { intent: 'node-input-player-name', type: 'fill', params: { value: 'Hero' } },
          { intent: 'node-button-btn-join', type: 'click' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.tool_id).toBeDefined();
    expect(json.package_type).toBe('chrome_extension');
    expect(existsSync(json.output_path)).toBe(true);
  });

  it('9. list_tools & locate_element: quản lý và tra cứu chi tiết node', async () => {
    // List tools
    const listRes = await fetch(`${baseUrl}/api/mcp/list-tools`, {
      headers: { Authorization: `Bearer ${server.mcpToken}` },
    });
    expect(listRes.status).toBe(200);
    const listJson: any = await listRes.json();
    expect(listJson.count).toBeGreaterThanOrEqual(1);

    // Locate element
    const locateRes = await fetch(`${baseUrl}/api/mcp/locate-element`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${server.mcpToken}`,
      },
      body: JSON.stringify({
        domain: 'openfront.io',
        node_id: 'node-input-player-name',
      }),
    });
    expect(locateRes.status).toBe(200);
    const locateJson: any = await locateRes.json();
    expect(locateJson.success).toBe(true);
    expect(locateJson.variants.length).toBeGreaterThanOrEqual(1);
  });
});
