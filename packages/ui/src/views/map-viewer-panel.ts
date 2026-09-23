/**
 * MapViewerPanel — Quản lý Webview Panel hiển thị Map Viewer & Inspector (Mục 10)
 *
 * Nhận và xử lý các thông điệp từ giao diện người dùng:
 * - Thêm / sửa / xoá variant thủ công (Mục 10 lớp 2)
 * - Chạy dry-run kiểm thử (Mục 10 lớp 1)
 * - Xuất / Nhập JSON (Mục 4)
 * - Build Extension tự động qua ToolFactory (Mục 5)
 */

import * as vscode from 'vscode';
import {
  MapStore,
  MAP_CONSTANTS,
  type MapFile,
  type DryRunReport,
  ToolFactory,
  DryRunRunner,
  ActionCompiler,
} from '@devbrowsertool/core';
import { generateWebviewHtml } from './html-template.js';

export class MapViewerPanel {
  public static currentPanel: MapViewerPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly mapStore: MapStore;
  private currentDomain: string;
  private currentMap: MapFile | null = null;
  private lastDryRunReport?: DryRunReport;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, mapStore: MapStore, domain: string) {
    this.panel = panel;
    this.mapStore = mapStore;
    this.currentDomain = domain;

    this.loadMap();
    this.updateWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Lắng nghe messages từ Webview HTML
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            this.loadMap();
            this.updateWebview();
            break;

          case 'addVariant':
            await this.handleAddVariant(message.nodeId, message.formula, message.confidence);
            break;

          case 'deleteVariant':
            await this.handleDeleteVariant(message.nodeId, message.variantId);
            break;

          case 'export':
            await this.handleExport();
            break;

          case 'runDryRun':
            await this.handleRunDryRun();
            break;

          case 'build':
            await this.handleBuild();
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(mapStore: MapStore, domain: string): MapViewerPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (MapViewerPanel.currentPanel) {
      MapViewerPanel.currentPanel.currentDomain = domain;
      MapViewerPanel.currentPanel.loadMap();
      MapViewerPanel.currentPanel.updateWebview();
      MapViewerPanel.currentPanel.panel.reveal(column);
      return MapViewerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'devBrowserToolMapViewer',
      `Map Viewer: ${domain}`,
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    MapViewerPanel.currentPanel = new MapViewerPanel(panel, mapStore, domain);
    return MapViewerPanel.currentPanel;
  }

  private loadMap(): void {
    try {
      if (this.mapStore.hasMap(this.currentDomain)) {
        this.currentMap = this.mapStore.loadMap(this.currentDomain);
      } else {
        this.currentMap = null;
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Lỗi đọc Map: ${err instanceof Error ? err.message : String(err)}`);
      this.currentMap = null;
    }
  }

  private updateWebview(): void {
    this.panel.webview.html = generateWebviewHtml(this.currentMap, this.lastDryRunReport);
  }

  /**
   * Sửa tay / thêm variant thủ công vào Map (Mục 10 lớp 2: BẮT BUỘC)
   */
  private async handleAddVariant(nodeId: string, formula: string, confidence: number): Promise<void> {
    if (!this.currentMap) return;

    try {
      this.currentMap = this.mapStore.addVariant(this.currentMap, nodeId, {
        value_formula: formula,
        confidence: confidence,
        last_verified: Date.now(),
        ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
        fail_count_recent: 0,
        locale: null,
      });

      this.mapStore.saveMap(this.currentMap);
      vscode.window.showInformationMessage(`Đã thêm biến thể mới cho node "${nodeId}".`);
      this.updateWebview();
    } catch (err) {
      vscode.window.showErrorMessage(`Lỗi thêm biến thể: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Xóa variant khỏi node
   */
  private async handleDeleteVariant(nodeId: string, variantId: string): Promise<void> {
    if (!this.currentMap) return;

    try {
      const nodeIndex = this.currentMap.base_nodes.findIndex(n => n.id === nodeId);
      if (nodeIndex === -1) return;

      const node = this.currentMap.base_nodes[nodeIndex];
      const newVariants = node.variants.filter(v => v.id !== variantId);

      const newNodes = [...this.currentMap.base_nodes];
      newNodes[nodeIndex] = { ...node, variants: newVariants, updated_at: Date.now() };

      this.currentMap = { ...this.currentMap, base_nodes: newNodes, updated_at: Date.now() };
      this.mapStore.saveMap(this.currentMap);

      vscode.window.showInformationMessage(`Đã xóa biến thể.`);
      this.updateWebview();
    } catch (err) {
      vscode.window.showErrorMessage(`Lỗi xóa biến thể: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Xuất Map ra file JSON
   */
  private async handleExport(): Promise<void> {
    if (!this.currentMap) return;

    try {
      const json = this.mapStore.exportMapJson(this.currentDomain, true);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`map-${this.currentDomain}.json`),
        filters: { 'JSON Files': ['json'] },
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
        vscode.window.showInformationMessage(`Đã xuất Map ra file: ${uri.fsPath}`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Lỗi xuất Map: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Chạy Dry-run và cập nhật bảng kết quả vào giao diện
   */
  private async handleRunDryRun(): Promise<void> {
    if (!this.currentMap || this.currentMap.base_nodes.length === 0) {
      vscode.window.showWarningMessage('Chưa có node nào trong Map để chạy Dry-Run.');
      return;
    }

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Đang chạy Dry-Run qua ExecutionEngine...',
        cancellable: false,
      },
      async () => {
        try {
          // Tạo chuỗi actions từ các nodes có sẵn
          const specs = this.currentMap!.base_nodes.map(n => ({
            intent: n.intent,
            on_failure: 'stop' as const,
          }));

          const compiled = ActionCompiler.compileFromSpecs(this.currentMap!, specs);

          // Tạo browser giả lập cho dry-run verification
          const mockBrowser = {
            navigate: async () => ({ success: true, duration_ms: 10 }),
            evaluate: async () => ({ found: true, success: true, method: 'direct_value', role: 'button', name: 'btn' }),
            click: async () => ({ success: true, duration_ms: 20 }),
            fill: async () => ({ success: true, duration_ms: 25 }),
            screenshot: async () => Buffer.from(''),
            getUrl: async () => `https://${this.currentDomain}`,
          };

          this.lastDryRunReport = await DryRunRunner.run(mockBrowser as any, this.currentMap!, compiled.actions);
          this.updateWebview();
          vscode.window.showInformationMessage(
            `Dry-Run hoàn thành: ${this.lastDryRunReport.passed_steps}/${this.lastDryRunReport.total_steps} bước thành công.`
          );
        } catch (err) {
          vscode.window.showErrorMessage(`Lỗi khi chạy dry-run: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    );
  }

  /**
   * Đóng gói Chrome Extension từ Map
   */
  private async handleBuild(): Promise<void> {
    if (!this.currentMap) return;

    const folderUri = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Chọn thư mục xuất Extension',
    });

    if (!folderUri || folderUri.length === 0) return;
    const outputDir = folderUri[0].fsPath;

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Nhà máy đang đóng gói Chrome Extension...',
        cancellable: false,
      },
      async () => {
        try {
          const factory = new ToolFactory();
          const specs = this.currentMap!.base_nodes.map(n => ({
            intent: n.intent,
            on_failure: 'stop' as const,
          }));

          const result = await factory.build(this.currentMap!, {
            tool_name: `${this.currentDomain.replace(/[^a-zA-Z0-9]/g, '')}_Tool`,
            output_dir: outputDir,
            action_specs: specs,
            skip_dry_run: true,
          });

          if (result.success) {
            vscode.window.showInformationMessage(`Đóng gói thành công tại: ${outputDir}`);
          } else {
            vscode.window.showErrorMessage(`Build thất bại: ${result.error}`);
          }
        } catch (err) {
          vscode.window.showErrorMessage(`Lỗi build: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    );
  }

  public dispose(): void {
    MapViewerPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
