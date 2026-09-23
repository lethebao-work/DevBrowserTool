/**
 * DevBrowserTool VS Code Extension Entry Point (Mục 0.9 & Mục 10)
 *
 * Khởi tạo và đăng ký các commands:
 * - openMapViewer: Mở giao diện trực quan Map Viewer & Node Inspector
 * - startRecording: Bắt đầu phiên ghi demo với đèn cảnh báo đỏ trên Status Bar
 * - stopRecording: Dừng phiên ghi demo và lưu Map
 * - buildTool: Đóng gói Chrome Extension trực tiếp từ Map
 * - exportMap: Xuất file JSON
 * - importMap: Nhập file JSON
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { MapStore, ToolRegistry } from '@devbrowsertool/core';
import { RecordingStatusBar } from './status-bar.js';
import { MapViewerPanel } from './views/map-viewer-panel.js';
import { ToolDashboardPanel } from './views/tool-dashboard-panel.js';
import { StudioPanel } from './views/studio-panel.js';

let statusBar: RecordingStatusBar | undefined;
let activeRecordingDomain: string | null = null;

function getMapsDirectory(): string {
  // Ưu tiên thư mục .devbrowsertool trong workspace nếu có, ngược lại dùng home dir
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return join(workspaceFolders[0].uri.fsPath, '.devbrowsertool', 'maps');
  }
  return join(homedir(), '.devbrowsertool', 'maps');
}

function getToolsDirectory(): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return join(workspaceFolders[0].uri.fsPath, '.devbrowsertool');
  }
  return join(homedir(), '.devbrowsertool');
}

export function activate(context: vscode.ExtensionContext): void {
  const mapsDir = getMapsDirectory();
  const mapStore = new MapStore(mapsDir);
  const toolRegistry = new ToolRegistry(getToolsDirectory());

  statusBar = new RecordingStatusBar();
  context.subscriptions.push(statusBar);

  // 0. Primary Command: Open Unified Studio & Live HUD
  const openStudioCmd = vscode.commands.registerCommand('devbrowsertool.openStudio', () => {
    StudioPanel.createOrShow(mapStore, toolRegistry);
  });

  // 1. Command: Open Map Viewer (mở Studio Dashboard)
  const openViewerCmd = vscode.commands.registerCommand('devbrowsertool.openMapViewer', async () => {
    StudioPanel.createOrShow(mapStore, toolRegistry);
  });

  // 2. Command: Start Recording Demo
  const startRecordingCmd = vscode.commands.registerCommand('devbrowsertool.startRecording', async () => {
    const domain = await vscode.window.showInputBox({
      prompt: 'Nhập domain cần ghi Demo thao tác (ví dụ: github.com)',
      placeHolder: 'github.com',
    });

    if (!domain) return;

    activeRecordingDomain = domain;
    statusBar?.setRecording(true, domain);
    vscode.window.showWarningMessage(
      `🔴 ĐÃ BẬT CHẾ ĐỘ GHI DEMO CHO [${domain}]. Mọi thao tác browser sẽ được ghi nhận vào Map!`
    );
  });

  // 3. Command: Stop Recording Demo
  const stopRecordingCmd = vscode.commands.registerCommand('devbrowsertool.stopRecording', async () => {
    if (!activeRecordingDomain) {
      vscode.window.showInformationMessage('Hiện không có phiên ghi demo nào đang chạy.');
      return;
    }

    const domain = activeRecordingDomain;
    activeRecordingDomain = null;
    statusBar?.setRecording(false);

    vscode.window.showInformationMessage(`⏹️ Đã dừng phiên ghi demo cho [${domain}].`);
    MapViewerPanel.createOrShow(mapStore, domain);
  });

  // 4. Command: Build Tool from Map
  const buildToolCmd = vscode.commands.registerCommand('devbrowsertool.buildTool', async () => {
    const domains = mapStore.listDomains();
    if (domains.length === 0) {
      vscode.window.showWarningMessage('Chưa có Map domain nào để build Tool.');
      return;
    }

    const domain = await vscode.window.showQuickPick(domains, {
      placeHolder: 'Chọn domain để build Chrome Extension',
    });

    if (domain) {
      MapViewerPanel.createOrShow(mapStore, domain);
    }
  });

  // 5. Command: Export Map
  const exportMapCmd = vscode.commands.registerCommand('devbrowsertool.exportMap', async () => {
    const domains = mapStore.listDomains();
    if (domains.length === 0) {
      vscode.window.showWarningMessage('Chưa có Map nào để xuất.');
      return;
    }

    const domain = await vscode.window.showQuickPick(domains, { placeHolder: 'Chọn domain để xuất JSON' });
    if (!domain) return;

    try {
      const json = mapStore.exportMapJson(domain, true);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`map-${domain}.json`),
        filters: { 'JSON Files': ['json'] },
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf-8'));
        vscode.window.showInformationMessage(`Đã xuất Map ra file: ${uri.fsPath}`);
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Lỗi xuất Map: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // 6. Command: Import Map
  const importMapCmd = vscode.commands.registerCommand('devbrowsertool.importMap', async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 'JSON Files': ['json'] },
    });

    if (!uris || uris.length === 0) return;

    try {
      const content = await vscode.workspace.fs.readFile(uris[0]);
      const jsonStr = Buffer.from(content).toString('utf-8');
      const imported = mapStore.importMapJson(jsonStr, true);
      vscode.window.showInformationMessage(`Đã nhập Map thành công cho domain: ${imported.domain}`);
      MapViewerPanel.createOrShow(mapStore, imported.domain);
    } catch (err) {
      vscode.window.showErrorMessage(`Lỗi nhập Map: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // 7. Command: Open Tool Dashboard (Mục 10 Lớp 3)
  const openDashboardCmd = vscode.commands.registerCommand('devbrowsertool.openToolDashboard', () => {
    ToolDashboardPanel.createOrShow(mapStore, toolRegistry);
  });

  context.subscriptions.push(
    openStudioCmd,
    openViewerCmd,
    startRecordingCmd,
    stopRecordingCmd,
    buildToolCmd,
    exportMapCmd,
    importMapCmd,
    openDashboardCmd
  );
}

export function deactivate(): void {
  statusBar?.dispose();
  StudioPanel.currentPanel?.dispose();
  MapViewerPanel.currentPanel?.dispose();
  ToolDashboardPanel.currentPanel?.dispose();
}
