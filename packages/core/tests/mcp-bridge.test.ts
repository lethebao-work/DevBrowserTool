import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebAppServer } from '../../ui/src/web-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('MCP Bridge stdio Server E2E (Bước 4)', () => {
  let server: WebAppServer;
  let client: Client;
  let transport: StdioClientTransport;
  let tempDir: string;
  const testPort = 3699;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dbt-mcp-bridge-test-'));
    server = new WebAppServer({
      port: testPort,
      mapsDir: join(tempDir, 'maps'),
      toolsDir: tempDir,
    });
    await server.start();

    // Khởi tạo MCP Client kết nối tới mcp-bridge qua stdio
    const scriptPath = join(__dirname, '../../mcp-bridge/dist/index.js');
    transport = new StdioClientTransport({
      command: 'node',
      args: [scriptPath],
      env: {
        ...process.env,
        DEVBROWSERTOOL_PORT: String(testPort),
        DEVBROWSERTOOL_MCP_TOKEN: server.mcpToken,
      },
    });

    client = new Client({ name: 'test-agent', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close().catch(() => {});
    await server.stop().catch(() => {});
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('MCP Client liệt kê đầy đủ 10 MCP tools chuẩn tắc', async () => {
    const res = await client.listTools();
    const toolNames = res.tools.map(t => t.name);

    expect(toolNames).toContain('get_scout_scripts');
    expect(toolNames).toContain('ingest_scout_data');
    expect(toolNames).toContain('query_map');
    expect(toolNames).toContain('propose_actions');
    expect(toolNames).toContain('compile_actions');
    expect(toolNames).toContain('get_execution_scripts');
    expect(toolNames).toContain('ingest_execution_result');
    expect(toolNames).toContain('build_tool');
    expect(toolNames).toContain('list_tools');
    expect(toolNames).toContain('locate_element');
    expect(toolNames.length).toBe(10);
  });

  it('Quy trình Scout (Kiến trúc B): get_scout_scripts → ingest_scout_data', async () => {
    // 1. Agent gọi get_scout_scripts
    const scriptsRes: any = await client.callTool({
      name: 'get_scout_scripts',
      arguments: { url: 'https://openfront.io' },
    });
    expect(scriptsRes.content).toBeDefined();
    const parsedScripts = JSON.parse(scriptsRes.content[0].text);
    expect(parsedScripts.success).toBe(true);
    expect(parsedScripts.domain).toBe('openfront.io');
    expect(parsedScripts.scripts.length).toBeGreaterThanOrEqual(4);

    // 2. Agent giả lập đã chạy scripts trên browser và gửi data về ingest_scout_data
    const ingestRes: any = await client.callTool({
      name: 'ingest_scout_data',
      arguments: {
        url: 'https://openfront.io',
        page_info: { title: 'OpenFront Alpha', url: 'https://openfront.io' },
        dom_elements: [
          { tag: 'input', id: 'player-name', name: 'player', type: 'text', role: 'input', text: 'Tên người chơi', selector: '#player-name' },
          { tag: 'button', id: 'btn-join', name: '', type: 'button', role: 'button', text: 'Vào trận', selector: '#btn-join' },
        ],
        performance_entries: [
          { name: 'https://openfront.io/api/v1/cluster.json', initiator: 'fetch' },
        ],
        storage_keys: {
          localStorage: ['settings.keybinds'],
        },
      },
    });
    const parsedIngest = JSON.parse(ingestRes.content[0].text);
    expect(parsedIngest.success).toBe(true);
    expect(parsedIngest.domain).toBe('openfront.io');
    expect(parsedIngest.nodes_count).toBeGreaterThanOrEqual(4);
  });

  it('Quy trình Reasoning & Action Planning: propose_actions → compile_actions', async () => {
    // 1. Agent gọi propose_actions để xem danh sách controls
    const proposeRes: any = await client.callTool({
      name: 'propose_actions',
      arguments: { domain: 'openfront.io' },
    });
    const parsedPropose = JSON.parse(proposeRes.content[0].text);
    expect(parsedPropose.success).toBe(true);
    expect(parsedPropose.input_nodes.length).toBeGreaterThanOrEqual(1);
    expect(parsedPropose.button_nodes.length).toBeGreaterThanOrEqual(1);

    // 2. Agent tự suy luận và gọi compile_actions
    const compileRes: any = await client.callTool({
      name: 'compile_actions',
      arguments: {
        domain: 'openfront.io',
        actions: [
          { intent: 'node-input-player-name', type: 'fill', params: { value: 'Tester99' } },
          { intent: 'node-button-btn-join', type: 'click' },
        ],
      },
    });
    const parsedCompile = JSON.parse(compileRes.content[0].text);
    expect(parsedCompile.success).toBe(true);
    expect(parsedCompile.actions.length).toBe(2);
  });

  it('Quy trình Packaging: build_tool → list_tools', async () => {
    const buildRes: any = await client.callTool({
      name: 'build_tool',
      arguments: {
        domain: 'openfront.io',
        tool_name: 'openfront_autojoin_mcp',
        package_type: 'chrome_extension',
        action_specs: [
          { intent: 'node-input-player-name', type: 'fill', params: { value: 'Hero' } },
          { intent: 'node-button-btn-join', type: 'click' },
        ],
      },
    });
    const parsedBuild = JSON.parse(buildRes.content[0].text);
    expect(parsedBuild.success).toBe(true);
    expect(parsedBuild.tool_id).toBeDefined();

    const listRes: any = await client.callTool({
      name: 'list_tools',
      arguments: {},
    });
    const parsedList = JSON.parse(listRes.content[0].text);
    expect(parsedList.success).toBe(true);
    expect(parsedList.count).toBeGreaterThanOrEqual(1);
  });
});
