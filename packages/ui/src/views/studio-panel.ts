/**
 * StudioPanel — Webview Panel cho DevBrowserTool Studio & Live HUD
 *
 * Cung cấp giao diện 2 cột hợp nhất:
 * - Bảng điều khiển tác vụ bên trái
 * - Real-Time Progress HUD bên phải (theo mẫu ảnh tham chiếu)
 */

import * as vscode from 'vscode';
import {
  MapStore,
  ToolRegistry,
  ToolFactory,
  type MapFile,
  MAP_CONSTANTS,
  LiveScoutEngine,
  ToolAgentPlanner,
} from '@devbrowsertool/core';
import { generateStudioHtml } from './studio-template.js';
import { MapViewerPanel } from './map-viewer-panel.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class StudioPanel {
  public static currentPanel: StudioPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly mapStore: MapStore;
  private readonly toolRegistry: ToolRegistry;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    mapStore: MapStore,
    toolRegistry: ToolRegistry,
    extensionUri?: vscode.Uri
  ): StudioPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (StudioPanel.currentPanel) {
      StudioPanel.currentPanel.panel.reveal(column);
      StudioPanel.currentPanel.refresh();
      return StudioPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'devbrowserStudio',
      'DevBrowser Studio & Live HUD',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    StudioPanel.currentPanel = new StudioPanel(panel, mapStore, toolRegistry);
    return StudioPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    mapStore: MapStore,
    toolRegistry: ToolRegistry
  ) {
    this.panel = panel;
    this.mapStore = mapStore;
    this.toolRegistry = toolRegistry;

    this.refresh();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Lắng nghe các sự kiện gửi lên từ Studio HTML
    this.panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'refresh':
            this.refresh();
            break;

          case 'scout':
            await this.handleScout(message.url);
            break;

          case 'agentPropose':
            await this.handleAgentPropose(message.domain, message.prompt);
            break;

          case 'agentBuild':
            await this.handleAgentBuild(
              message.domain,
              message.toolName,
              message.packageType,
              message.actionSpecs,
              message.paramValues
            );
            break;

          case 'buildTool':
            await this.handleBuildTool(message.domain);
            break;

          case 'rebuildTool':
            await this.handleRebuildTool(message.toolId);
            break;

          case 'startRecording':
            this.postLog(`🔴 Bắt đầu phiên ghi demo cho domain: ${message.domain}`, 'yellow');
            this.postProgress('Đang ghi nhận thao tác...', 1, 1);
            break;

          case 'stopRecording':
            this.postLog('⏹️ Đã dừng phiên ghi. Map đã được cập nhật!', 'green');
            this.refresh();
            break;

          case 'inspectMap':
            MapViewerPanel.createOrShow(this.mapStore, message.domain);
            break;

          case 'abort':
            this.postLog('🚨 ĐÃ KÍCH HOẠT CIRCUIT BREAKER NGẮT KHẨN CẤP!', 'red');
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public postLog(text: string, color: 'cyan' | 'yellow' | 'green' | 'red' | 'orange' = 'cyan'): void {
    this.panel.webview.postMessage({ type: 'log', text, color });
  }

  public postProgress(taskName: string, current: number, total: number): void {
    this.panel.webview.postMessage({ type: 'progress', taskName, current, total });
  }

  public refresh(): void {
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

    this.panel.webview.html = generateStudioHtml({
      domains,
      tools,
      isWebMode: false,
    });
  }

  private async handleScout(url: string): Promise<void> {
    try {
      this.postLog(`Bắt đầu trinh sát thực thụ trên trình duyệt: ${url}`, 'cyan');
      this.postProgress('Đang khởi chạy Chrome & bóc tách DOM...', 1, 3);

      const scoutResult = await LiveScoutEngine.scoutUrl(url, (msg, color = 'cyan') => {
        this.postLog(msg, color);
      });

      if (!scoutResult.success || !scoutResult.map) {
        this.postLog(`❌ Trinh sát thất bại: ${scoutResult.error || 'Lỗi không xác định'}`, 'red');
        this.postProgress('Trinh sát thất bại', 0, 0);
        return;
      }

      this.mapStore.saveMap(scoutResult.map);
      this.postLog(
        `✅ Map đã lưu: ${scoutResult.domain} với ${scoutResult.nodesCount} Resource Nodes!`,
        'green'
      );
      this.postProgress('Trinh sát hoàn tất!', 3, 3);

      this.panel.webview.postMessage({
        type: 'scoutComplete',
        domain: scoutResult.domain,
        title: scoutResult.title,
        nodesCount: scoutResult.nodesCount,
        discoveredNodes: scoutResult.discoveredNodes,
      });

      this.refresh();
    } catch (err: any) {
      this.postLog(`❌ Lỗi khi Scout: ${err.message}`, 'red');
      this.postProgress('Lỗi Scout', 0, 0);
    }
  }

  private async handleAgentPropose(domain: string, prompt: string): Promise<void> {
    try {
      this.postLog(`AI Agent đang phân tích Prompt: "${prompt}"...`, 'cyan');
      this.postProgress('Agent đang phân tích Resource Graph...', 1, 2);

      const map = this.mapStore.loadMap(domain);
      if (!map) {
        this.postLog(`Không tìm thấy Map cho domain: ${domain}`, 'red');
        return;
      }

      const plan = ToolAgentPlanner.analyzeAndPropose(map, prompt);
      this.postLog(`✨ ${plan.summary}`, 'yellow');
      this.postProgress('Đã sinh đề xuất kiến trúc', 2, 2);

      this.panel.webview.postMessage({
        type: 'proposalReady',
        plan,
      });
    } catch (err: any) {
      this.postLog(`❌ Lỗi phân tích: ${err.message}`, 'red');
    }
  }

  private async handleAgentBuild(
    domain: string,
    toolName: string,
    packageType: string = 'chrome_extension',
    actionSpecs: any[],
    paramValues?: Record<string, unknown>
  ): Promise<void> {
    try {
      this.postLog(`Bắt đầu đóng gói ${packageType} cho Tool "${toolName}"...`, 'cyan');
      this.postProgress('ToolFactory đang build...', 1, 3);

      const map = this.mapStore.loadMap(domain);
      if (!map) {
        this.postLog(`Không tìm thấy Map cho domain: ${domain}`, 'red');
        return;
      }

      const factory = new ToolFactory();
      const outputDir = join(homedir(), '.devbrowsertool', 'tools', domain, toolName);

      const result = await factory.build(map, {
        tool_name: toolName,
        output_dir: outputDir,
        action_specs: actionSpecs,
        skip_dry_run: true,
        package_type: packageType as any,
        param_values: paramValues,
      });

      if (!result.success || !result.tool_config) {
        this.postLog(`❌ Build thất bại: ${result.error || 'Lỗi không xác định'}`, 'red');
        return;
      }

      const tool = this.toolRegistry.registerTool(result.tool_config);
      this.postLog(`🎉 Đã tạo thành công Tool tại: ${outputDir}`, 'green');
      this.postProgress('Triển khai hoàn tất!', 3, 3);

      this.panel.webview.postMessage({
        type: 'buildComplete',
        tool,
        outputDir,
      });

      this.refresh();
    } catch (err: any) {
      this.postLog(`❌ Lỗi triển khai Tool: ${err.message}`, 'red');
    }
  }

  private async handleBuildTool(domain: string): Promise<void> {
    try {
      const map = this.mapStore.loadMap(domain);
      if (!map) {
        this.postLog(`❌ Không tìm thấy Map cho domain: ${domain}`, 'red');
        return;
      }

      this.postLog(`Bắt đầu đóng gói Extension cho ${domain}...`, 'cyan');
      this.postProgress('Biên dịch quy trình 5 bước...', 1, 2);

      const factory = new ToolFactory();
      const outputDir = join(homedir(), '.devbrowsertool', 'tools', domain);

      const specs = map.base_nodes.map(n => ({
        intent: n.intent,
        action_type: (n.type === 'dom_element' ? 'click' : 'extract') as any,
        on_failure: 'stop' as const,
      }));

      const buildResult = await factory.build(map, {
        tool_name: `${domain.replace(/[^a-zA-Z0-9]/g, '')}_Tool`,
        output_dir: outputDir,
        action_specs: specs,
        skip_dry_run: true,
      });

      if (!buildResult.success || !buildResult.tool_config) {
        this.postLog(`❌ Build thất bại: ${buildResult.error}`, 'red');
        return;
      }

      this.toolRegistry.registerTool(buildResult.tool_config);
      this.postLog(`✅ Đã đóng gói thành công Extension MV3 tại: ${outputDir}`, 'green');
      this.postProgress('Đóng gói hoàn tất', 2, 2);
      this.refresh();
    } catch (err: any) {
      this.postLog(`❌ Lỗi đóng gói: ${err.message}`, 'red');
    }
  }

  private async handleRebuildTool(toolId: string): Promise<void> {
    try {
      const tool = this.toolRegistry.getTool(toolId);
      if (!tool) {
        this.postLog(`❌ Không tìm thấy Tool: ${toolId}`, 'red');
        return;
      }

      const map = this.mapStore.loadMap(tool.target_domain);
      if (!map) {
        this.postLog(`❌ Không tìm thấy Map của ${tool.target_domain}`, 'red');
        return;
      }

      this.postLog(`Đang Rebuild 1-Click cho ${tool.name}...`, 'cyan');
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

      if (buildResult.success && buildResult.tool_config) {
        this.toolRegistry.updateAfterRebuild(toolId, buildResult.tool_config);
        this.postLog(`✅ Rebuild thành công! Tool đã cập nhật lên rev ${map.content_revision}`, 'green');
        this.refresh();
      }
    } catch (err: any) {
      this.postLog(`❌ Lỗi rebuild: ${err.message}`, 'red');
    }
  }

  public dispose(): void {
    StudioPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) x.dispose();
    }
  }
}
