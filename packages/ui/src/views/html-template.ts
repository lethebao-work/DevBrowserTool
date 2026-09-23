/**
 * Webview HTML Template — Giao diện Map Viewer & Inspector (Mục 10 lớp 1 & lớp 2)
 *
 * Tích hợp:
 * - Graph & Node Viewer (Lớp 2)
 * - Node Inspector với chi tiết confidence, TTL, decay (Lớp 2)
 * - Form sửa tay / thêm variant thủ công BẮT BUỘC (Mục 10 lớp 2)
 * - Dry-run result table chi tiết từng bước (Lớp 1)
 * - Parameterizer input form (Mục 5.2 bước 3)
 */

import type { MapFile, ResourceNode } from '@devbrowsertool/core';
import type { DryRunReport } from '@devbrowsertool/core';

export function generateWebviewHtml(map: MapFile | null, dryRunReport?: DryRunReport): string {
  const mapDataJson = JSON.stringify(map ?? {});
  const dryRunJson = JSON.stringify(dryRunReport ?? null);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevBrowserTool — Map Viewer & Inspector</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e2e);
      --card-bg: var(--vscode-sideBar-background, #252538);
      --text: var(--vscode-editor-foreground, #cdd6f4);
      --text-muted: var(--vscode-descriptionForeground, #a6adc8);
      --primary: #89b4fa;
      --primary-hover: #b4befe;
      --accent: #f5c2e7;
      --success: #a6e3a1;
      --warning: #f9e2af;
      --error: #f38ba8;
      --border: var(--vscode-widget-border, #313244);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 16px;
      line-height: 1.5;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }

    .header h1 {
      font-size: 20px;
      font-weight: 600;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-primary { background: rgba(137, 180, 250, 0.2); color: var(--primary); }
    .badge-success { background: rgba(166, 227, 161, 0.2); color: var(--success); }
    .badge-warning { background: rgba(249, 226, 175, 0.2); color: var(--warning); }
    .badge-error { background: rgba(243, 139, 168, 0.2); color: var(--error); }

    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }

    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 8px 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }

    .tab-btn.active {
      color: var(--primary);
      border-bottom-color: var(--primary);
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .grid-layout {
      display: grid;
      grid-template-columns: 1fr 1.2fr;
      gap: 16px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .card h2 {
      font-size: 14px;
      color: var(--primary);
      margin-bottom: 12px;
      font-weight: 600;
    }

    .node-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 500px;
      overflow-y: auto;
    }

    .node-item {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .node-item:hover, .node-item.selected {
      border-color: var(--primary);
      background: rgba(137, 180, 250, 0.08);
    }

    .node-title {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
    }

    .node-meta {
      font-size: 11px;
      color: var(--text-muted);
    }

    .confidence-bar {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 6px;
    }

    .confidence-fill {
      height: 100%;
      background: var(--success);
      border-radius: 3px;
      transition: width 0.3s;
    }

    .form-group {
      margin-bottom: 12px;
    }

    .form-group label {
      display: block;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 4px;
      font-weight: 500;
    }

    .form-control {
      width: 100%;
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: inherit;
      font-size: 12px;
    }

    .form-control:focus {
      outline: none;
      border-color: var(--primary);
    }

    .btn {
      padding: 8px 14px;
      border-radius: 4px;
      border: none;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary { background: var(--primary); color: #11111b; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-secondary { background: rgba(255, 255, 255, 0.1); color: var(--text); }
    .btn-danger { background: rgba(243, 139, 168, 0.2); color: var(--error); }

    .variant-card {
      background: rgba(0, 0, 0, 0.15);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .variant-formula {
      font-family: monospace;
      font-size: 11px;
      color: var(--text);
      word-break: break-all;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 10px;
    }

    th, td {
      text-align: left;
      padding: 8px;
      border-bottom: 1px solid var(--border);
    }

    th { color: var(--text-muted); font-weight: 600; }
  </style>
</head>
<body>
  <div class="header">
    <h1>
      <span>🌐</span>
      <span>${map ? map.domain : 'Chưa có Map nào'}</span>
      <span class="badge badge-primary">Rev ${map ? map.content_revision : 0}</span>
      <span class="badge badge-success">v${map ? map.schema_version : '1.0.0'}</span>
    </h1>
    <div>
      <button class="btn btn-secondary" onclick="postAction('refresh')">🔄 Làm mới</button>
      <button class="btn btn-secondary" onclick="postAction('export')">💾 Xuất JSON</button>
      <button class="btn btn-primary" onclick="postAction('build')">⚡ Build Extension</button>
    </div>
  </div>

  <div class="tabs">
    <button class="tab-btn active" onclick="switchTab('tab-nodes')">🗺️ Resource Nodes (${map ? map.base_nodes.length : 0})</button>
    <button class="tab-btn" onclick="switchTab('tab-graph')">🕸️ State Graph (${map ? map.state_graph.length : 0})</button>
    <button class="tab-btn" onclick="switchTab('tab-dryrun')">🧪 Dry-Run Result Table</button>
  </div>

  <!-- TAB 1: NODES & INSPECTOR -->
  <div id="tab-nodes" class="tab-content active">
    <div class="grid-layout">
      <!-- Cột trái: Danh sách Node -->
      <div class="card">
        <h2>Resource Nodes</h2>
        <div class="node-list" id="nodeListContainer">
          ${(map?.base_nodes ?? []).map((node, idx) => `
            <div class="node-item ${idx === 0 ? 'selected' : ''}" onclick="selectNode('${node.id}')" id="node-${node.id}">
              <div class="node-title">
                <span>${node.intent}</span>
                <span class="badge badge-primary">${node.type}</span>
              </div>
              <div class="node-meta">Variants: ${node.variants.length} | ID: ${node.id}</div>
              <div class="confidence-bar">
                <div class="confidence-fill" style="width: ${(node.variants[0]?.confidence ?? 0) * 100}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Cột phải: Inspector & Manual Variant Editing (Mục 10 lớp 2) -->
      <div class="card" id="inspectorCard">
        <h2>Node Inspector & Sửa Tay Variant</h2>
        <div id="inspectorContent">
          <p style="color: var(--text-muted);">Chọn một node ở danh sách bên trái để kiểm tra và chỉnh sửa variant thủ công.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB 2: STATE GRAPH -->
  <div id="tab-graph" class="tab-content">
    <div class="card">
      <h2>State-Transition Graph</h2>
      ${(map?.state_graph ?? []).length === 0 ? '<p style="color: var(--text-muted)">Chưa có StateNode nào được cấu hình trong Map.</p>' : ''}
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${(map?.state_graph ?? []).map(state => `
          <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 6px; border: 1px solid var(--border);">
            <div style="font-weight: 600; color: var(--primary); margin-bottom: 6px;">State: ${state.id} (${state.match_key.url_pattern ?? 'No URL pattern'})</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">
              Preconditions: ${state.preconditions.length > 0 ? state.preconditions.join(', ') : 'None'}
            </div>
            <div style="font-size: 12px;">
              <strong>Transitions:</strong>
              <ul style="margin-left: 20px; margin-top: 4px;">
                ${state.transitions.map(t => `<li>Action <code>${t.action_ref}</code> ➔ <strong>${t.target_state_id}</strong></li>`).join('')}
              </ul>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </div>

  <!-- TAB 3: DRY RUN RESULT TABLE (Mục 10 lớp 1) -->
  <div id="tab-dryrun" class="tab-content">
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2>Bảng Kết Quả Dry-Run (Execution Verification)</h2>
        <button class="btn btn-primary" onclick="postAction('runDryRun')">▶️ Chạy Dry-Run</button>
      </div>

      <div id="dryRunSummary" style="margin: 12px 0;">
        ${dryRunReport ? `
          <span class="badge ${dryRunReport.success ? 'badge-success' : 'badge-error'}">
            ${dryRunReport.success ? 'SUCCESS' : 'FAILED'}: ${dryRunReport.passed_steps}/${dryRunReport.total_steps} Passed
          </span>
          <span style="font-size: 12px; color: var(--text-muted); margin-left: 10px;">
            Tổng thời gian: ${dryRunReport.duration_total_ms}ms
          </span>
        ` : '<p style="color: var(--text-muted)">Chưa có dữ liệu dry-run. Nhấn "Chạy Dry-Run" để kiểm thử chuỗi hành động.</p>'}
      </div>

      <table id="dryRunTable">
        <thead>
          <tr>
            <th>#</th>
            <th>Loại Action</th>
            <th>Mục Tiêu / Intent</th>
            <th>Trạng Thái</th>
            <th>Variant Sử Dụng</th>
            <th>Thời Gian</th>
            <th>Chi Tiết Lỗi</th>
          </tr>
        </thead>
        <tbody>
          ${(dryRunReport?.rows ?? []).map((r: any) => `
            <tr>
              <td>${r.step_index}</td>
              <td><code>${r.action_type}</code></td>
              <td><strong>${r.target_intent}</strong></td>
              <td>
                <span class="badge ${r.status === 'PASS' ? 'badge-success' : (r.status === 'FAIL' ? 'badge-error' : 'badge-warning')}">
                  ${r.status}
                </span>
              </td>
              <td><span style="font-family: monospace;">${r.variant_used}</span></td>
              <td>${r.duration_ms}ms</td>
              <td style="color: var(--error);">${r.error ?? '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const mapData = ${mapDataJson};
    let selectedNodeId = mapData.base_nodes && mapData.base_nodes.length > 0 ? mapData.base_nodes[0].id : null;

    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(tabId).classList.add('active');
    }

    function selectNode(nodeId) {
      selectedNodeId = nodeId;
      document.querySelectorAll('.node-item').forEach(el => el.classList.remove('selected'));
      const activeEl = document.getElementById('node-' + nodeId);
      if (activeEl) activeEl.classList.add('selected');
      renderInspector();
    }

    function renderInspector() {
      const container = document.getElementById('inspectorContent');
      if (!selectedNodeId || !mapData.base_nodes) return;
      const node = mapData.base_nodes.find(n => n.id === selectedNodeId);
      if (!node) return;

      let html = \`
        <div style="margin-bottom: 16px;">
          <div style="font-size: 16px; font-weight: 600; color: var(--text);">\${node.intent}</div>
          <div style="font-size: 12px; color: var(--text-muted);">ID: \${node.id} | Loại: \${node.type}</div>
        </div>

        <h3 style="font-size: 13px; color: var(--primary); margin-bottom: 8px;">Danh sách Biến Thể (Variants - \${node.variants.length}/5)</h3>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;">
          \${node.variants.map((v, i) => \`
            <div class="variant-card">
              <div style="flex: 1; margin-right: 8px;">
                <div class="variant-formula">\${v.value_formula}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                  Confidence: <strong>\${(v.confidence * 100).toFixed(0)}%</strong> | TTL: \${(v.ttl_ms / (24*3600*1000)).toFixed(0)} ngày
                </div>
              </div>
              <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="deleteVariant('\${node.id}', '\${v.id}')">Xóa</button>
            </div>
          \`).join('')}
        </div>

        <!-- FORM SỬA TAY / THÊM VARIANT THỦ CÔNG (BẮT BUỘC THEO MỤC 10 LỚP 2) -->
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 6px; padding: 12px;">
          <h4 style="font-size: 12px; color: var(--accent); margin-bottom: 8px;">➕ Thêm / Sửa Biến Thể Thủ Công</h4>
          <div class="form-group">
            <label>Công thức định vị (Formula / CSS / Selector / Role):</label>
            <input type="text" id="inputFormula" class="form-control" placeholder="ví dụ: document.querySelector('#btn-login')">
          </div>
          <div class="form-group">
            <label>Điểm tin cậy (Confidence: <span id="confDisplay">0.90</span>):</label>
            <input type="range" id="inputConfidence" min="0.1" max="1.0" step="0.05" value="0.90" style="width: 100%;" oninput="document.getElementById('confDisplay').innerText = this.value">
          </div>
          <button class="btn btn-primary" onclick="submitManualVariant('\${node.id}')">Lưu Biến Thể</button>
        </div>
      \`;

      container.innerHTML = html;
    }

    function submitManualVariant(nodeId) {
      const formula = document.getElementById('inputFormula').value.trim();
      const confidence = parseFloat(document.getElementById('inputConfidence').value);
      if (!formula) {
        alert('Vui lòng nhập công thức định vị');
        return;
      }

      vscode.postMessage({
        command: 'addVariant',
        nodeId,
        formula,
        confidence
      });
    }

    function deleteVariant(nodeId, variantId) {
      vscode.postMessage({
        command: 'deleteVariant',
        nodeId,
        variantId
      });
    }

    function postAction(cmd) {
      vscode.postMessage({ command: cmd });
    }

    // Auto-render first node inspector on load
    if (selectedNodeId) {
      renderInspector();
    }
  </script>
</body>
</html>`;
}
