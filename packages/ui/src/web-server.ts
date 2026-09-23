/**
 * Web App UI Server — Giao diện Web Độc Lập cho DevBrowserTool (Mục 16 & Mục 10)
 *
 * Nhiệm vụ:
 * 1. Phục vụ giao diện Map Viewer & Tool Dashboard trực tiếp trên trình duyệt ngoài VS Code.
 * 2. Cung cấp REST API cục bộ cho việc truy vấn Map, kiểm tra sức khoẻ Tool, và 1-click Rebuild.
 *
 * PHÒNG THỦ BẢO MẬT BẮT BUỘC (Chống DNS Rebinding & Cross-Tab CSRF Attack):
 * 1. BIND CỨNG '127.0.0.1': TUYỆT ĐỐI KHÔNG bind '0.0.0.0', cấm truy cập từ thiết bị ngoài LAN.
 * 2. XÁC THỰC ORIGIN / REFERER: Chỉ cho phép request có Origin từ đúng host/port nội bộ.
 * 3. CSRF / SESSION TOKEN: Sinh ngẫu nhiên lúc khởi động, bắt buộc có trong header X-DBT-Token
 *    cho mọi mutating API (POST) và WebSocket connection.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import {
  MapStore,
  ToolRegistry,
  ToolFactory,
  MAP_CONSTANTS,
  type MapFile,
  LiveScoutEngine,
  ToolAgentPlanner,
} from '@devbrowsertool/core';
import { existsSync, mkdirSync } from 'node:fs';
import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generateStudioHtml } from './views/studio-template.js';

export interface WebServerOptions {
  port?: number;
  mapsDir?: string;
  toolsDir?: string;
}

export class WebAppServer {
  public readonly port: number;
  public readonly host: string = '127.0.0.1'; // BẮT BUỘC 127.0.0.1 (Chống LAN access)
  public readonly csrfToken: string; // Token bí mật sinh ngẫu nhiên cho phiên chạy
  private server: Server | null = null;
  private readonly mapStore: MapStore;
  private readonly toolRegistry: ToolRegistry;

  constructor(options: WebServerOptions = {}) {
    this.port = options.port || MAP_CONSTANTS.WEB_UI_DEFAULT_PORT || 3456;
    this.csrfToken = randomBytes(32).toString('hex');

    const defaultMapsDir = options.mapsDir || join(homedir(), '.devbrowsertool', 'maps');
    const defaultToolsDir = options.toolsDir || join(homedir(), '.devbrowsertool');

    this.mapStore = new MapStore(defaultMapsDir);
    this.toolRegistry = new ToolRegistry(defaultToolsDir);
  }

  /**
   * Kiểm tra tính hợp lệ của Origin / Referer (Chống DNS Rebinding & Cross-Tab CSRF).
   */
  private isAllowedOrigin(req: IncomingMessage): boolean {
    const origin = req.headers['origin'];
    const referer = req.headers['referer'];

    const validPrefixes = [
      `http://127.0.0.1:${this.port}`,
      `http://localhost:${this.port}`,
    ];

    if (origin) {
      return validPrefixes.some(p => origin.startsWith(p));
    }

    if (referer) {
      return validPrefixes.some(p => referer.startsWith(p));
    }

    // Nếu không có origin/referer (ví dụ curl/local test), cho phép nếu có header X-DBT-Token
    const tokenHeader = req.headers['x-dbt-token'];
    return tokenHeader === this.csrfToken;
  }

  /**
   * Xác thực CSRF Token trên các request làm thay đổi dữ liệu (POST).
   */
  private validateCsrf(req: IncomingMessage): boolean {
    const token = req.headers['x-dbt-token'] || req.headers['x-csrf-token'];
    return token === this.csrfToken;
  }

  /**
   * Đọc JSON body từ request.
   */
  private async parseJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          reject(new Error('Payload Too Large'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : ({} as T));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Khởi động HTTP Server.
   */
  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
        }
      });

      this.server.on('error', reject);

      // BẮT BUỘC chỉ bind vào 127.0.0.1
      this.server.listen(this.port, this.host, () => {
        const url = `http://${this.host}:${this.port}?token=${this.csrfToken}`;
        resolve(url);
      });
    });
  }

  /**
   * Dừng HTTP Server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(err => {
        if (err) reject(err);
        else resolve();
      });
      this.server = null;
    });
  }

  /**
   * Xử lý định tuyến các requests.
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() || 'GET';

    // 1. Phục vụ giao diện HTML chính
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      res.end(this.generateHtmlPage());
      return;
    }

    // 2. Bảo vệ các API endpoints chống CSRF & DNS Rebinding
    if (pathname.startsWith('/api/')) {
      // Kiểm tra Origin/Referer
      if (!this.isAllowedOrigin(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Invalid Origin or Referer (CSRF/DNS Rebinding Protection)' }));
        return;
      }

      // Mutating APIs (POST, DELETE, PUT, PATCH) bắt buộc kiểm tra CSRF Token
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        if (!this.validateCsrf(req)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: Missing or Invalid X-DBT-Token' }));
          return;
        }
      }

      // Route: GET /api/health
      if (pathname === '/api/health' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', host: this.host, port: this.port }));
        return;
      }

      // Route: GET /api/domains
      if (pathname === '/api/domains' && method === 'GET') {
        const domains = this.mapStore.listDomains();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ domains }));
        return;
      }

      // Route: GET /api/maps/:domain/presets (Gợi ý sẵn 1-click từ AI)
      if (pathname.startsWith('/api/maps/') && pathname.endsWith('/presets') && method === 'GET') {
        const domain = decodeURIComponent(pathname.replace('/api/maps/', '').replace('/presets', ''));
        const map = this.mapStore.loadMap(domain);
        if (!map) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Map not found for domain: ${domain}` }));
          return;
        }
        const presets = ToolAgentPlanner.generateSmartPresets(map);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, domain, presets }));
        return;
      }

      // Route: GET /api/maps/:domain
      if (pathname.startsWith('/api/maps/') && method === 'GET') {
        const domain = decodeURIComponent(pathname.replace('/api/maps/', ''));
        const map = this.mapStore.loadMap(domain);
        if (!map) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Map not found for domain: ${domain}` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ map }));
        return;
      }

      // Route: DELETE /api/maps/:domain (Xóa Map)
      if (pathname.startsWith('/api/maps/') && method === 'DELETE') {
        const domain = decodeURIComponent(pathname.replace('/api/maps/', ''));
        const ok = this.mapStore.deleteMap(domain);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: ok, message: ok ? `Đã xóa map domain ${domain}` : 'Map không tồn tại' }));
        return;
      }

      // Route: GET /api/tools
      if (pathname === '/api/tools' && method === 'GET') {
        const tools = this.toolRegistry.listTools().map(t => {
          const currentMap = this.mapStore.loadMap(t.target_domain);
          const health = currentMap
            ? this.toolRegistry.checkToolHealth(t.id, currentMap)
            : {
                id: t.id,
                status: t.status,
                has_drift: false,
                built_revision: t.map_content_revision,
                current_map_revision: t.map_content_revision,
                circuit_breaker_active: t.circuit_breaker_tripped,
                recent_error_count: t.recent_errors.length,
              };
          return { ...t, health };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools }));
        return;
      }

      // Route: POST /api/tools/:id/rebuild
      if (pathname.startsWith('/api/tools/') && pathname.endsWith('/rebuild') && method === 'POST') {
        const toolId = decodeURIComponent(pathname.replace('/api/tools/', '').replace('/rebuild', ''));
        const tool = this.toolRegistry.getTool(toolId);
        if (!tool) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tool not found: ${toolId}` }));
          return;
        }

        const map = this.mapStore.loadMap(tool.target_domain);
        if (!map) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Map not found for domain: ${tool.target_domain}` }));
          return;
        }

        const factory = new ToolFactory();
        const specs = tool.config.actions.map(a => ({
          intent: a.description || a.type,
          action_type: a.type,
          on_failure: a.on_failure,
        }));

        const buildResult = await factory.build(map, {
          tool_name: tool.name,
          output_dir: join(homedir(), '.devbrowsertool', 'tools', tool.target_domain),
          action_specs: specs,
          skip_dry_run: true,
        });

        if (!buildResult.success || !buildResult.tool_config) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: buildResult.error || 'Rebuild failed' }));
          return;
        }

        const updated = this.toolRegistry.updateAfterRebuild(toolId, buildResult.tool_config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tool: updated }));
        return;
      }

      // Route: DELETE /api/tools/:id (Xóa Tool)
      if (pathname.startsWith('/api/tools/') && method === 'DELETE') {
        const toolId = decodeURIComponent(pathname.replace('/api/tools/', ''));
        const ok = this.toolRegistry.deleteTool(toolId);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: ok, message: ok ? `Đã xóa tool ${toolId}` : 'Tool không tồn tại' }));
        return;
      }

      // Route: POST /api/tools/:id/open-folder (Mở thư mục Extension trên máy)
      if (pathname.startsWith('/api/tools/') && pathname.endsWith('/open-folder') && method === 'POST') {
        const toolId = decodeURIComponent(pathname.replace('/api/tools/', '').replace('/open-folder', ''));
        const tool = this.toolRegistry.getTool(toolId);
        if (!tool) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tool not found: ${toolId}` }));
          return;
        }

        const folder = join(homedir(), '.devbrowsertool', 'tools', tool.target_domain, tool.name);
        if (!existsSync(folder)) {
          mkdirSync(folder, { recursive: true });
        }

        try {
          if (process.platform === 'win32') {
            exec(`explorer "${folder}"`);
          } else if (process.platform === 'darwin') {
            exec(`open "${folder}"`);
          } else {
            exec(`xdg-open "${folder}"`);
          }
        } catch {
          // Bỏ qua lỗi gọi lệnh hệ điều hành
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, folder }));
        return;
      }

      // Route: POST /api/tools/:id/run-live (Kích hoạt & Chạy thử nghiệm trực tiếp trên trình duyệt thật)
      if (pathname.startsWith('/api/tools/') && pathname.endsWith('/run-live') && method === 'POST') {
        const toolId = decodeURIComponent(pathname.replace('/api/tools/', '').replace('/run-live', ''));
        const tool = this.toolRegistry.getTool(toolId);
        if (!tool) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tool not found: ${toolId}` }));
          return;
        }

        const map = this.mapStore.loadMap(tool.target_domain);
        if (!map) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Map not found for domain: ${tool.target_domain}` }));
          return;
        }

        const body = (await this.parseJsonBody<{
          headless?: boolean;
          paramValues?: Record<string, unknown>;
          targetUrl?: string;
        }>(req).catch(() => ({}))) as {
          headless?: boolean;
          paramValues?: Record<string, unknown>;
          targetUrl?: string;
        };

        try {
          const result = await LiveScoutEngine.runToolLive(tool, map, {
            headless: body.headless ?? false,
            paramValues: body.paramValues,
            targetUrl: body.targetUrl,
          });

          this.toolRegistry.recordExecution(toolId, result.success);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        } catch (err: any) {
          this.toolRegistry.recordExecution(toolId, false);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message || 'Run live failed' }));
          return;
        }
      }

      // Route: POST /api/tools/:id/refine (Sửa & Tinh chỉnh Tool bằng Prompt mới)
      if (pathname.startsWith('/api/tools/') && pathname.endsWith('/refine') && method === 'POST') {
        const toolId = decodeURIComponent(pathname.replace('/api/tools/', '').replace('/refine', ''));
        const tool = this.toolRegistry.getTool(toolId);
        if (!tool) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tool not found: ${toolId}` }));
          return;
        }

        const map = this.mapStore.loadMap(tool.target_domain);
        if (!map) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Map not found for domain: ${tool.target_domain}` }));
          return;
        }

        const body = await this.parseJsonBody<{ prompt: string; paramValues?: Record<string, unknown> }>(req);
        if (!body.prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing prompt parameter' }));
          return;
        }

        try {
          const plan = ToolAgentPlanner.analyzeAndPropose(map, body.prompt);
          const factory = new ToolFactory();
          const outputDir = join(homedir(), '.devbrowsertool', 'tools', tool.target_domain, tool.name);

          const buildResult = await factory.build(map, {
            tool_name: tool.name,
            output_dir: outputDir,
            action_specs: plan.actionSpecs,
            skip_dry_run: true,
            package_type: tool.package_type,
            param_values: body.paramValues,
          });

          if (!buildResult.success || !buildResult.tool_config) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: buildResult.error || 'Refine build failed' }));
            return;
          }

          const updated = this.toolRegistry.updateAfterRebuild(toolId, buildResult.tool_config);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, tool: updated, plan, outputDir }));
          return;
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Refine failed' }));
          return;
        }
      }

      // Route: POST /api/scout (Trinh sát website thực thụ bằng Chrome & Playwright)
      if (pathname === '/api/scout' && method === 'POST') {
        const body = await this.parseJsonBody<{ url: string; headless?: boolean }>(req);
        if (!body.url) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url parameter' }));
          return;
        }

        try {
          const logs: Array<{ text: string; color: string }> = [];
          const scoutResult = await LiveScoutEngine.scoutUrl(
            body.url,
            (msg, color = 'cyan') => {
              logs.push({ text: msg, color });
            },
            { headless: body.headless ?? false }
          );

          if (!scoutResult.success || !scoutResult.map) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: scoutResult.error || 'Scout failed', logs }));
            return;
          }

          this.mapStore.saveMap(scoutResult.map);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              domain: scoutResult.domain,
              title: scoutResult.title,
              nodesCount: scoutResult.nodesCount,
              summaryByType: scoutResult.summaryByType,
              discoveredNodes: scoutResult.discoveredNodes,
              logs,
            })
          );
          return;
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Scout failed' }));
          return;
        }
      }

      // Route: POST /api/scout/mcp-import (Nạp trực tiếp từ Tab MCP Trình Duyệt đang mở)
      if (pathname === '/api/scout/mcp-import' && method === 'POST') {
        const body = await this.parseJsonBody<{
          domain: string;
          url: string;
          title: string;
          endpoints: string[];
          localStorageKeys: string[];
          domElements: Array<{ tag: string; selector: string; text: string; role: string }>;
        }>(req);

        if (!body.domain) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing domain' }));
          return;
        }

        try {
          const map = LiveScoutEngine.buildMapFromMcpData(body);
          this.mapStore.saveMap(map);

          const summaryByType = {
            domElements: map.base_nodes.filter(n => n.type === 'dom_element').length,
            endpoints: map.base_nodes.filter(n => n.type === 'endpoint').length,
            localPersistence: map.base_nodes.filter(n => n.type === 'local_persistence').length,
            webSockets: 0,
            headers: 0,
            states: map.state_graph.length,
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              domain: map.domain,
              title: body.title,
              nodesCount: map.base_nodes.length,
              summaryByType,
            })
          );
          return;
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'MCP Import failed' }));
          return;
        }
      }

      // Route: POST /api/agent/propose (AI Agent phân tích Prompt và đề xuất các phương án tạo Tool)
      if (pathname === '/api/agent/propose' && method === 'POST') {
        const body = await this.parseJsonBody<{ domain: string; prompt: string }>(req);
        if (!body.domain || !body.prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing domain or prompt parameter' }));
          return;
        }

        const map = this.mapStore.loadMap(body.domain);
        if (!map) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Map not found for domain: ${body.domain}` }));
          return;
        }

        try {
          const plan = ToolAgentPlanner.analyzeAndPropose(map, body.prompt);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, plan }));
          return;
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Agent proposal failed' }));
          return;
        }
      }

      // Route: POST /api/agent/build (Chốt & Triển khai tạo Tool)
      if (pathname === '/api/agent/build' && method === 'POST') {
        const body = await this.parseJsonBody<{
          domain: string;
          toolName: string;
          packageType?: string;
          actionSpecs: any[];
          paramValues?: Record<string, unknown>;
        }>(req);

        if (!body.domain || !body.toolName || !body.actionSpecs) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing domain, toolName, or actionSpecs' }));
          return;
        }

        const map = this.mapStore.loadMap(body.domain);
        if (!map) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Map not found for domain: ${body.domain}` }));
          return;
        }

        try {
          const factory = new ToolFactory();
          const outputDir = join(homedir(), '.devbrowsertool', 'tools', body.domain, body.toolName);

          const result = await factory.build(map, {
            tool_name: body.toolName,
            output_dir: outputDir,
            action_specs: body.actionSpecs,
            skip_dry_run: true,
            package_type: (body.packageType as any) || 'chrome_extension',
            param_values: body.paramValues,
          });

          if (!result.success || !result.tool_config) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: result.error || 'Build failed' }));
            return;
          }

          const tool = this.toolRegistry.registerTool(result.tool_config);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, tool, outputDir }));
          return;
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Build failed' }));
          return;
        }
      }

      // Route: POST /api/tools/build (Legacy fallback build)
      if (pathname === '/api/tools/build' && method === 'POST') {
        const body = await this.parseJsonBody<{ domain: string; package_type?: string }>(req);
        if (!body.domain) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing domain parameter' }));
          return;
        }

        const map = this.mapStore.loadMap(body.domain);
        if (!map) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Map not found for domain: ${body.domain}` }));
          return;
        }

        const factory = new ToolFactory();
        const outputDir = join(homedir(), '.devbrowsertool', 'tools', body.domain);
        const specs = map.base_nodes.map(n => ({
          intent: n.intent,
          action_type: (n.type === 'dom_element' ? 'click' : 'extract') as any,
          on_failure: 'stop' as const,
        }));

        const result = await factory.build(map, {
          tool_name: `${body.domain.replace(/[^a-zA-Z0-9]/g, '')}_Tool`,
          output_dir: outputDir,
          action_specs: specs,
          skip_dry_run: true,
          package_type: (body.package_type as any) || 'chrome_extension',
        });

        if (!result.success || !result.tool_config) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.error || 'Build failed' }));
          return;
        }

        const tool = this.toolRegistry.registerTool(result.tool_config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tool }));
        return;
      }
    }

    // 404 cho các routes khác
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint Not Found' }));
  }

  /**
   * Sinh HTML nhúng sẵn giao diện Studio 2 cột cao cấp.
   */
  private generateHtmlPage(): string {
    const domains = this.mapStore.listDomains();
    const rawTools = this.toolRegistry.listTools();
    const tools = rawTools.map(t => {
      const map = this.mapStore.loadMap(t.target_domain);
      const health = map ? this.toolRegistry.checkToolHealth(t.id, map) : { status: t.status };
      return {
        id: t.id,
        name: t.name,
        target_domain: t.target_domain,
        package_type: t.package_type,
        status: health.status,
        built_revision: t.map_content_revision,
        current_revision: map?.content_revision ?? t.map_content_revision,
        has_drift: (map?.content_revision ?? t.map_content_revision) > t.map_content_revision,
        circuit_breaker_tripped: t.circuit_breaker_tripped,
      };
    });

    return generateStudioHtml({
      domains,
      tools,
      csrfToken: this.csrfToken,
      isWebMode: true,
    });
  }
}
