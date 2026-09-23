/**
 * Status Bar Controller — Tín hiệu "chế độ ghi" trong IDE (Mục 0.9.3 & 3.2)
 *
 * Hiển thị cảnh báo trực quan trên thanh status bar khi đang ghi demo:
 * Chữ đỏ, biểu tượng $(record), nhấp nháy/thu hút sự chú ý.
 */

import * as vscode from 'vscode';

export class RecordingStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private isRecording: boolean = false;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1000 // Priority cao để hiển thị nổi bật ở góc trái
    );
    this.updateDisplay();
  }

  setRecording(recording: boolean, domain?: string): void {
    this.isRecording = recording;
    this.updateDisplay(domain);
  }

  private updateDisplay(domain?: string): void {
    if (this.isRecording) {
      this.statusBarItem.text = `$(record) DEMO RECORDING${domain ? ` [${domain}]` : ''}`;
      this.statusBarItem.tooltip = 'Đang ghi nhận demo thao tác browser. Nhấn để dừng ghi.';
      this.statusBarItem.command = 'devbrowsertool.stopRecording';
      this.statusBarItem.color = '#ff4d4f'; // Màu đỏ cảnh báo
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.statusBarItem.show();
    } else {
      this.statusBarItem.text = '$(globe) DevBrowserTool';
      this.statusBarItem.tooltip = 'DevBrowserTool: Nhấn để mở Map Viewer & Inspector';
      this.statusBarItem.command = 'devbrowsertool.openMapViewer';
      this.statusBarItem.color = undefined;
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.show();
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
