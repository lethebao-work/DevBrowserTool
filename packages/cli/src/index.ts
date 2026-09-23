/**
 * DevBrowserTool CLI — Command Line Interface
 *
 * Cung cấp giao diện dòng lệnh cho người dùng thao tác trực tiếp:
 * - devbrowsertool ui: Khởi động Web App UI Server (127.0.0.1, bảo mật CSRF)
 * - devbrowsertool list: Liệt kê danh sách Map và Tool hiện có
 * - devbrowsertool inspect <domain>: Xem chi tiết các node và trạng thái trong Map
 * - devbrowsertool build <domain> [--type <package_type>]: Đóng gói Tool từ Map
 * - devbrowsertool explore <url>: Khám phá tự động trên website thật
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import {
  MapStore,
  ToolRegistry,
  ToolFactory,
  ActionCompiler,
  AdvisorPackager,
  UserscriptPackager,
  type ToolConfig,
} from '@devbrowsertool/core';
import { WebAppServer } from 'devbrowsertool-ui';

function getBasePath(): string {
  const base = join(homedir(), '.devbrowsertool');
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  return base;
}

export async function runCli(args: string[]): Promise<void> {
  const command = args[0] || 'help';
  const basePath = getBasePath();
  const mapsDir = join(basePath, 'maps');
  const mapStore = new MapStore(mapsDir);
  const toolRegistry = new ToolRegistry(basePath);

  switch (command) {
    case 'ui': {
      let port = 3456;
      const portIdx = args.indexOf('--port');
      if (portIdx !== -1 && args[portIdx + 1]) {
        port = parseInt(args[portIdx + 1], 10);
      }

      console.log('🌐 Đang khởi động DevBrowserTool Web App Server...');
      const server = new WebAppServer({ port, mapsDir, toolsDir: basePath });
      const url = await server.start();

      console.log('\n======================================================');
      console.log(`🚀 Web App UI sẵn sàng tại: \x1b[36m${url}\x1b[0m`);
      console.log(`🔒 Host: \x1b[32m127.0.0.1\x1b[0m (Bảo vệ chống LAN access)`);
      console.log(`🔑 CSRF Token: \x1b[33m${server.csrfToken}\x1b[0m`);
      console.log('======================================================\n');
      console.log('Nhấn Ctrl+C để dừng server.');

      process.on('SIGINT', async () => {
        console.log('\nĐang dừng server...');
        await server.stop();
        process.exit(0);
      });
      break;
    }

    case 'list': {
      console.log('\n📋 DANH SÁCH MAPS (DOMAINS):');
      const domains = mapStore.listDomains();
      if (domains.length === 0) {
        console.log('  (Chưa có Map nào. Dùng lệnh "explore <url>" để bắt đầu)');
      } else {
        for (const d of domains) {
          const m = mapStore.loadMap(d);
          console.log(`  • \x1b[36m${d}\x1b[0m — rev: ${m?.content_revision ?? 0}, nodes: ${m?.base_nodes.length ?? 0}, states: ${m?.state_graph.length ?? 0}`);
        }
      }

      console.log('\n🛠️ DANH SÁCH TOOLS ĐÃ ĐÓNG GÓI:');
      const tools = toolRegistry.listTools();
      if (tools.length === 0) {
        console.log('  (Chưa có Tool nào. Dùng lệnh "build <domain>" để tạo Tool)');
      } else {
        for (const t of tools) {
          const map = mapStore.loadMap(t.target_domain);
          const health = map ? toolRegistry.checkToolHealth(t.id, map) : { status: t.status };
          console.log(`  • \x1b[32m${t.name}\x1b[0m [${t.target_domain}] — type: ${t.package_type}, status: ${health.status}`);
        }
      }
      console.log('');
      break;
    }

    case 'inspect': {
      const domain = args[1];
      if (!domain) {
        console.error('❌ Lỗi: Cần cung cấp domain. Ví dụ: devbrowsertool inspect example.com');
        process.exit(1);
      }

      const map = mapStore.loadMap(domain);
      if (!map) {
        console.error(`❌ Không tìm thấy Map cho domain: ${domain}`);
        process.exit(1);
      }

      console.log(`\n🗺️ CHI TIẾT MAP: \x1b[36m${domain}\x1b[0m`);
      console.log(`- Schema Version: ${map.schema_version}`);
      console.log(`- Content Revision: ${map.content_revision}`);
      console.log(`- Importance Score: ${map.importance_score} (${map.importance_source})`);
      console.log(`- Base Nodes (${map.base_nodes.length}):`);
      for (const n of map.base_nodes) {
        console.log(`  [${n.type}] "${n.intent}" — Variants: ${n.variants.length}, Confidence: ${n.variants[0]?.confidence ?? 'N/A'}`);
      }
      console.log(`- State Transitions (${map.state_graph.length}):`);
      for (const s of map.state_graph) {
        console.log(`  State: ${s.id} — Transitions: ${s.transitions.length}`);
      }
      console.log('');
      break;
    }

    case 'build': {
      const domain = args[1];
      if (!domain) {
        console.error('❌ Lỗi: Cần cung cấp domain. Ví dụ: devbrowsertool build example.com');
        process.exit(1);
      }

      const map = mapStore.loadMap(domain);
      if (!map) {
        console.error(`❌ Không tìm thấy Map cho domain: ${domain}`);
        process.exit(1);
      }

      let packageType: ToolConfig['package_type'] = 'chrome_extension';
      const typeIdx = args.indexOf('--type');
      if (typeIdx !== -1 && args[typeIdx + 1]) {
        const val = args[typeIdx + 1];
        if (['chrome_extension', 'userscript', 'advisor_overlay', 'agent_script'].includes(val)) {
          packageType = val as ToolConfig['package_type'];
        }
      }

      const outputDir = join(basePath, 'tools', domain);
      console.log(`⚙️ Đang biên dịch Tool dạng \x1b[33m${packageType}\x1b[0m cho \x1b[36m${domain}\x1b[0m...`);

      const factory = new ToolFactory();
      const specs = map.base_nodes.map(n => ({
        intent: n.intent,
        action_type: (n.type === 'dom_element' ? 'click' : 'extract') as any,
        on_failure: 'stop' as const,
      }));

      const result = await factory.build(map, {
        tool_name: `${domain.replace(/[^a-zA-Z0-9]/g, '')}_Tool`,
        output_dir: outputDir,
        action_specs: specs,
        skip_dry_run: true,
        package_type: packageType,
      });

      if (!result.success || !result.tool_config) {
        console.error(`❌ Build thất bại: ${result.error}`);
        process.exit(1);
      }

      const tool = toolRegistry.registerTool(result.tool_config);

      // Nếu là advisor_overlay, sinh thêm bundle advisor
      if (packageType === 'advisor_overlay') {
        const advisorBundle = AdvisorPackager.buildAdvisorBundle(result.tool_config);
        console.log(`📄 Đã tạo Advisor HUD script: ${advisorBundle.filename} (${advisorBundle.steps.length} bước)`);
      }

      console.log(`\n✅ ĐÃ ĐÓNG GÓI THÀNH CÔNG TOOL: \x1b[32m${tool.name}\x1b[0m`);
      console.log(`📁 Thư mục xuất bản: \x1b[36m${outputDir}\x1b[0m`);
      console.log(`📦 Loại: ${tool.package_type}`);
      console.log(`🔄 Revision lúc build: rev ${tool.map_content_revision}\n`);
      break;
    }

    default:
    case 'help': {
      console.log(`
\x1b[36mDevBrowserTool CLI\x1b[0m — Công cụ Agent tương tác Web & Tự động hoá sinh Tool

\x1b[33mCÁCH DÙNG:\x1b[0m
  devbrowsertool <lệnh> [tham số]

\x1b[33mCÁC LỆNH KHẢ DỤNG:\x1b[0m
  \x1b[32mui\x1b[0m [--port <cổng>]           Khởi động Web App Dashboard Server (127.0.0.1)
  \x1b[32mlist\x1b[0m                         Liệt kê tất cả Map domains và Tools đã tạo
  \x1b[32minspect\x1b[0m <domain>              Xem chi tiết Resource Graph và State Graph của 1 Map
  \x1b[32mbuild\x1b[0m <domain> [--type <t>]    Đóng gói Tool từ Map (extension|userscript|advisor_overlay)
  \x1b[32mhelp\x1b[0m                         Hiển thị hướng dẫn này
      `);
      break;
    }
  }
}
