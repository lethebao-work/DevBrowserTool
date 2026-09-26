#!/usr/bin/env node
/**
 * @devbrowsertool/mcp-bridge — MCP Server cho Antigravity IDE & AI Agents (Mục 0 & Mục 13)
 *
 * Cung cấp 10 MCP tools chuẩn tắc cho Agent tương tác theo Kiến trúc B (Agent-Driven):
 * 1. get_scout_scripts: Cung cấp JS recipes để Agent tự chạy trên tab Chrome đang mở
 * 2. ingest_scout_data: Nhận raw data từ Agent và bóc tách thành Map 7 loại tài nguyên
 * 3. query_map: Đọc Resource Map đã lưu để tra cứu
 * 4. propose_actions: Liệt kê các controls khả dụng (inputs, buttons) cho Agent suy luận
 * 5. compile_actions: Biên dịch chuỗi hành động thành spec hoàn chỉnh với 5-tier locators
 * 6. get_execution_scripts: Trả về JS scripts cho Agent chạy dry-run từng bước
 * 7. ingest_execution_result: Nhận kết quả chạy thử nghiệm dry-run từ Agent
 * 8. build_tool: Đóng gói thành Chrome Extension / Userscript / Overlay HUD
 * 9. list_tools: Liệt kê danh sách các công cụ đã được tạo
 * 10. locate_element: Tra cứu đa tầng locator của một phần tử trong Map
 *
 * Giao tiếp qua stdio với IDE, chuyển tiếp HTTP tới DevBrowserTool WebAppServer (127.0.0.1:3456).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function getMcpToken(): string {
  if (process.env.DEVBROWSERTOOL_MCP_TOKEN) {
    return process.env.DEVBROWSERTOOL_MCP_TOKEN;
  }
  const tokenFile = join(homedir(), '.devbrowsertool', 'mcp-token');
  try {
    if (existsSync(tokenFile)) {
      return readFileSync(tokenFile, 'utf8').trim();
    }
  } catch {}
  return '';
}

async function callBackend(endpoint: string, body?: unknown, method = 'POST'): Promise<any> {
  const token = getMcpToken();
  const port = process.env.DEVBROWSERTOOL_PORT || '3456';
  const url = `http://127.0.0.1:${port}/api/mcp/${endpoint}`;

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errJson: any = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } catch (err: any) {
    if (
      err.code === 'ECONNREFUSED' ||
      err.message?.includes('fetch failed') ||
      err.message?.includes('connect ECONNREFUSED')
    ) {
      throw new Error(
        `Không thể kết nối tới DevBrowserTool server tại 127.0.0.1:${port}.\n` +
        `Vui lòng đảm bảo DevBrowserTool Web Server đang chạy (mở Extension hoặc chạy 'npm run ui').`
      );
    }
    throw err;
  }
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

const server = new McpServer({
  name: 'devbrowsertool-mcp',
  version: '0.1.0',
});

// ============================================================================
// TOOL 1: get_scout_scripts
// ============================================================================
server.tool(
  'get_scout_scripts',
  'Trả về danh sách JavaScript expressions cần chạy trên trang web để bóc tách tài nguyên. Agent PHẢI tự chạy các script này trên tab đang mở (qua browser_execute_script hoặc chrome-devtools.evaluate_script), rồi gọi ingest_scout_data với kết quả. Quy trình: get_scout_scripts → Agent chạy scripts → ingest_scout_data.',
  {
    url: z.string().describe('URL trang web cần scout (ví dụ: "https://openfront.io")'),
  },
  async ({ url }) => {
    const result = await callBackend('get-scout-scripts', { url });
    return textResult(result);
  }
);

// ============================================================================
// TOOL 2: ingest_scout_data
// ============================================================================
server.tool(
  'ingest_scout_data',
  'Nhận raw data đã được Agent thu thập từ trang web (sau khi chạy scripts từ get_scout_scripts), xử lý thành Resource Map có cấu trúc 7 loại tài nguyên và lưu vào MapStore. Đây là bước HOÀN TẤT của quy trình scout.',
  {
    url: z.string().describe('URL của trang vừa scout'),
    page_info: z.object({
      title: z.string().optional(),
      url: z.string().optional(),
    }).optional().describe('Thông tin title và URL từ script page_info'),
    dom_elements: z.array(z.any()).optional().describe('Kết quả bóc tách phần tử DOM từ script dom_elements'),
    performance_entries: z.array(z.any()).optional().describe('Danh sách performance entries từ script performance_entries'),
    storage_keys: z.object({
      localStorage: z.array(z.string()).optional(),
      sessionStorage: z.array(z.string()).optional(),
      localStorageKeys: z.array(z.string()).optional(),
      sessionStorageKeys: z.array(z.string()).optional(),
    }).optional().describe('Keys LocalStorage / SessionStorage từ script storage_keys'),
    network_requests: z.array(z.any()).optional().describe('Danh sách network requests nếu thu thập được từ chrome-devtools'),
    webSocketUrls: z.array(z.string()).optional().describe('Danh sách WebSocket URLs phát hiện được'),
  },
  async (args) => {
    const result = await callBackend('ingest-scout-data', args);
    return textResult(result);
  }
);

// ============================================================================
// TOOL 3: query_map
// ============================================================================
server.tool(
  'query_map',
  'Đọc Resource Map đã lưu của một domain từ MapStore để tra cứu cấu trúc, các node tương tác, endpoints và state transition graph.',
  {
    domain: z.string().describe('Domain của trang web (ví dụ: "openfront.io")'),
  },
  async ({ domain }) => {
    const result = await callBackend('query-map', { domain });
    return textResult(result);
  }
);

// ============================================================================
// TOOL 4: propose_actions
// ============================================================================
server.tool(
  'propose_actions',
  'Liệt kê tất cả các phần tử có thể tương tác (input fields, clickable buttons/tabs, API endpoints) từ Map để Agent phân tích và tự suy luận thiết kế chuỗi hành động.',
  {
    domain: z.string().describe('Domain của trang web (ví dụ: "openfront.io")'),
  },
  async ({ domain }) => {
    const result = await callBackend('propose-actions', { domain });
    return textResult(result);
  }
);

// ============================================================================
// TOOL 5: compile_actions
// ============================================================================
server.tool(
  'compile_actions',
  'Biên dịch danh sách hành động do Agent thiết kế thành ActionCompileSpec hoàn chỉnh với đầy đủ 5-tier locators (CSS, JS DOM, Text, Fallback) và snapshot bản đồ.',
  {
    domain: z.string().describe('Domain của trang web'),
    actions: z.array(z.object({
      intent: z.string().describe('Mục đích hoặc node_id tương tác (ví dụ: "node-input-player-name" hoặc "Vào trận")'),
      type: z.enum(['navigate', 'click', 'fill', 'call_api', 'extract', 'wait_for', 'branch', 'loop', 'call_llm']).optional().describe('Loại hành động'),
      params: z.record(z.unknown()).optional().describe('Tham số bổ sung (ví dụ: { value: "{{player_name}}" })'),
      on_failure: z.enum(['stop', 'skip_and_continue', 'ask_user']).optional().describe('Xử lý khi thất bại'),
      timeout_ms: z.number().optional().describe('Thời gian chờ tối đa (ms)'),
    })).describe('Chuỗi các bước hành động cần biên dịch'),
  },
  async ({ domain, actions }) => {
    const result = await callBackend('compile-actions', { domain, actions });
    return textResult(result);
  }
);

// ============================================================================
// TOOL 6: get_execution_scripts
// ============================================================================
server.tool(
  'get_execution_scripts',
  'Tạo chuỗi JavaScript expressions để Agent tự chạy thử nghiệm (dry-run) từng bước trên trình duyệt thật của mình (qua browser_execute_script hoặc chrome-devtools).',
  {
    domain: z.string().describe('Domain của trang web'),
    action_specs: z.array(z.any()).describe('Danh sách action specs cần sinh JS dry-run'),
  },
  async ({ domain, action_specs }) => {
    const result = await callBackend('get-execution-scripts', { domain, action_specs });
    return textResult(result);
  }
);

// ============================================================================
// TOOL 7: ingest_execution_result
// ============================================================================
server.tool(
  'ingest_execution_result',
  'Ghi nhận kết quả chạy thử nghiệm dry-run từ Agent để đánh giá độ ổn định và tỷ lệ thành công của Tool trước khi đóng gói phát hành.',
  {
    domain: z.string().describe('Domain của trang web'),
    tool_id: z.string().optional().describe('ID của tool đang kiểm thử (nếu có)'),
    results: z.array(z.object({
      step: z.number().describe('Số thứ tự bước'),
      action_id: z.string().describe('ID của action'),
      success: z.boolean().describe('Thành công hay thất bại'),
      result: z.unknown().optional().describe('Dữ liệu trả về (nếu có)'),
      error: z.string().optional().describe('Chi tiết lỗi nếu thất bại'),
    })).describe('Kết quả thực thi từng bước'),
  },
  async ({ domain, tool_id, results }) => {
    const result = await callBackend('ingest-execution-result', { domain, tool_id, results });
    return textResult(result);
  }
);

// ============================================================================
// TOOL 8: build_tool
// ============================================================================
server.tool(
  'build_tool',
  'Đóng gói chuỗi hành động thành công cụ độc lập hoàn chỉnh (Chrome Extension MV3, Userscript, hoặc Overlay HUD) và đăng ký vào Tool Registry.',
  {
    domain: z.string().describe('Domain của trang web'),
    tool_name: z.string().describe('Tên công cụ (ví dụ: "openfront_autojoin")'),
    package_type: z.enum(['chrome_extension', 'advisor_overlay', 'userscript', 'agent_script']).optional().describe('Hình thức đóng gói (mặc định: "chrome_extension")'),
    action_specs: z.array(z.any()).describe('Chuỗi các bước hành động đã biên dịch'),
    input_params: z.array(z.any()).optional().describe('Các biến tham số hóa mà người dùng có thể tùy chỉnh (ví dụ: tên nhân vật)'),
    param_values: z.record(z.unknown()).optional().describe('Giá trị mặc định cho tham số'),
  },
  async ({ domain, tool_name, package_type, action_specs, input_params, param_values }) => {
    const result = await callBackend('build-tool', {
      domain,
      tool_name,
      package_type,
      action_specs,
      input_params,
      param_values,
    });
    return textResult(result);
  }
);

// ============================================================================
// TOOL 9: list_tools
// ============================================================================
server.tool(
  'list_tools',
  'Liệt kê tất cả các công cụ đã được tạo và lưu trữ trong Tool Registry.',
  {},
  async () => {
    const result = await callBackend('list-tools', undefined, 'GET');
    return textResult(result);
  }
);

// ============================================================================
// TOOL 10: locate_element
// ============================================================================
server.tool(
  'locate_element',
  'Tra cứu chi tiết các biến thể định vị (5-tier Locators: CSS, JS DOM, Text, XPath, Coordinate) của một node cụ thể trong Map.',
  {
    domain: z.string().describe('Domain của trang web'),
    node_id: z.string().describe('ID của node cần tra cứu trong Map'),
  },
  async ({ domain, node_id }) => {
    const result = await callBackend('locate-element', { domain, node_id });
    return textResult(result);
  }
);

// Khởi chạy MCP Server qua stdio
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in DevBrowserTool MCP Server:', error);
  process.exit(1);
});
