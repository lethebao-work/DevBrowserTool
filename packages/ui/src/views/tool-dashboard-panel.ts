/**
 * ToolDashboardPanel — VS Code Webview Panel cho Tool Dashboard (Mục 10 Lớp 3)
 *
 * Nhiệm vụ:
 * 1. Hiển thị danh sách các Tool đã build, kèm Map version đang dùng (schema_version + content_revision).
 * 2. Phát hiện độ lệch (Drift Detection) so với Map mới nhất trong MapStore.
 * 3. Hiển thị trạng thái Circuit Breaker và nhật ký lỗi có cấu trúc gần nhất (StructuredLogEntry).
 * 4. Cung cấp nút 1-click "Yêu cầu Nhà máy build lại (Rebuild Tool)" trực tiếp từ giao diện.
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  MapStore,
  ToolRegistry,
  type RegisteredTool,
  type MapFile,
  ToolFactory,
} from '@devbrowsertool/core';

export class ToolDashboardPanel {
  public static currentPanel: ToolDashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly mapStore: MapStore;
  private readonly toolRegistry: ToolRegistry;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, mapStore: MapStore, toolRegistry: ToolRegistry) {
    this.panel = panel;
    this.mapStore = mapStore;
    this.toolRegistry = toolRegistry;

    this.updateWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Lắng nghe lệnh từ Webview HTML
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            this.updateWebview();
            break;

          case 'rebuildTool':
            await this.handleRebuildTool(message.toolId);
            break;

          case 'showLogs':
            this.handleShowLogs(message.toolId);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(mapStore: MapStore, toolRegistry: ToolRegistry): ToolDashboardPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ToolDashboardPanel.currentPanel) {
      ToolDashboardPanel.currentPanel.panel.reveal(column);
      ToolDashboardPanel.currentPanel.updateWebview();
      return ToolDashboardPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'devBrowserToolDashboard',
      '🛠️ Tool Dashboard — DevBrowserTool',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    ToolDashboardPanel.currentPanel = new ToolDashboardPanel(panel, mapStore, toolRegistry);
    return ToolDashboardPanel.currentPanel;
  }

  private async handleRebuildTool(toolId: string): Promise<void> {
    const tool = this.toolRegistry.getTool(toolId);
    if (!tool) {
      vscode.window.showErrorMessage(`Không tìm thấy Tool với ID: ${toolId}`);
      return;
    }

    const map = this.mapStore.loadMap(tool.target_domain);
    if (!map) {
      vscode.window.showErrorMessage(`Không tìm thấy Map cho domain: ${tool.target_domain}`);
      return;
    }

    try {
      vscode.window.showInformationMessage(`🔄 Đang build lại Tool [${tool.name}] từ Map rev ${map.content_revision}...`);

      const factory = new ToolFactory();
      const specs = tool.config.actions.map(a => ({
        intent: a.description || a.type,
        action_type: a.type,
        on_failure: a.on_failure,
      }));

      const result = await factory.build(map, {
        tool_name: tool.name,
        output_dir: join(homedir(), '.devbrowsertool', 'tools', tool.target_domain),
        action_specs: specs,
        skip_dry_run: true,
      });

      if (!result.success || !result.tool_config) {
        throw new Error(result.error || 'Build thất bại.');
      }

      const updatedTool = this.toolRegistry.updateAfterRebuild(toolId, result.tool_config);
      this.updateWebview();

      vscode.window.showInformationMessage(
        `✅ Đã build lại thành công Tool [${tool.name}] (Revision mới: ${updatedTool.map_content_revision}). Circuit Breaker đã được reset!`
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Lỗi khi build lại Tool: ${err.message}`);
    }
  }

  private handleShowLogs(toolId: string): void {
    const tool = this.toolRegistry.getTool(toolId);
    if (!tool || tool.recent_errors.length === 0) {
      vscode.window.showInformationMessage(`Tool [${tool?.name || toolId}] chưa ghi nhận lỗi nào.`);
      return;
    }

    const logText = tool.recent_errors
      .map(e => `[${new Date(e.timestamp).toLocaleTimeString()}] [${e.level.toUpperCase()}] ${e.message}\nNode: ${e.node_id || 'N/A'}, Fallback: ${e.used_fallback_variant}`)
      .join('\n\n');

    vscode.workspace.openTextDocument({ content: logText, language: 'plaintext' }).then(doc => {
      vscode.window.showTextDocument(doc, { preview: true });
    });
  }

  private updateWebview(): void {
    const tools = this.toolRegistry.listTools();
    const toolsWithHealth = tools.map(t => {
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
      return { tool: t, health };
    });

    this.panel.webview.html = this.generateHtml(toolsWithHealth);
  }

  private generateHtml(items: Array<{ tool: RegisteredTool; health: any }>): string {
    const cardsHtml =
      items.length === 0
        ? `
        <div style="text-align: center; padding: 60px 20px; color: #94a3b8;">
          <div style="font-size: 40px; margin-bottom: 12px;">📦</div>
          <h3 style="margin: 0; color: #e2e8f0;">Chưa có Tool nào được đóng gói</h3>
          <p style="margin-top: 8px; font-size: 13px;">Hãy ghi demo hoặc tạo Map và dùng lệnh <code>DevBrowserTool: Build Tool</code> để bắt đầu.</p>
        </div>
      `
        : items
            .map(({ tool, health }) => {
              let badgeBg = '#065f46';
              let badgeColor = '#34d399';
              let badgeText = 'HEALTHY';

              if (health.status === 'circuit_broken') {
                badgeBg = '#7f1d1d';
                badgeColor = '#f87171';
                badgeText = 'CIRCUIT BREAKER TRIPPED';
              } else if (health.has_drift) {
                badgeBg = '#78350f';
                badgeColor = '#fbbf24';
                badgeText = `DRIFT: MAP REV ${health.current_map_revision} (BUILT REV ${health.built_revision})`;
              }

              return `
          <div class="tool-card">
            <div class="tool-header">
              <div>
                <h3 class="tool-name">${tool.name}</h3>
                <span class="tool-domain">🌐 ${tool.target_domain} • <span style="text-transform: capitalize;">${tool.package_type.replace('_', ' ')}</span></span>
              </div>
              <span class="status-badge" style="background: ${badgeBg}; color: ${badgeColor};">${badgeText}</span>
            </div>
            <p class="tool-desc">${tool.description || 'Không có mô tả.'}</p>
            <div class="tool-meta">
              <span>Đã thực thi: <strong>${tool.execution_count}</strong> lần</span>
              <span>Lần chạy cuối: <strong>${tool.last_executed ? new Date(tool.last_executed).toLocaleString() : 'Chưa chạy'}</strong></span>
              <span>Lỗi gần nhất: <strong>${tool.recent_errors.length}</strong></span>
            </div>
            <div class="tool-actions">
              <button class="btn btn-secondary" onclick="showLogs('${tool.id}')">Xem Log (${tool.recent_errors.length})</button>
              <button class="btn btn-primary" onclick="rebuildTool('${tool.id}')">
                ${health.has_drift ? '⚡ Nâng Cấp & Build Lại' : '🔄 Build Lại (Rebuild)'}
              </button>
            </div>
          </div>
        `;
            })
            .join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tool Dashboard — DevBrowserTool</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      padding: 24px;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #1e293b;
    }
    .header h1 {
      font-size: 20px;
      margin: 0;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn {
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary { background: #0284c7; color: #fff; }
    .btn-primary:hover { background: #0369a1; }
    .btn-secondary { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; }
    .btn-secondary:hover { background: #334155; }
    .tool-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 16px;
    }
    .tool-card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 18px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
    }
    .tool-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }
    .tool-name {
      margin: 0 0 4px 0;
      font-size: 16px;
      color: #f1f5f9;
    }
    .tool-domain {
      font-size: 12px;
      color: #94a3b8;
    }
    .status-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 6px;
      letter-spacing: 0.05em;
    }
    .tool-desc {
      font-size: 13px;
      color: #cbd5e1;
      margin: 0 0 14px 0;
      line-height: 1.4;
    }
    .tool-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: #94a3b8;
      background: #0f172a;
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 14px;
    }
    .tool-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🛠️ Tool Dashboard <span style="font-size: 13px; color: #94a3b8; font-weight: normal;">(Mục 10 Lớp 3)</span></h1>
    <button class="btn btn-secondary" onclick="refresh()">🔄 Làm mới</button>
  </div>
  <div class="tool-grid">
    ${cardsHtml}
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }

    function rebuildTool(toolId) {
      vscode.postMessage({ command: 'rebuildTool', toolId });
    }

    function showLogs(toolId) {
      vscode.postMessage({ command: 'showLogs', toolId });
    }
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    ToolDashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }
}
