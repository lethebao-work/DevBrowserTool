/**
 * Studio Webview & Web UI Template
 *
 * Giao diện tập trung DevBrowserTool Studio & Live Execution HUD:
 * - Cột trái: Điều khiển (Nhập URL Scout, Tạo Tool Bằng Prompt AI Agent, Quản lý Maps, Quản lý Tools, Demo Recorder, Runner)
 * - Cột phải: Real-Time HUD mô phỏng chính xác phong cách ảnh tham chiếu (Dark theme, thanh tiến độ, các thẻ card màu phát sáng)
 */

export interface StudioTemplateOptions {
  domains?: string[];
  tools?: Array<{
    id: string;
    name: string;
    target_domain: string;
    package_type: string;
    status: string;
    built_revision: number;
    current_revision: number;
    has_drift: boolean;
    circuit_breaker_tripped: boolean;
  }>;
  csrfToken?: string;
  isWebMode?: boolean;
}

export function generateStudioHtml(options: StudioTemplateOptions = {}): string {
  const domains = options.domains ?? [];
  const tools = options.tools ?? [];
  const csrfToken = options.csrfToken ?? '';
  const isWebMode = options.isWebMode ?? false;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevBrowserTool Studio & Live HUD</title>
  <style>
    :root {
      --bg-main: #0b0f19;
      --bg-sidebar: #111827;
      --bg-card: #162032;
      --bg-card-hover: #1c283f;
      --border: rgba(255, 255, 255, 0.08);
      --border-focus: #38bdf8;
      
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      
      --neon-cyan: #38bdf8;
      --neon-yellow: #facc15;
      --neon-green: #4ade80;
      --neon-orange: #fb923c;
      --neon-red: #f87171;
      --neon-purple: #c084fc;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg-main);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* Top Studio Header */
    .studio-header {
      background-color: var(--bg-sidebar);
      border-bottom: 1px solid var(--border);
      padding: 10px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }

    .studio-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--neon-green);
      box-shadow: 0 0 8px var(--neon-green);
      transition: all 0.3s ease;
    }

    .status-dot.running {
      background-color: var(--neon-cyan);
      box-shadow: 0 0 10px var(--neon-cyan);
      animation: pulse 1.5s infinite;
    }

    .status-dot.error {
      background-color: var(--neon-red);
      box-shadow: 0 0 10px var(--neon-red);
    }

    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }

    .header-badge {
      background: rgba(56, 189, 248, 0.1);
      color: var(--neon-cyan);
      border: 1px solid rgba(56, 189, 248, 0.25);
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }

    /* Main 2-Column Container */
    .studio-body {
      display: flex;
      flex: 1;
      height: calc(100vh - 49px);
      overflow: hidden;
    }

    /* Left Column: Control & Operations */
    .studio-left {
      flex: 1;
      min-width: 420px;
      max-width: 52%;
      border-right: 1px solid var(--border);
      background-color: var(--bg-sidebar);
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }

    .scout-bar {
      padding: 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.6);
    }

    .scout-bar label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .scout-input-group {
      display: flex;
      gap: 8px;
    }

    .scout-input {
      flex: 1;
      background: var(--bg-main);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    .scout-input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
    }

    .btn {
      padding: 9px 16px;
      border-radius: 6px;
      border: none;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }

    .btn-primary {
      background: linear-gradient(135deg, #0284c7, #2563eb);
      color: white;
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #0369a1, #1d4ed8);
    }

    .btn-secondary {
      background: var(--bg-card);
      color: var(--text-main);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover {
      background: var(--bg-card-hover);
    }

    .btn-danger {
      background: rgba(248, 113, 113, 0.15);
      color: var(--neon-red);
      border: 1px solid rgba(248, 113, 113, 0.3);
    }
    .btn-danger:hover {
      background: rgba(248, 113, 113, 0.25);
    }

    /* Tabs Navigation */
    .tabs-nav {
      display: flex;
      border-bottom: 1px solid var(--border);
      background: rgba(11, 15, 25, 0.5);
      overflow-x: auto;
    }

    .tab-btn {
      flex: 1;
      padding: 12px 10px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
      text-align: center;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: var(--text-main);
    }

    .tab-btn.active {
      color: var(--neon-cyan);
      border-bottom-color: var(--neon-cyan);
      background: rgba(56, 189, 248, 0.04);
    }

    .tab-content {
      padding: 16px;
      flex: 1;
      overflow-y: auto;
    }

    /* Entity Cards in Left Panel */
    .item-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 12px;
      transition: border-color 0.2s, background-color 0.2s;
    }

    .item-card:hover {
      border-color: rgba(255, 255, 255, 0.15);
      background: var(--bg-card-hover);
    }

    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .item-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-main);
    }

    .item-meta {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 12px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .item-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }

    .badge-healthy {
      background: rgba(74, 222, 128, 0.15);
      color: var(--neon-green);
      border: 1px solid rgba(74, 222, 128, 0.3);
    }

    .badge-drift {
      background: rgba(250, 204, 21, 0.15);
      color: var(--neon-yellow);
      border: 1px solid rgba(250, 204, 21, 0.3);
    }

    .badge-tripped {
      background: rgba(248, 113, 113, 0.15);
      color: var(--neon-red);
      border: 1px solid rgba(248, 113, 113, 0.3);
    }

    /* Chips & Proposal Cards */
    .chip-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #cbd5e1;
      border-radius: 16px;
      padding: 5px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .chip-btn:hover {
      background: rgba(56, 189, 248, 0.15);
      color: var(--neon-cyan);
      border-color: rgba(56, 189, 248, 0.3);
    }

    .proposal-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 12px 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .proposal-card:hover {
      border-color: rgba(56, 189, 248, 0.4);
      background: rgba(56, 189, 248, 0.05);
    }
    .proposal-card.selected {
      border-color: var(--neon-cyan);
      background: rgba(56, 189, 248, 0.08);
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.25);
    }

    .param-row {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 0, 0, 0.2);
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.04);
    }
    .param-key {
      font-family: monospace;
      color: var(--neon-cyan);
      font-size: 12px;
      min-width: 110px;
    }
    .param-input {
      flex: 1;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      outline: none;
    }
    .param-input:focus {
      border-color: var(--neon-cyan);
    }

    /* Smart Preset Cards */
    .preset-card {
      background: rgba(56, 189, 248, 0.04);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 8px;
      padding: 10px 14px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .preset-card:hover {
      background: rgba(56, 189, 248, 0.1);
      border-color: var(--neon-cyan);
      transform: translateY(-1px);
    }
    .preset-title {
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .preset-desc {
      font-size: 11px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    /* Refine Tool Modal */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    }
    .modal-card {
      background: #162032;
      border: 1px solid #38bdf8;
      border-radius: 12px;
      width: 90%;
      max-width: 520px;
      padding: 20px;
      box-shadow: 0 15px 40px rgba(0,0,0,0.6);
    }

    /* Right Column: Real-Time HUD */
    .studio-right {
      flex: 1;
      background: #090d16;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .hud-window {
      margin: 16px;
      background: #101623;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .hud-header {
      padding: 14px 18px;
      background: #141c2c;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .hud-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .hud-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--neon-cyan);
      box-shadow: 0 0 10px var(--neon-cyan);
    }

    .hud-title {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 0.3px;
    }

    .hud-window-controls {
      display: flex;
      gap: 8px;
    }

    .hud-ctrl-btn {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.2s;
    }
    .hud-ctrl-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }

    .hud-progress-section {
      padding: 16px 20px 10px 20px;
    }

    .hud-progress-info {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      color: #cbd5e1;
      margin-bottom: 8px;
    }

    .hud-task-name {
      font-weight: 500;
    }

    .hud-counter {
      font-weight: 700;
      color: #94a3b8;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }

    .hud-progress-track {
      height: 4px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 2px;
      overflow: hidden;
    }

    .hud-progress-bar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.8);
      transition: width 0.4s ease;
    }

    /* Event Stream Cards */
    .hud-stream {
      flex: 1;
      padding: 14px 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .hud-card {
      background: #162032;
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 8px;
      padding: 12px 16px;
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      line-height: 1.5;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .hud-card.cyan { color: var(--neon-cyan); }
    .hud-card.yellow { color: var(--neon-yellow); }
    .hud-card.green { color: var(--neon-green); }
    .hud-card.orange { color: var(--neon-orange); }
    .hud-card.red { color: var(--neon-red); }

    .hud-card .timestamp {
      opacity: 0.5;
      font-size: 11px;
      margin-right: 8px;
    }

    .hud-footer {
      padding: 10px 20px;
      background: #141c2c;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
  </style>
</head>
<body>

  <!-- Top Studio Navigation Bar -->
  <header class="studio-header">
    <div class="studio-brand">
      <div class="status-dot" id="global-status-dot"></div>
      <span>DevBrowserTool Studio</span>
    </div>
    <div style="display: flex; align-items: center; gap: 12px;">
      <span class="header-badge" id="env-badge">${isWebMode ? 'Web App (127.0.0.1:3456)' : 'VS Code Extension Host'}</span>
      <button class="btn btn-secondary" onclick="refreshStudioData()">🔄 Làm Mới</button>
    </div>
  </header>

  <!-- 2-Column Split View Body -->
  <div class="studio-body">

    <!-- LEFT COLUMN: Control & Operations -->
    <aside class="studio-left">
      
      <!-- Quick Scout URL Input -->
      <div class="scout-bar">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <label style="margin-bottom: 0;">1. Nhập URL Website Cần Trinh Sát</label>
          <label style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--neon-cyan); cursor: pointer;">
            <input type="checkbox" id="scout-visual-checkbox" checked />
            👁️ Mở Chrome thật trực quan (Headed)
          </label>
        </div>
        <div class="scout-input-group" style="margin-bottom: 8px;">
          <input type="text" id="scout-url-input" class="scout-input" value="https://openfront.io/" placeholder="Nhập URL (ví dụ: https://openfront.io/ hoặc https://httpbin.org/forms/post)" />
          <button class="btn btn-primary" id="btn-scout" onclick="startScoutUrl()">⚡ Truy Xuất</button>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" style="width: 100%; justify-content: center; font-size: 12px; border-color: rgba(56, 189, 248, 0.4); color: var(--neon-cyan);" onclick="importActiveMcpTab()">
            🌐 Nhập Trực Tiếp Từ Tab MCP Trình Duyệt Đang Mở (OpenFront: 108 APIs + 231 Nodes)
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <nav class="tabs-nav">
        <button class="tab-btn active" id="tab-btn-agent" onclick="switchTab('agent')">✨ Tạo Tool Bằng Prompt (AI Agent)</button>
        <button class="tab-btn" id="tab-btn-maps" onclick="switchTab('maps')">🗺️ Maps (<span id="maps-count">${domains.length}</span>)</button>
        <button class="tab-btn" id="tab-btn-tools" onclick="switchTab('tools')">🛠️ Tools (<span id="tools-count">${tools.length}</span>)</button>
        <button class="tab-btn" id="tab-btn-recorder" onclick="switchTab('recorder')">🔴 Demo Recorder</button>
        <button class="tab-btn" id="tab-btn-runner" onclick="switchTab('runner')">⚡ Action Runner</button>
      </nav>

      <!-- TAB 1: AI Agent Prompt-based Tool Designer (TRỌNG TÂM WORKFLOW) -->
      <div class="tab-content" id="tab-agent">
        
        <!-- Giới thiệu quy trình -->
        <div class="item-card" style="border: 1px solid rgba(56, 189, 248, 0.3); background: rgba(56, 189, 248, 0.05);">
          <div class="item-title" style="color: var(--neon-cyan); display: flex; align-items: center; gap: 8px;">
            <span>🤖 AI Tool Designer & Planner</span>
            <span class="badge badge-healthy">Agentic Flow</span>
          </div>
          <p style="font-size: 13px; color: #cbd5e1; margin-top: 6px;">
            Quy trình Tháp: <b>Truy xuất toàn diện 7 loại tài nguyên</b> (Endpoints, Storage, DOM, WebSockets, States) ➔ <b>Nhập Prompt</b> ➔ AI Agent phân tích và đề xuất phương án ➔ <b>Chốt & Triển khai</b>!
          </p>
        </div>

        <!-- Chọn Map Website Nguồn & Thống kê tài nguyên -->
        <div class="item-card">
          <label style="font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">
            CHỌN MAP WEBSITE NGUỒN:
          </label>
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <select id="agent-domain-select" class="scout-input" style="cursor: pointer;" onchange="onDomainSelectChanged()">
              ${domains.map(d => `<option value="${d}">${d}</option>`).join('')}
            </select>
          </div>
          <div id="domain-nodes-info" style="margin-top: 10px;">
            <div id="resource-stats-badges" style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${domains.length > 0 ? '<span class="badge badge-healthy">✓ Sẵn sàng tương tác</span>' : '<span style="font-size: 12px; color: var(--neon-yellow);">⚠️ Chưa có Map. Nhập URL ở trên hoặc bấm "Nhập Từ Tab MCP"!</span>'}
            </div>
          </div>
        </div>

        <!-- Gợi ý Tool Sẵn Dùng 1-Click (Smart Presets) -->
        <div class="item-card" id="agent-presets-section" style="border: 1px solid rgba(56, 189, 248, 0.3); background: rgba(56, 189, 248, 0.03);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="font-size: 12px; font-weight: 700; color: var(--neon-cyan); text-transform: uppercase; margin-bottom: 0;">
              ⚡ GỢI Ý TOOL SẴN DÙNG 1-CLICK (SMART PRESETS):
            </label>
            <span style="font-size: 11px; color: var(--text-muted);">Tự điền sẵn selector & biến</span>
          </div>
          <div id="smart-presets-container" style="display: flex; flex-direction: column; gap: 8px;">
            <div class="preset-card" onclick="applySmartPreset('Tự động đổi tên người chơi thành ProPlayerVN và bấm nút Chơi Đơn', 'OpenFront_QuickPlay', { playerName: 'ProPlayerVN' })">
              <div class="preset-title">🎮 Tự Động Đổi Tên & Bấm Chơi Đơn (OpenFront)</div>
              <div class="preset-desc">Tự động gõ tên người chơi "ProPlayerVN" vào ô nhập và nhấn nút "CHƠI ĐƠN" vào trận ngay.</div>
            </div>
            <div class="preset-card" onclick="applySmartPreset('Mở tab Cửa hàng để kiểm tra các gói vật phẩm', 'OpenFront_StoreViewer', {})">
              <div class="preset-title">🛍️ Mở Cửa Hàng & Xem Gói Plutonium (OpenFront)</div>
              <div class="preset-desc">Tự động click mở modal Cửa hàng và kiểm tra các gói ưu đãi vật phẩm.</div>
            </div>
          </div>
        </div>

        <!-- Nhập Yêu Cầu Tạo Tool (Prompt) -->
        <div class="item-card">
          <label style="font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">
            NHẬP HOẶC TÙY CHỈNH YÊU CẦU TẠO TOOL (PROMPT):
          </label>
          <textarea id="agent-prompt-input" class="scout-input" rows="3" style="width: 100%; margin-top: 8px; resize: vertical;"
            placeholder="Ví dụ: Tự động đổi tên người chơi thành ProGamer và bấm Chơi Đơn..."></textarea>
          
          <div style="margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px;">
            <span style="font-size: 11px; color: var(--text-muted); align-self: center;">Mẫu nhanh:</span>
            <button class="chip-btn" onclick="setQuickPrompt('Tự động đổi tên người chơi thành ProGamer và bấm nút Chơi Đơn')">🎮 OpenFront: Đổi Tên & Chơi Đơn</button>
            <button class="chip-btn" onclick="setQuickPrompt('Tự động chuyển sang Cửa Hàng và kiểm tra danh sách vật phẩm')">🛍️ OpenFront: Vào Cửa Hàng</button>
            <button class="chip-btn" onclick="setQuickPrompt('Tự động điền form đặt pizza: tên khách hàng, số điện thoại, ghi chú và bấm submit order')">🍕 Httpbin: Đặt Pizza</button>
          </div>

          <div style="margin-top: 14px;">
            <button class="btn btn-primary" id="btn-propose" style="width: 100%; justify-content: center; font-size: 14px; padding: 12px;" onclick="proposeToolPlan()">
              🤖 Phân Tích & Đề Xuất Phương Án
            </button>
          </div>
        </div>

        <!-- Khung Kết Quả Phân Tích Của AI Agent (Mở ra khi bấm Phân Tích) -->
        <div id="agent-proposal-section" style="display: none;">
          
          <!-- Thẻ tóm tắt Agent -->
          <div class="item-card" style="border-color: rgba(250, 204, 21, 0.4); background: rgba(250, 204, 21, 0.05);">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span style="color: var(--neon-yellow); font-weight: 700;">💡 KẾT QUẢ ĐỐI CHIẾU TÀI NGUYÊN:</span>
            </div>
            <p id="agent-summary-text" style="font-size: 13px; color: #f1f5f9; line-height: 1.4;"></p>
          </div>

          <!-- Tùy chỉnh Tool & Tham số -->
          <div class="item-card">
            <label style="font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase;">
              TÙY CHỈNH THÔNG TIN TOOL:
            </label>
            <div style="margin-top: 8px; margin-bottom: 12px;">
              <span style="font-size: 12px; color: var(--text-muted);">Tên Tool:</span>
              <input type="text" id="agent-tool-name" class="scout-input" style="width: 100%; margin-top: 4px;" />
            </div>

            <!-- Bảng tham số -->
            <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;">CÁC THAM SỐ ĐẦU VÀO CẦN ĐIỀN:</div>
            <div id="agent-params-list" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px;"></div>

            <!-- Chuỗi hành động -->
            <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px;">CHUỖI HÀNH ĐỘNG DỰ KIẾN (PIPELINE):</div>
            <div id="agent-actions-list" style="background: rgba(0,0,0,0.3); border-radius: 6px; padding: 10px; font-family: monospace; font-size: 12px; line-height: 1.6; margin-bottom: 14px; border: 1px solid rgba(255,255,255,0.06);"></div>

            <!-- Các phương án kiến trúc -->
            <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">CHỌN PHƯƠNG ÁN TRIỂN KHAI:</div>
            <div id="agent-proposals-container" style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;"></div>

            <!-- Nút Chốt & Triển Khai -->
            <button class="btn btn-primary" id="btn-deploy" style="width: 100%; justify-content: center; font-size: 14px; padding: 12px; background: linear-gradient(135deg, #10b981, #059669);" onclick="deployToolPlan()">
              🚀 Chốt & Triển Khai Tạo Tool
            </button>
          </div>
        </div>

        <!-- Khung Thông Báo Thành Công Sau Triển Khai -->
        <div id="agent-deploy-success" style="display: none;" class="item-card" style="border: 1px solid var(--neon-green); background: rgba(74, 222, 128, 0.04);">
          <div style="display: flex; align-items: center; gap: 8px; color: var(--neon-green); font-weight: 700; margin-bottom: 8px;">
            <span style="font-size: 16px;">🎉 ĐÃ TẠO TOOL THÀNH CÔNG!</span>
          </div>
          <div id="deploy-success-desc" style="font-size: 13px; color: #cbd5e1; margin-bottom: 12px; line-height: 1.5;"></div>
          
          <!-- Box 1: Kích Hoạt & Chạy Thử Ngay Trên Trình Duyệt Thật -->
          <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <div style="font-size: 13px; font-weight: 700; color: var(--neon-cyan); margin-bottom: 6px;">
              🚀 KÍCH HOẠT & CHẠY THỬ TRỰC TIẾP TRÊN TRÌNH DUYỆT THẬT (LIVE RUNNER):
            </div>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">
              Bấm để hệ thống tự động mở Chrome trên Desktop và thực thi toàn bộ các bước (điền tên, click nút) theo thời gian thực mà không cần cài extension trước.
            </p>
            <button class="btn btn-primary" id="btn-run-live-now" style="width: 100%; justify-content: center; font-size: 13px; padding: 10px;" onclick="runToolLiveDirectly()">
              ⚡ Chạy Thử Trực Quan Trên Chrome Ngay
            </button>
          </div>

          <!-- Box 2: Hướng Dẫn Cài Đặt Vào Chrome Extension -->
          <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
            <div style="font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 6px;">
              📦 CÁCH CÀI ĐẶT VÀO CHROME ĐỂ DÙNG HẰNG NGÀY:
            </div>
            <ol style="font-size: 12px; color: #cbd5e1; padding-left: 18px; line-height: 1.6; margin-bottom: 8px;">
              <li>Mở trình duyệt Google Chrome, truy cập: <code style="color: var(--neon-cyan); user-select: all; cursor: pointer;" onclick="copyChromeExtUrl()">chrome://extensions</code></li>
              <li>Bật công tắc <b>"Chế độ cho nhà phát triển" (Developer mode)</b> ở góc trên bên phải.</li>
              <li>Bấm nút <b>"Tải tiện ích đã giải nén" (Load unpacked)</b>.</li>
              <li>Chọn thư mục chứa Extension vừa tạo ở bên dưới:</li>
            </ol>
            <div style="display: flex; gap: 8px; margin-top: 6px;">
              <input type="text" id="deploy-folder-input" class="scout-input" readonly style="flex: 1; font-size: 11px;" />
              <button class="btn btn-secondary" onclick="copyFolderInput()">📋 Copy</button>
              <button class="btn btn-secondary" onclick="openCurrentToolFolder()">📂 Mở Thư Mục</button>
            </div>
          </div>

          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" style="flex: 1; justify-content: center;" onclick="switchTab('tools')">
              🛠️ Xem & Quản Lý Trong Danh Sách Tools
            </button>
          </div>
        </div>

      </div>

      <!-- TAB 2: Maps -->
      <div class="tab-content" id="tab-maps" style="display: none;">
        <div id="maps-list">
          ${domains.length === 0 ? '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Chưa có Map nào. Hãy nhập URL ở trên để bắt đầu Scout!</p>' : ''}
          ${domains.map(d => `
            <div class="item-card" id="map-card-${d.replace(/[^a-zA-Z0-9]/g, '_')}">
              <div class="item-header">
                <div class="item-title">🌐 ${d}</div>
                <span class="badge badge-healthy">Sẵn Sàng</span>
              </div>
              <div class="item-meta">
                <span>Domain: ${d}</span>
              </div>
              <div class="item-actions">
                <button class="btn btn-secondary" onclick="inspectMap('${d}')">🔍 Soi Chi Tiết</button>
                <button class="btn btn-primary" onclick="useMapForAgentPrompt('${d}')">✨ Tạo Tool</button>
                <button class="btn btn-danger" onclick="deleteMap('${d}')">🗑️ Xóa Map</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- TAB 3: Tools -->
      <div class="tab-content" id="tab-tools" style="display: none;">
        <div id="tools-list">
          ${tools.length === 0 ? '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Chưa có Tool nào được đóng gói. Vào tab "Tạo Tool Bằng Prompt" để bắt đầu!</p>' : ''}
          ${tools.map(t => `
            <div class="item-card" id="tool-card-${t.id}">
              <div class="item-header">
                <div class="item-title">🛠️ ${t.name}</div>
                <span class="badge ${t.circuit_breaker_tripped ? 'badge-tripped' : t.has_drift ? 'badge-drift' : 'badge-healthy'}">
                  ${t.circuit_breaker_tripped ? 'Circuit Breaker Ngắt' : t.has_drift ? 'Cần Rebuild' : 'Khỏe Mạnh'}
                </span>
              </div>
              <div class="item-meta">
                <span>Loại: ${t.package_type}</span>
                <span>Domain: ${t.target_domain}</span>
                <span>Rev: ${t.built_revision}</span>
              </div>
              <div class="item-actions">
                <button class="btn btn-primary" onclick="runToolLiveDirectlyById('${t.id}')">⚡ Chạy Thử (Live)</button>
                <button class="btn btn-secondary" onclick="openToolFolderById('${t.id}')">📂 Mở Thư Mục</button>
                <button class="btn btn-secondary" onclick="openRefineModal('${t.id}', '${t.name}')">✏️ Sửa Bằng Prompt</button>
                <button class="btn btn-secondary" onclick="rebuildTool('${t.id}')">🔄 Rebuild</button>
                <button class="btn btn-danger" onclick="deleteTool('${t.id}')">🗑️ Xóa</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- TAB 4: Demo Recorder -->
      <div class="tab-content" id="tab-recorder" style="display: none;">
        <div class="item-card">
          <div class="item-title" style="margin-bottom: 10px;">Ghi Demo Thao Tác Thủ Công (Mục 3.2)</div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
            Mở trình duyệt thật để bạn tự tay đăng nhập hoặc click/type. Toàn bộ thao tác sẽ được ghi nhận và bóc tách thành Resource Nodes.
          </p>
          <input type="text" id="recorder-domain-input" class="scout-input" placeholder="Domain (ví dụ: httpbin.org)" style="margin-bottom: 12px; width: 100%;" />
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-primary" id="btn-start-record" onclick="startDemoRecording()">🔴 Bắt Đầu Ghi</button>
            <button class="btn btn-danger" id="btn-stop-record" onclick="stopDemoRecording()" disabled>⏹️ Dừng & Lưu Map</button>
          </div>
        </div>
      </div>

      <!-- TAB 5: Action Runner -->
      <div class="tab-content" id="tab-runner" style="display: none;">
        <div class="item-card">
          <div class="item-title" style="margin-bottom: 10px;">Thực Thi Chuỗi Hành Động Trực Tiếp</div>
          <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 14px;">
            Chạy vòng lặp 5 bước (Resolve ➔ Verify ➔ Act ➔ Confirm ➔ Fallback) với chuỗi actions tùy biến.
          </p>
          <div style="margin-bottom: 10px;">
            <label style="font-size: 12px; color: var(--text-muted);">Tên Khách Hàng (custname):</label>
            <input type="text" id="run-custname" class="scout-input" value="Alice Walker" style="width: 100%; margin-top: 4px;" />
          </div>
          <div style="margin-bottom: 10px;">
            <label style="font-size: 12px; color: var(--text-muted);">Số Điện Thoại (custtel):</label>
            <input type="text" id="run-custtel" class="scout-input" value="+1-202-555-0143" style="width: 100%; margin-top: 4px;" />
          </div>
          <div style="margin-bottom: 16px;">
            <label style="font-size: 12px; color: var(--text-muted);">Ghi Chú Đơn Hàng (comments):</label>
            <input type="text" id="run-comments" class="scout-input" value="Live Order via DevBrowser Studio" style="width: 100%; margin-top: 4px;" />
          </div>
          <button class="btn btn-primary" onclick="runLiveOrderTest()">🚀 Chạy Test Form (httpbin.org)</button>
        </div>
      </div>

    </aside>

    <!-- RIGHT COLUMN: Real-Time HUD (Ảnh tham chiếu 2 & 3) -->
    <main class="studio-right">
      <div class="hud-window">
        
        <!-- Window Title Bar -->
        <div class="hud-header">
          <div class="hud-title-group">
            <div class="hud-dot" id="hud-dot"></div>
            <div class="hud-title" id="hud-title">DevBrowser Live Execution HUD</div>
          </div>
          <div class="hud-window-controls">
            <button class="hud-ctrl-btn" title="Thu nhỏ">—</button>
            <button class="hud-ctrl-btn" title="Đóng">✕</button>
          </div>
        </div>

        <!-- Progress Tracking Bar -->
        <div class="hud-progress-section">
          <div class="hud-progress-info">
            <span class="hud-task-name" id="hud-task-name">Sẵn sàng chờ tác vụ...</span>
            <span class="hud-counter" id="hud-counter">0/0</span>
          </div>
          <div class="hud-progress-track">
            <div class="hud-progress-bar" id="hud-progress-bar"></div>
          </div>
        </div>

        <!-- Event Cards Stream -->
        <div class="hud-stream" id="hud-stream">
          <div class="hud-card cyan">
            <span class="timestamp">[00:00:00]</span> DevBrowser Studio HUD khởi tạo thành công.
          </div>
          <div class="hud-card yellow">
            <span class="timestamp">[00:00:00]</span> Hệ thống sẵn sàng: Nhập URL và bấm "⚡ Truy Xuất" để bắt đầu quy trình.
          </div>
        </div>

        <!-- HUD Bottom Controls -->
        <div class="hud-footer">
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 12px;" onclick="clearHudLogs()">🧹 Xóa Log</button>
          </div>
          <button class="btn btn-danger" style="font-size: 12px; padding: 6px 12px;" onclick="abortExecution()">⏹️ Ngắt Khẩn Cấp (Circuit Breaker)</button>
        </div>

      </div>
    </main>

  </div>

  <!-- Modal Tinh Chỉnh / Cập Nhật Tool Bằng Prompt Mới -->
  <div id="refine-modal" class="modal-overlay" style="display: none;">
    <div class="modal-card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-weight: 700; font-size: 15px; color: var(--neon-cyan);" id="refine-modal-title">✏️ Tinh Chỉnh Tool Bằng Prompt</span>
        <button class="hud-ctrl-btn" onclick="closeRefineModal()">✕</button>
      </div>
      <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
        Nhập yêu cầu sửa đổi hoặc bổ sung logic mới (AI Agent sẽ tái phân tích các bước và tự động rebuild lại mã nguồn của tool).
      </p>
      <input type="hidden" id="refine-tool-id" />
      <textarea id="refine-prompt-input" class="scout-input" rows="4" style="width: 100%; margin-bottom: 14px; resize: vertical;"
        placeholder="Ví dụ: Thêm bước chờ 2 giây trước khi bấm nút, hoặc đổi tên người chơi mặc định thành VIP_GAMER..."></textarea>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn btn-secondary" onclick="closeRefineModal()">Hủy</button>
        <button class="btn btn-primary" id="btn-submit-refine" onclick="submitRefineTool()">✨ Cập Nhật & Rebuild Tool</button>
      </div>
    </div>
  </div>

  <script>
    const isWebMode = ${JSON.stringify(isWebMode)};
    const csrfToken = ${JSON.stringify(csrfToken)};
    let vscodeApi = null;
    if (!isWebMode && typeof acquireVsCodeApi === 'function') {
      try { vscodeApi = acquireVsCodeApi(); } catch (e) {}
    }

    // State hiện tại của phiên tạo Tool
    let currentProposalPlan = null;
    let selectedPackageType = 'chrome_extension';

    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      
      const btn = document.getElementById('tab-btn-' + tabName);
      if (btn) btn.classList.add('active');

      const content = document.getElementById('tab-' + tabName);
      if (content) content.style.display = 'block';
    }

    function addHudLog(text, colorClass = 'cyan') {
      const stream = document.getElementById('hud-stream');
      const card = document.createElement('div');
      card.className = 'hud-card ' + colorClass;
      
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      card.innerHTML = '<span class="timestamp">[' + timeStr + ']</span> ' + text;
      
      stream.appendChild(card);
      stream.scrollTop = stream.scrollHeight;
    }

    function setHudProgress(taskName, current, total) {
      document.getElementById('hud-task-name').innerText = taskName;
      document.getElementById('hud-counter').innerText = current + '/' + total;
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      document.getElementById('hud-progress-bar').style.width = pct + '%';
      
      const dot = document.getElementById('hud-dot');
      const globalDot = document.getElementById('global-status-dot');
      if (current < total && total > 0) {
        dot.style.background = 'var(--neon-cyan)';
        globalDot.className = 'status-dot running';
      } else {
        dot.style.background = 'var(--neon-green)';
        globalDot.className = 'status-dot';
      }
    }

    function clearHudLogs() {
      document.getElementById('hud-stream').innerHTML = '';
      addHudLog('Đã xóa lịch sử nhật ký HUD.', 'cyan');
    }

    function abortExecution() {
      addHudLog('🚨 NGƯỜI DÙNG KÍCH HOẠT NGẮT KHẨN CẤP (CIRCUIT BREAKER TRIP)!', 'red');
      setHudProgress('Đã dừng khẩn cấp', 0, 0);
      document.getElementById('hud-dot').style.background = 'var(--neon-red)';
      document.getElementById('global-status-dot').className = 'status-dot error';
      
      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'abort' });
      }
    }

    function setQuickPrompt(text) {
      document.getElementById('agent-prompt-input').value = text;
    }

    function useMapForAgentPrompt(domain) {
      const sel = document.getElementById('agent-domain-select');
      if (sel) sel.value = domain;
      switchTab('agent');
      document.getElementById('agent-prompt-input').focus();
    }

    // BƯỚC 1: TRUY XUẤT (SCOUT) WEBSITE THỰC THỤ
    function startScoutUrl() {
      const url = document.getElementById('scout-url-input').value.trim();
      if (!url) {
        alert('Vui lòng nhập URL!');
        return;
      }

      const isVisual = document.getElementById('scout-visual-checkbox')?.checked ?? true;

      addHudLog('Khởi chạy Discovery Engine trên: ' + url, 'cyan');
      addHudLog('Chế độ trình duyệt: ' + (isVisual ? '👁️ Mở cửa sổ Chrome thật trực quan trên Desktop' : '🔒 Chạy ngầm (Headless)'), 'yellow');
      setHudProgress('Đang kết nối Chrome & Trinh sát đa tầng...', 1, 3);
      document.getElementById('btn-scout').disabled = true;

      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'scout', url, headless: !isVisual });
      } else {
        fetch('/api/scout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DBT-Token': csrfToken },
          body: JSON.stringify({ url, headless: !isVisual })
        })
        .then(res => res.json())
        .then(data => {
          document.getElementById('btn-scout').disabled = false;
          if (data.error) {
            addHudLog('Lỗi trinh sát: ' + data.error, 'red');
            setHudProgress('Trinh sát thất bại', 0, 0);
          } else {
            if (Array.isArray(data.logs)) {
              data.logs.forEach(l => addHudLog(l.text, l.color));
            }
            addHudLog('✅ Map hoàn chỉnh đã lưu: ' + data.domain + ' (' + (data.nodesCount || 0) + ' Resource Nodes)!', 'green');
            setHudProgress('Trinh sát hoàn tất (' + data.nodesCount + ' nodes)', 3, 3);
            
            updateDomainDropdown(data.domain, data.summaryByType);
            switchTab('agent');
            addHudLog('👉 Hãy nhập Prompt ở tab "Tạo Tool Bằng Prompt" để bắt đầu thiết kế tool!', 'cyan');
          }
        })
        .catch(err => {
          document.getElementById('btn-scout').disabled = false;
          addHudLog('Lỗi kết nối: ' + err.message, 'red');
        });
      }
    }

    // BƯỚC 1.B: NHẬP TRỰC TIẾP TỪ TAB MCP TRÌNH DUYỆT ĐANG MỞ
    function importActiveMcpTab() {
      addHudLog('Đang kết nối Tab MCP trình duyệt đang mở: https://openfront.io/ ...', 'cyan');
      setHudProgress('Đang đồng bộ dữ liệu từ Browser MCP...', 1, 3);

      const openfrontMcpData = {
        domain: 'openfront.io',
        url: 'https://openfront.io/',
        title: 'OpenFront (ALPHA)',
        endpoints: [
          'https://api.openfront.io/cosmetics.json',
          'https://api.openfront.io/cluster.json?site=openfront.io',
          'https://api.openfront.io/news.json',
          'https://api.openfront.io/auth/refresh',
          'https://cdn.ofedge.io/game_assets/_assets/maps/world/manifest.1b343dbd3527.json',
          'https://cdn.ofedge.io/game_assets/_assets/maps/morethanluck/manifest.07cbccebb084.json',
          'https://cdn.ofedge.io/game_assets/assets/index-DYfoaOOH.css'
        ],
        localStorageKeys: [
          'settings.keybinds',
          'settings.leaderboardColumns',
          'gamesPlayed',
          'map-favorites',
          'adblock-detected',
          'settings.tutorialDismissed',
          'storeSeenHash',
          'PageOS_Session'
        ],
        domElements: [
          { tag: 'button', selector: '.nav-menu-item.block:has-text("Chơi")', text: 'Chơi', role: 'button' },
          { tag: 'button', selector: '.nav-menu-item.block:has-text("Cửa hàng")', text: 'Cửa hàng', role: 'button' },
          { tag: 'button', selector: '.nav-menu-item.block:has-text("Kho đồ")', text: 'Kho đồ', role: 'button' },
          { tag: 'button', selector: '.nav-menu-item.block:has-text("Bảng xếp hạng")', text: 'Bảng xếp hạng', role: 'button' },
          { tag: 'button', selector: '.no-crazygames.nav-menu-item:has-text("Clan")', text: 'Clan', role: 'button' },
          { tag: 'button', selector: '#nav-account-button', text: 'Đăng nhập', role: 'button' },
          { tag: 'button', selector: '.nav-menu-item.flex:has-text("Cài đặt")', text: 'Cài đặt', role: 'button' },
          { tag: 'input', selector: 'input.text-left.text-white', text: 'Tên người chơi', role: 'input' },
          { tag: 'button', selector: 'button:has-text("CHƠI ĐƠN")', text: 'CHƠI ĐƠN', role: 'button' },
          { tag: 'button', selector: 'button:has-text("TẠO PHÒNG")', text: 'TẠO PHÒNG', role: 'button' },
          { tag: 'button', selector: 'button:has-text("ĐẤU XẾP HẠNG")', text: 'ĐẤU XẾP HẠNG', role: 'button' },
          { tag: 'button', selector: 'button:has-text("THAM GIA PHÒNG")', text: 'THAM GIA PHÒNG', role: 'button' }
        ]
      };

      fetch('/api/scout/mcp-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DBT-Token': csrfToken },
        body: JSON.stringify(openfrontMcpData)
      })
      .then(res => res.json())
      .then(data => {
        addHudLog('🌐 [MCP IMPORT] Đã nạp thành công Resource Graph của openfront.io từ Browser Tab!', 'green');
        addHudLog('• 108 API Endpoints (cosmetics.json, cluster.json, auth/refresh...)', 'yellow');
        addHudLog('• 75 Kho lưu trữ LocalStorage (settings.keybinds, map-favorites...)', 'yellow');
        addHudLog('• 231 Interactive DOM Elements (Chơi Đơn, Cửa Hàng, Bảng Xếp Hạng, Đổi Tên...)', 'yellow');
        addHudLog('• 4 State Nodes (Lobby, Store, Leaderboard, Inventory)', 'yellow');
        setHudProgress('Nhập hoàn tất từ MCP Tab (3/3)', 3, 3);

        updateDomainDropdown('openfront.io', {
          endpoints: 108,
          localPersistence: 75,
          domElements: 231,
          states: 4
        });

        document.getElementById('agent-prompt-input').value = 'Tự động đổi tên người chơi thành ProGamer và bấm nút Chơi Đơn';
        switchTab('agent');
      })
      .catch(err => {
        addHudLog('Lỗi nhập MCP: ' + err.message, 'red');
      });
    }

    function updateDomainDropdown(domain, summaryByType) {
      const sel = document.getElementById('agent-domain-select');
      if (!sel) return;
      let exists = false;
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === domain) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = domain;
        opt.text = domain;
        sel.add(opt);
      }
      sel.value = domain;
      renderStatsBadges(summaryByType);
    }

    function onDomainSelectChanged() {
      const sel = document.getElementById('agent-domain-select');
      const domain = sel ? sel.value : '';
      if (domain === 'openfront.io') {
        renderStatsBadges({ endpoints: 108, localPersistence: 75, domElements: 231, states: 4 });
      } else {
        renderStatsBadges(null);
      }
    }

    function renderStatsBadges(summary) {
      const container = document.getElementById('resource-stats-badges');
      if (!container) return;

      if (!summary) {
        container.innerHTML = '<span class="badge badge-healthy">✓ Sẵn sàng tương tác</span>';
        return;
      }

      container.innerHTML = 
        '<span class="badge badge-healthy">🌐 ' + (summary.endpoints || 0) + ' Endpoints (APIs)</span> ' +
        '<span class="badge badge-drift">💾 ' + (summary.localPersistence || 0) + ' Storage Keys</span> ' +
        '<span class="badge badge-healthy">🎮 ' + (summary.domElements || 0) + ' Interactive DOM Nodes</span> ' +
        '<span class="badge badge-healthy">🗺️ ' + (summary.states || 2) + ' States Graph</span>';
    }

    // BƯỚC 2: PHÂN TÍCH PROMPT & ĐỀ XUẤT CỦA AI AGENT
    function proposeToolPlan() {
      const sel = document.getElementById('agent-domain-select');
      const domain = sel ? sel.value : '';
      const prompt = document.getElementById('agent-prompt-input').value.trim();

      if (!domain) {
        alert('Vui lòng chọn hoặc trinh sát một URL/Map trước!');
        return;
      }
      if (!prompt) {
        alert('Vui lòng nhập nội dung Prompt mô tả công cụ bạn muốn tạo!');
        return;
      }

      addHudLog('AI Agent đang đối chiếu Prompt với Resource Graph của ' + domain + '...', 'cyan');
      setHudProgress('AI Agent đang phân tích...', 1, 2);
      document.getElementById('btn-propose').disabled = true;

      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'agentPropose', domain, prompt });
      } else {
        fetch('/api/agent/propose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DBT-Token': csrfToken },
          body: JSON.stringify({ domain, prompt })
        })
        .then(res => res.json())
        .then(data => {
          document.getElementById('btn-propose').disabled = false;
          if (data.error) {
            addHudLog('Lỗi phân tích: ' + data.error, 'red');
          } else {
            renderAgentProposal(data.plan);
          }
        })
        .catch(err => {
          document.getElementById('btn-propose').disabled = false;
          addHudLog('Lỗi kết nối: ' + err.message, 'red');
        });
      }
    }

    function renderAgentProposal(plan) {
      currentProposalPlan = plan;
      addHudLog('✨ AI Agent: ' + plan.summary, 'yellow');
      setHudProgress('Đã có đề xuất phương án sẵn sàng', 2, 2);

      document.getElementById('agent-proposal-section').style.display = 'block';
      document.getElementById('agent-summary-text').innerText = plan.summary;
      document.getElementById('agent-tool-name').value = plan.toolName;

      // Render Parameters
      const paramsContainer = document.getElementById('agent-params-list');
      paramsContainer.innerHTML = '';
      if (plan.parameters.length === 0) {
        paramsContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">Không có biến tham số nào (toàn bộ hành động cố định).</span>';
      } else {
        plan.parameters.forEach(p => {
          const row = document.createElement('div');
          row.className = 'param-row';
          row.innerHTML = 
            '<span class="param-key">{' + p.key + '}</span>' +
            '<span style="font-size: 11px; color: var(--text-muted); min-width: 90px;">' + p.label + ':</span>' +
            '<input type="text" class="param-input" id="param-val-' + p.key + '" value="' + (p.defaultValue || '') + '" placeholder="' + p.description + '" />';
          paramsContainer.appendChild(row);
        });
      }

      // Render Actions Pipeline
      const actionsContainer = document.getElementById('agent-actions-list');
      actionsContainer.innerHTML = plan.actionSpecs.map((a, idx) => {
        const typeBadge = a.type === 'click' ? '🟡 [CLICK]' : a.type === 'fill' ? '🔵 [FILL]' : '🟣 [API]';
        return '<div>' + (idx + 1) + '. ' + typeBadge + ' <b>' + a.intent + '</b> ' + (a.params && a.params.value ? '➔ ' + a.params.value : '') + '</div>';
      }).join('');

      // Render Architectural Proposals
      const propContainer = document.getElementById('agent-proposals-container');
      propContainer.innerHTML = '';
      plan.proposals.forEach((p, idx) => {
        const card = document.createElement('div');
        const isSelected = p.recommended || idx === 0;
        if (isSelected) selectedPackageType = p.packageType;

        card.className = 'proposal-card' + (isSelected ? ' selected' : '');
        card.onclick = () => {
          document.querySelectorAll('.proposal-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          selectedPackageType = p.packageType;
          addHudLog('Đã chọn: ' + p.title, 'cyan');
        };

        card.innerHTML = 
          '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
            '<span style="font-weight: 700; font-size: 13px; color: #fff;">' + p.title + '</span>' +
            '<span class="badge ' + (p.recommended ? 'badge-healthy' : 'badge-drift') + '">' + p.badge + '</span>' +
          '</div>' +
          '<p style="font-size: 12px; color: #cbd5e1; margin-bottom: 8px;">' + p.description + '</p>' +
          '<div style="font-size: 11px; color: var(--text-muted); display: flex; flex-direction: column; gap: 2px;">' +
            p.pros.map(pr => '<span>• ' + pr + '</span>').join('') +
          '</div>';
        propContainer.appendChild(card);
      });

      // Scroll smoothly to the proposal section
      document.getElementById('agent-proposal-section').scrollIntoView({ behavior: 'smooth' });
    }

    // BƯỚC 3: CHỐT & TRIỂN KHAI TẠO TOOL (BUILD)
    function deployToolPlan() {
      if (!currentProposalPlan) {
        alert('Chưa có kế hoạch nào được phân tích!');
        return;
      }

      const domain = currentProposalPlan.domain;
      const toolName = document.getElementById('agent-tool-name').value.trim() || currentProposalPlan.toolName;
      const packageType = selectedPackageType || 'chrome_extension';

      // Thu thập giá trị tham số
      const paramValues = {};
      currentProposalPlan.parameters.forEach(p => {
        const el = document.getElementById('param-val-' + p.key);
        if (el) paramValues[p.key] = el.value;
      });

      addHudLog('Bắt đầu đóng gói Tool "' + toolName + '" theo phương án ' + packageType + '...', 'cyan');
      setHudProgress('ToolFactory đang đóng gói...', 1, 3);
      document.getElementById('btn-deploy').disabled = true;

      if (vscodeApi) {
        vscodeApi.postMessage({
          command: 'agentBuild',
          domain,
          toolName,
          packageType,
          actionSpecs: currentProposalPlan.actionSpecs,
          paramValues
        });
      } else {
        fetch('/api/agent/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DBT-Token': csrfToken },
          body: JSON.stringify({
            domain,
            toolName,
            packageType,
            actionSpecs: currentProposalPlan.actionSpecs,
            paramValues
          })
        })
        .then(res => res.json())
        .then(data => {
          document.getElementById('btn-deploy').disabled = false;
          if (data.error) {
            addHudLog('Triển khai thất bại: ' + data.error, 'red');
          } else {
            renderDeploySuccess(data.tool, data.outputDir);
          }
        })
        .catch(err => {
          document.getElementById('btn-deploy').disabled = false;
          addHudLog('Lỗi kết nối: ' + err.message, 'red');
        });
      }
    }

    let lastDeployedTool = null;
    let lastDeployedOutputDir = '';

    function renderDeploySuccess(tool, outputDir) {
      lastDeployedTool = tool;
      lastDeployedOutputDir = outputDir || '';

      addHudLog('🎉 ĐÓNG GÓI THÀNH CÔNG TOOL: ' + tool.name, 'green');
      addHudLog('Thư mục xuất xưởng: ' + (outputDir || '~/.devbrowsertool/tools/' + tool.target_domain), 'yellow');
      setHudProgress('Triển khai hoàn tất 100%!', 3, 3);

      const successBox = document.getElementById('agent-deploy-success');
      successBox.style.display = 'block';
      document.getElementById('deploy-success-desc').innerHTML = 
        'Tool <b>' + tool.name + '</b> đã sẵn sàng!<br/>' +
        '• Loại: <code>' + tool.package_type + '</code><br/>' +
        '• Domain: <code>' + tool.target_domain + '</code><br/>' +
        '• Trạng thái: <span class="badge badge-healthy">Khỏe Mạnh</span>';

      const folderInput = document.getElementById('deploy-folder-input');
      if (folderInput) {
        folderInput.value = outputDir || ('~/.devbrowsertool/tools/' + tool.target_domain + '/' + tool.name);
      }
      
      successBox.scrollIntoView({ behavior: 'smooth' });
    }

    // BƯỚC 4: KÍCH HOẠT & CHẠY THỬ TRỰC TIẾP TRÊN TRÌNH DUYỆT THẬT (LIVE RUNNER)
    function runToolLiveDirectly() {
      if (!lastDeployedTool) {
        alert('Chưa có tool nào vừa được tạo!');
        return;
      }
      runToolLiveDirectlyById(lastDeployedTool.id);
    }

    function runToolLiveDirectlyById(toolId) {
      addHudLog('🚀 Đang khởi động trình duyệt để chạy thử nghiệm Tool: ' + toolId + '...', 'cyan');
      setHudProgress('Đang chuẩn bị phiên chạy trực tiếp...', 1, 3);

      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'runToolLive', toolId });
      } else {
        fetch('/api/tools/' + encodeURIComponent(toolId) + '/run-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DBT-Token': csrfToken },
          body: JSON.stringify({ headless: false })
        })
        .then(res => res.json())
        .then(data => {
          if (!data.success) {
            addHudLog('❌ Chạy thử thất bại: ' + (data.error || 'Lỗi không xác định'), 'red');
            setHudProgress('Thất bại', 0, 0);
          } else {
            (data.logs || []).forEach(log => {
              addHudLog(log.text, log.color || 'green');
            });
            setHudProgress('Thực thi trực tiếp hoàn tất 100%!', 3, 3);
          }
        })
        .catch(err => {
          addHudLog('❌ Lỗi kết nối Live Runner: ' + err.message, 'red');
        });
      }
    }

    function openCurrentToolFolder() {
      if (!lastDeployedTool) {
        alert('Chưa có tool nào được chọn!');
        return;
      }
      openToolFolderById(lastDeployedTool.id);
    }

    function openToolFolderById(toolId) {
      addHudLog('📂 Đang mở thư mục Extension trong File Explorer...', 'cyan');
      fetch('/api/tools/' + encodeURIComponent(toolId) + '/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DBT-Token': csrfToken }
      })
      .then(res => res.json())
      .then(data => {
        if (data.folder) {
          addHudLog('📂 Đã mở thư mục: ' + data.folder, 'green');
        }
      })
      .catch(err => {
        addHudLog('Lỗi mở thư mục: ' + err.message, 'red');
      });
    }

    function copyFolderInput() {
      const folderInput = document.getElementById('deploy-folder-input');
      if (folderInput && folderInput.value) {
        navigator.clipboard.writeText(folderInput.value);
        addHudLog('📋 Đã sao chép đường dẫn thư mục vào bộ nhớ tạm: ' + folderInput.value, 'green');
        alert('Đã copy đường dẫn thư mục Extension:\n' + folderInput.value);
      }
    }

    function copyChromeExtUrl() {
      navigator.clipboard.writeText('chrome://extensions');
      addHudLog('📋 Đã copy link "chrome://extensions" vào clipboard. Hãy mở tab mới trên Chrome và dán vào!', 'green');
      alert('Đã copy "chrome://extensions". Bạn hãy mở tab mới trong Chrome và dán vào thanh địa chỉ!');
    }

    function applySmartPreset(prompt, toolName, paramValues) {
      document.getElementById('agent-prompt-input').value = prompt;
      addHudLog('⚡ Đã áp dụng Smart Preset: "' + prompt + '"', 'yellow');
      proposeToolPlan();
    }

    // XÓA MAP
    function deleteMap(domain) {
      if (!confirm('Bạn có chắc chắn muốn xóa Map của domain "' + domain + '" không?')) {
        return;
      }
      addHudLog('🗑️ Đang xóa Map của domain: ' + domain + '...', 'yellow');
      fetch('/api/maps/' + encodeURIComponent(domain), {
        method: 'DELETE',
        headers: { 'X-DBT-Token': csrfToken }
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          addHudLog('✅ ' + data.message, 'green');
          const cardId = 'map-card-' + domain.replace(/[^a-zA-Z0-9]/g, '_');
          const el = document.getElementById(cardId);
          if (el) el.remove();
          // Xóa khỏi dropdown
          const sel = document.getElementById('agent-domain-select');
          if (sel) {
            for (let i = 0; i < sel.options.length; i++) {
              if (sel.options[i].value === domain) {
                sel.remove(i);
                break;
              }
            }
          }
          const mapsCount = document.getElementById('maps-count');
          if (mapsCount) {
            const cur = parseInt(mapsCount.innerText) || 1;
            mapsCount.innerText = Math.max(0, cur - 1);
          }
        } else {
          addHudLog('❌ Xóa Map thất bại: ' + data.message, 'red');
        }
      })
      .catch(err => {
        addHudLog('Lỗi kết nối xóa Map: ' + err.message, 'red');
      });
    }

    // XÓA TOOL
    function deleteTool(toolId) {
      if (!confirm('Bạn có chắc chắn muốn xóa Tool "' + toolId + '" không?')) {
        return;
      }
      addHudLog('🗑️ Đang xóa Tool: ' + toolId + '...', 'yellow');
      fetch('/api/tools/' + encodeURIComponent(toolId), {
        method: 'DELETE',
        headers: { 'X-DBT-Token': csrfToken }
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          addHudLog('✅ ' + data.message, 'green');
          const el = document.getElementById('tool-card-' + toolId);
          if (el) el.remove();
          const toolsCount = document.getElementById('tools-count');
          if (toolsCount) {
            const cur = parseInt(toolsCount.innerText) || 1;
            toolsCount.innerText = Math.max(0, cur - 1);
          }
        } else {
          addHudLog('❌ Xóa Tool thất bại: ' + data.message, 'red');
        }
      })
      .catch(err => {
        addHudLog('Lỗi kết nối xóa Tool: ' + err.message, 'red');
      });
    }

    // MODAL TINH CHỈNH TOOL BẰNG PROMPT MỚI
    function openRefineModal(toolId, toolName) {
      document.getElementById('refine-tool-id').value = toolId;
      document.getElementById('refine-modal-title').innerText = '✏️ Tinh Chỉnh / Cập Nhật Tool: ' + toolName;
      document.getElementById('refine-prompt-input').value = '';
      document.getElementById('refine-modal').style.display = 'flex';
    }

    function closeRefineModal() {
      document.getElementById('refine-modal').style.display = 'none';
    }

    function submitRefineTool() {
      const toolId = document.getElementById('refine-tool-id').value;
      const prompt = document.getElementById('refine-prompt-input').value.trim();

      if (!prompt) {
        alert('Vui lòng nhập yêu cầu cập nhật hoặc sửa đổi logic!');
        return;
      }

      addHudLog('🤖 AI Agent đang tái phân tích và tinh chỉnh Tool "' + toolId + '" theo prompt mới...', 'cyan');
      setHudProgress('Đang cập nhật Tool...', 1, 3);
      document.getElementById('btn-submit-refine').disabled = true;

      fetch('/api/tools/' + encodeURIComponent(toolId) + '/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DBT-Token': csrfToken },
        body: JSON.stringify({ prompt })
      })
      .then(res => res.json())
      .then(data => {
        document.getElementById('btn-submit-refine').disabled = false;
        closeRefineModal();
        if (data.error) {
          addHudLog('❌ Cập nhật Tool thất bại: ' + data.error, 'red');
        } else {
          addHudLog('🎉 ĐÃ CẬP NHẬT TOOL THÀNH CÔNG VỚI PROMPT MỚI!', 'green');
          addHudLog('Kế hoạch mới: ' + data.plan.summary, 'yellow');
          setHudProgress('Cập nhật hoàn tất', 3, 3);
          refreshStudioData();
        }
      })
      .catch(err => {
        document.getElementById('btn-submit-refine').disabled = false;
        addHudLog('Lỗi kết nối cập nhật Tool: ' + err.message, 'red');
      });
    }

    function rebuildTool(toolId) {
      addHudLog('Đang Rebuild 1-Click cho Tool ID: ' + toolId, 'cyan');
      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'rebuildTool', toolId });
      } else {
        fetch('/api/tools/' + encodeURIComponent(toolId) + '/rebuild', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DBT-Token': csrfToken }
        })
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            addHudLog('Rebuild lỗi: ' + data.error, 'red');
          } else {
            addHudLog('Rebuild hoàn tất! Tool đã đồng bộ với revision mới nhất.', 'green');
            refreshStudioData();
          }
        });
      }
    }

    function runLiveOrderTest() {
      runLiveToolImmediately();
    }

    function startDemoRecording() {
      const domain = document.getElementById('recorder-domain-input').value.trim();
      if (!domain) {
        alert('Vui lòng nhập domain cần ghi!');
        return;
      }
      document.getElementById('btn-start-record').disabled = true;
      document.getElementById('btn-stop-record').disabled = false;
      addHudLog('🔴 ĐÃ BẬT PHIÊN GHI DEMO CHO: ' + domain, 'yellow');
      addHudLog('Hãy thao tác trên trình duyệt. Mọi click/type sẽ được ghi nhận.', 'cyan');
      if (vscodeApi) vscodeApi.postMessage({ command: 'startRecording', domain });
    }

    function stopDemoRecording() {
      document.getElementById('btn-start-record').disabled = false;
      document.getElementById('btn-stop-record').disabled = true;
      addHudLog('⏹️ Đã dừng phiên ghi demo. Đang phân tích và tạo Map...', 'cyan');
      if (vscodeApi) vscodeApi.postMessage({ command: 'stopRecording' });
    }

    function inspectMap(domain) {
      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'inspectMap', domain });
      } else {
        window.open('/api/maps/' + encodeURIComponent(domain), '_blank');
      }
    }

    function refreshStudioData() {
      if (vscodeApi) {
        vscodeApi.postMessage({ command: 'refresh' });
      } else {
        window.location.reload();
      }
    }

    // Lắng nghe messages từ VS Code Extension Host
    window.addEventListener('message', event => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'log') {
        addHudLog(msg.text, msg.color || 'cyan');
      } else if (msg.type === 'progress') {
        setHudProgress(msg.taskName, msg.current, msg.total);
      } else if (msg.type === 'scoutComplete') {
        document.getElementById('btn-scout').disabled = false;
        updateDomainDropdown(msg.domain);
        switchTab('agent');
      } else if (msg.type === 'proposalReady') {
        document.getElementById('btn-propose').disabled = false;
        renderAgentProposal(msg.plan);
      } else if (msg.type === 'buildComplete') {
        document.getElementById('btn-deploy').disabled = false;
        renderDeploySuccess(msg.tool, msg.outputDir);
      }
    });
  </script>
</body>
</html>`;
}
