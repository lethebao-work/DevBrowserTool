# DevBrowserTool — Hệ Thống Tự Động Hoá & Sản Xuất Tool Trình Duyệt

> **Kiến trúc 3 Tầng: Tháp (Trinh Sát & Lập Map) ➔ Nhà Máy (Biên Dịch & Tối Ưu) ➔ Tool (Chrome Extension MV3 / Userscript / Advisor HUD Độc Lập)**  
> **Mô hình Vận hành: Agent-Driven MCP Architecture (Tối ưu cho Antigravity IDE, Cursor & Claude Code)**

[![TypeScript](https://img.shields.io/badge/Language-TypeScript%205.6-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-200%2F200%20Pass-brightgreen.svg)]()
[![Manifest](https://img.shields.io/badge/Chrome-Extension%20MV3-orange.svg)]()
[![MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-purple.svg)]()

---

## 📖 Mục Lục

1. [Giới thiệu Kiến trúc & Triết lý Cốt lõi](#-giới-thiệu-kiến-trúc--triết-lý-cốt-lõi)
2. [Cài đặt & Khởi động nhanh](#-cài-đặt--khởi-động-nhanh)
3. [4 Cách Thao Tác & Sử Dụng](#-4-cách-thao-tác--sử-dụng)
   - [Cách 1: Giao diện Dòng lệnh (CLI)](#cách-1-giao-diện-dòng-lệnh-cli)
   - [Cách 2: Giao diện Web App Dashboard Server](#cách-2-giao-diện-web-app-dashboard-server)
   - [Cách 3: VS Code / Antigravity IDE Extension (.vsix)](#cách-3-vs-code--antigravity-ide-extension-vsix)
   - [Cách 4: Agent-Driven MCP Server (Mô hình Khuyên dùng)](#cách-4-agent-driven-mcp-server-mô-hình-khuyên-dùng)
4. [Bảng Tra Cứu 10 Công Cụ MCP cho Agent](#-bảng-tra-cứu-10-công-cụ-mcp-cho-agent)
5. [Hướng Dẫn Load & Chạy Tool trong Google Chrome](#-hướng-dẫn-load--chạy-tool-trong-google-chrome)
6. [Cơ Chế Bảo Mật & Kỹ Thuật Đột Phá](#-cơ-chế-bảo-mật--kỹ-thuật-đột-phá)
7. [Kiểm Chứng Thực Tế Trên Web Thật (Live E2E Verification)](#-kiểm-chứng-thực-tế-trên-web-thật)
8. [Cấu Trúc Monorepo](#-cấu-trúc-monorepo)
9. [Tài Liệu Đặc Tả Kỹ Thuật Đầy Đủ](#-tài-liệu-đặc-tả-kỹ-thuật-đầy-đủ)

---

## 🏛️ Giới thiệu Kiến trúc & Triết lý Cốt lõi

Các AI Agent thông thường có thể tự mở trình duyệt để tương tác với trang web, nhưng **mỗi phiên làm việc đều phải dò tìm lại từ đầu** và **không tạo ra được sản phẩm độc lập** cho người dùng cuối. 

**DevBrowserTool** ra đời để giải quyết triệt để vấn đề này bằng cách phân tách rạch ròi 3 vai trò:

```
┌─────────────────────────────────────────────────────────────┐
│                    THÁP (Discovery & Scout)                 │
│  - Trinh sát DOM, WebSocket, SSE, API ngầm, Storage         │
│  - Phân tích tĩnh (StaticAnalyzer), bóc tách Source Maps    │
│  - Demo Recorder: Ghi lại thao tác của con người            │
│  - Cơ chế tự chữa lành (Fuzzy Healing) & Adaptive Learning  │
└──────────────────────────────┬──────────────────────────────┘
                               │  Map JSON (Resource Graph + State Graph)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  NHÀ MÁY (Tool Factory)                     │
│  1. StateGraphPlanner: Lập kế hoạch hành trình              │
│  2. ActionCompiler: Giữ nguyên TOÀN BỘ variants của node    │
│  3. Parameterizer: Tách biến động ({{username}}, {{code}})  │
│  4. DryRunRunner: Chạy thử kiểm chứng trước khi xuất bản    │
│  5. ExtensionPackager: Đóng gói ra sản phẩm đích            │
└──────────────────────────────┬──────────────────────────────┘
                               │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
┌──────────────────────┐ ┌──────────┐ ┌──────────────────────┐
│ Chrome Extension MV3 │ │Userscript│ │ Advisor Overlay HUD  │
│ (Chạy ngầm tự động)  │ │(Tamper-  │ │ (Spotlight hướng dẫn │
│                      │ │ monkey)  │ │  người dùng từng bước)│
└──────────────────────┘ └──────────┘ └──────────────────────┘
```

- **Tháp (Discovery Engine)**: Thu thập, phân tích và lưu trữ bản đồ tri thức cấu trúc (Map) gồm 7 loại tài nguyên chuẩn và đồ thị chuyển trạng thái (State Graph).
- **Nhà máy (Tool Factory)**: Biên dịch mục tiêu của người dùng + Map thành kịch bản thực thi an toàn (5-tier fallback locators, Bézier mouse, Gaussian jitter) và đóng gói thành công cụ độc lập.
- **Tool (Sản phẩm đầu ra)**: Thực thi siêu nhanh (tính bằng miligiây) ngay trong trình duyệt người dùng, tự phục hồi lỗi tĩnh và ngắt mạch an toàn (Circuit Breaker), **hoàn toàn không cần LLM hay Agent chạy nền**.

---

## ⚡ Cài đặt & Khởi động nhanh

### Yêu cầu môi trường
- **Node.js**: `>= 18.0.0`
- **npm**: `>= 9.0.0`
- **Trình duyệt**: Google Chrome (phiên bản ổn định)

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Biên dịch toàn bộ Monorepo
```bash
npm run build
```
Lệnh này sẽ biên dịch đồng thời cả 4 gói trong workspace:
- `@devbrowsertool/core`: Lõi phân tích, MapStore, Compiler và Packager.
- `devbrowsertool-ui`: Máy chủ WebAppServer và Extension cho IDE.
- `@devbrowsertool/mcp-bridge`: MCP Server theo chuẩn `@modelcontextprotocol/sdk`.
- `@devbrowsertool/cli`: Công cụ dòng lệnh tương tác trực tiếp.

### 3. Kiểm tra toàn bộ Test Suite
```bash
npm test
```
*Kết quả kiểm thử: 20 test suites, 200/200 unit tests pass 100%.*

---

## 🖥️ 4 Cách Thao Tác & Sử Dụng

### Cách 1: Giao diện Dòng lệnh (CLI)
Gói `@devbrowsertool/cli` cung cấp giao diện terminal trực quan:

```bash
# Xem trợ giúp các lệnh
npx devbrowsertool help

# Liệt kê tất cả Map domain và Tool đã sản xuất
npx devbrowsertool list

# Xem chi tiết cấu trúc Resource Graph & State Graph của 1 domain
npx devbrowsertool inspect httpbin.org

# Đóng gói Tool từ Map đã có
npx devbrowsertool build httpbin.org --type chrome_extension
npx devbrowsertool build httpbin.org --type advisor_overlay
npx devbrowsertool build httpbin.org --type userscript

# Khởi động Web App Dashboard Server
npx devbrowsertool ui --port 3456
```

---

### Cách 2: Giao diện Web App Dashboard Server
Dashboard đồ họa cho phép quản lý trực quan trạng thái Map, theo dõi độ lệch phiên bản (drift revision) và **1-Click Rebuild**:

1. Khởi động server từ terminal:
   ```bash
   npx devbrowsertool ui
   ```
2. Terminal sẽ hiển thị đường link kèm Token bảo mật:
   ```text
   ======================================================
   🚀 Web App UI sẵn sàng tại: http://127.0.0.1:3456?token=7b9a2e6f...
   🔒 Host: 127.0.0.1 (Bảo vệ chống LAN access)
   🔑 CSRF Token: 7b9a2e6f4a1c...
   ======================================================
   ```
3. Mở URL trong trình duyệt:
   - **Tab Map Viewer**: Trực quan hóa đồ thị Resource Nodes, điểm tin cậy (confidence), và State Graph.
   - **Tab Tool Dashboard**: Danh sách Tool, trạng thái sức khỏe (`healthy`, `drift_detected`, `tripped`), và nút **Rebuild Tool** tự động.

---

### Cách 3: VS Code / Antigravity IDE Extension (.vsix)
Tích hợp trực tiếp Studio điều khiển vào IDE của bạn:

1. **Cài đặt vào IDE**:
   - Với Antigravity IDE:
     ```powershell
     & "C:\Users\lethe\AppData\Local\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --install-extension "packages\ui\devbrowsertool-ui-0.1.0.vsix" --force
     ```
   - Với VS Code tiêu chuẩn:
     ```bash
     code --install-extension packages/ui/devbrowsertool-ui-0.1.0.vsix
     ```

2. **Các lệnh tiện ích trong Command Palette (`Ctrl+Shift+P`)**:
   - `DevBrowserTool: Open DevBrowser Studio & Live HUD`: Mở cửa sổ Studio 2 cột (Cột trái: Trinh sát URL, Quản lý Maps/Tools, Ghi demo | Cột phải: Live Execution HUD với thanh tiến độ thời gian thực).
   - `DevBrowserTool: Start Demo Recording`: Bắt đầu ghi thao tác tay trên trình duyệt (đèn đỏ `🔴 Recording: <domain>` bật trên Status Bar).
   - `DevBrowserTool: Stop Demo Recording`: Dừng phiên ghi và tự động lưu Map.
   - `DevBrowserTool: Build Chrome Extension from Map`: Đóng gói nhanh Chrome Extension MV3.

---

### Cách 4: Agent-Driven MCP Server (Mô hình Khuyên dùng)
Đây là mô hình vận hành chuẩn mực (Kiến trúc B), kết hợp giữa năng lực điều khiển trình duyệt của Agent (`browser-mcp` hoặc `chrome-devtools`) và trí tuệ cấu trúc của DevBrowserTool:

1. **Cấu hình MCP Server (`.agents/mcp_config.json`)**:
   ```json
   {
     "mcpServers": {
       "devbrowsertool": {
         "command": "node",
         "args": ["packages/mcp-bridge/dist/index.js"]
       }
     }
   }
   ```

2. **Chu trình 5 bước Agent-Driven**:
   - **Bước 1 (Lấy Script)**: Agent gọi `get_scout_scripts` nhận các recipe JS trinh sát (DOM, Performance, Storage, WebSocket).
   - **Bước 2 (Thực thi trên trang)**: Agent dùng `browser_execute_script` (của `browser-mcp`) chạy trên tab đang duyệt.
   - **Bước 3 (Nạp dữ liệu)**: Agent gọi `ingest_scout_data` gửi kết quả về cho DevBrowserTool bóc tách 7 loại tài nguyên và lưu MapStore.
   - **Bước 4 (Lập kế hoạch)**: Agent gọi `propose_actions` nhận đề xuất hành động, sử dụng LLM tinh chỉnh logic.
   - **Bước 5 (Biên dịch & Đóng gói)**: Agent gọi `compile_actions` để lấy script thực thi 5-tier & Bézier mouse, rồi gọi `build_tool` để xuất xưởng Chrome Extension MV3 hoặc Userscript hoàn chỉnh.

---

## 🛠️ Bảng Tra Cứu 10 Công Cụ MCP Cho Agent

| Tên MCP Tool | Nhiệm Vụ & Ý Nghĩa Kỹ Thuật |
|---|---|
| `get_scout_scripts` | Trả về các recipe JavaScript thuần an toàn để Agent inject vào trang web thu thập cấu trúc. |
| `ingest_scout_data` | Tiếp nhận raw data từ Agent, tự động phân loại thành 7 loại tài nguyên chuẩn và lưu vào MapStore. |
| `query_map` | Tra cứu tri thức cấu trúc, endpoints, DOM elements hoặc State Graph đã tích lũy của domain. |
| `propose_actions` | Phân tích ý định người dùng (intent) và đề xuất danh sách hành động tương tác phù hợp. |
| `compile_actions` | Biên dịch danh sách hành động thành script JavaScript độc lập có sẵn 5-tier locators và Bézier mouse. |
| `get_execution_scripts` | Lấy kịch bản thực thi từng bước phục vụ quá trình chạy thử (Dry-Run). |
| `ingest_execution_result` | Ghi nhận phản hồi Dry-run để cập nhật confidence và xác nhận độ ổn định của kịch bản. |
| `build_tool` | Đóng gói sản phẩm hoàn chỉnh (Chrome Extension MV3, Userscript, Advisor HUD) ra đĩa cứng. |
| `list_tools` | Liệt kê toàn bộ công cụ đã sản xuất, kiểm tra trạng thái trôi dạt phiên bản (`drift_detected`). |
| `locate_element` | Tìm nhanh selector tối ưu nhất cho một phần tử dựa trên tri thức có sẵn trong Map. |

---

## 🧩 Hướng Dẫn Load & Chạy Tool trong Google Chrome

Sau khi Tool được tạo (lưu tại thư mục `~/.devbrowsertool/tools/<tên_tool>`), bạn nạp vào Chrome thật để sử dụng như sau:

1. Mở trình duyệt **Google Chrome**.
2. Trên thanh địa chỉ, truy cập: `chrome://extensions` và nhấn **Enter**.
3. Ở góc trên cùng bên phải, bật công tắc **"Developer mode" (Chế độ dành cho nhà phát triển)**.
4. Ở góc trên bên trái, bấm nút **"Load unpacked" (Tải tiện ích đã giải nén)**.
5. Duyệt và chọn thư mục của Tool vừa tạo (ví dụ: `C:\Users\<User>\.devbrowsertool\tools\httpbin_order_tool`).
6. Extension sẽ xuất hiện trên thanh công cụ:
   - Bao gồm đầy đủ `manifest.json` (MV3), `background.js` (service worker), `content.js` (thực thi DOM) và `circuit-breaker.js` (tự động ngắt khi có sự cố).
   - Mở trang web mục tiêu (ví dụ: `https://httpbin.org/forms/post`) và bấm vào extension để chạy tác vụ.

---

## 🛡️ Cơ Chế Bảo Mật & Kỹ Thuật Đột Phá

### 1. 100% Tuân thủ CSP trong Chrome Extension MV3
Chrome Extension Manifest V3 áp dụng chính sách `script-src 'self'` cấm triệt để `eval()` và `new Function()`.  
DevBrowserTool giải quyết dứt điểm bằng thuật toán `resolveSelector()` thuần DOM:
- Tự unwrap an toàn các chuỗi `document.querySelector("...")`.
- Tự parse và xử lý pseudo-selector `:has-text("...")` bằng DOM tree traversal.
- Đảm bảo extension chạy mượt mà trên mọi trang web bảo mật cao mà không vi phạm CSP.

### 2. Tham Số Hóa An Toàn (Safe Parameterization)
- **Tách biệt giá trị kiểm thử**: Lúc Dry-run, hệ thống nội suy giá trị thật để chạy thử; nhưng mã nguồn đóng gói xuất xưởng **bảo toàn nguyên vẹn biến giữ chỗ template `{{key}}`**.
- Tại runtime trong `content.js`, hàm `resolveParamValue()` tự động tra cứu: Giá trị người dùng truyền vào $\rightarrow$ Giá trị mặc định (`default_value`) $\rightarrow$ Chuỗi gốc.

### 3. Tự Động Ngắt Mạch (Circuit Breaker Cấp Tool)
- File `circuit-breaker.js` sử dụng `chrome.storage.local` đếm số lần thất bại liên tiếp trong khung thời gian trượt **10 phút**.
- Khi chạm ngưỡng $\ge 5$ lỗi liên tiếp (sau khi đã loại trừ lỗi mất session đăng nhập), extension tự động chuyển trạng thái `tripped`, tạm dừng thực thi và hướng dẫn người dùng rebuild lại tool để bảo vệ an toàn cho tài khoản.

### 4. Phòng Thủ WebAppServer Cục Bộ (Port 3456)
- Bind cứng vào `127.0.0.1`, cấm tuyệt đối bind `0.0.0.0` để chặn truy cập từ mạng LAN.
- Kiểm tra chặt chẽ `Origin` và `Referer`. Mọi API thay đổi dữ liệu (POST) bắt buộc phải có Session Token ngẫu nhiên (`~/.devbrowsertool/mcp-token`) chống tấn công CSRF và DNS Rebinding.

---

## 🌐 Kiểm Chứng Thực Tế Trên Web Thật

Hệ thống đi kèm kịch bản kiểm tra toàn diện trên Google Chrome thật:

```bash
# Kiểm thử E2E quy trình Agent Kiến trúc B (đã kiểm chứng Cloudflare + Httpbin)
npx tsx scripts/agent-e2e-openfront.ts

# Kiểm thử chu trình Playwright trực tiếp
npx tsx scripts/live-e2e-demo.ts
```

### Kết quả chạy thực tế:

#### 1. Kiểm tra trên `https://openfront.io/` (Site có Anti-Bot Cloudflare thật ngoài đời)
- Phản hồi: `HTTP 403`, Tiêu đề: `"Just a moment..."`
- `SitePolicyResolver` nhận diện chính xác:
  - `Vendor: cloudflare`
  - `Signatures: [cf-ray, challenges.cloudflare.com]`
- **Hành vi chuẩn theo Đặc tả (Mục 8.1 & 3.2)**: Gặp thử thách Turnstile/CAPTCHA ngoài đời, hệ thống **không tấn công mù quáng** mà dừng lại chuyển sang **Chế độ xin Demo người dùng** hoặc tái sử dụng profile trình duyệt có sẵn.

#### 2. Chu trình A-Z trên `https://httpbin.org/forms/post`
- **Bước 1 (Trinh sát)**: Bóc tách thành công 13 interactive elements qua `get_scout_scripts` và `ingest_scout_data`.
- **Bước 2 (Lập Map)**: Lưu Map chuẩn vào `~/.devbrowsertool/maps/httpbin.org.json`.
- **Bước 3 (Đóng gói)**: Sản xuất thành công Chrome Extension MV3 tuân thủ CSP 100%.
- **Bước 4 (Thực thi thật)**: Điền form (`custname="Alice Walker"`, `custtel="+1-202-555-0143"`, `comments="Automated order test"`) và bấm nút submit.
- **Bước 5 (Xác nhận)**: Máy chủ web `httpbin.org/post` phản hồi HTTP 200 xác nhận đã nhận đúng 100% dữ liệu form.

---

## 📁 Cấu Trúc Monorepo

```text
DevBrowserTool/
├── .agents/
│   ├── mcp_config.json          # Cấu hình MCP Server (devbrowsertool, browser-mcp)
│   └── skills/
│       └── devbrowsertool/      # Skill hướng dẫn Agent-Driven workflow (SKILL.md)
│
├── packages/
│   ├── core/                    # Lõi hệ thống: Discovery, MapStore, Engine, Factory, Packager
│   │   ├── src/
│   │   │   ├── actions/         # 5-tier locators, Bézier mouse, Stealth adapter
│   │   │   ├── discovery/       # Scout scripts, ScoutProcessor, SourceMap, Anti-debug
│   │   │   ├── engine/          # 5-step loop (ExecutionEngine), CircuitBreaker
│   │   │   ├── factory/         # Planner, ActionCompiler, Builder (ToolFactory)
│   │   │   ├── map/             # MapStore, AccountScoping, ImportanceEvaluator
│   │   │   └── packager/        # Chrome MV3, Userscript, Advisor HUD Packagers
│   │   └── tests/               # 20 test files, 200 unit tests
│   │
│   ├── ui/                      # devbrowsertool-ui: VS Code Extension & Web App
│   │   ├── devbrowsertool-ui-0.1.0.vsix   # File cài đặt Extension cho IDE
│   │   └── src/
│   │       ├── extension.ts     # Extension entry point & commands
│   │       ├── status-bar.ts    # Red warning recording status bar
│   │       ├── web-server.ts    # WebAppServer (Port 3456) & 10 REST endpoints (/api/mcp/*)
│   │       └── views/           # Studio 2 cột, Map Viewer & Tool Dashboard
│   │
│   ├── mcp-bridge/              # @devbrowsertool/mcp-bridge: MCP Server (stdio)
│   │   ├── src/index.ts         # Khai báo 10 MCP Tools kết nối stdio với Agent
│   │   └── package.json
│   │
│   └── cli/                     # @devbrowsertool/cli: Giao diện dòng lệnh
│       ├── bin/devbrowsertool.js
│       └── src/index.ts         # ui, list, inspect, build commands
│
├── scripts/
│   ├── agent-e2e-openfront.ts   # Kịch bản kiểm thử E2E quy trình Agent trên Chrome thật
│   └── live-e2e-demo.ts         # Kịch bản kiểm thử trực tiếp Playwright
├── DevBrowserTool.md            # ĐẶC TẢ KỸ THUẬT TOÀN DIỆN (Master Architecture Spec)
└── README.md                    # Tài liệu hướng dẫn này
```

---

## 📚 Tài Liệu Đặc Tả Kỹ Thuật Đầy Đủ

Để tìm hiểu sâu về toàn bộ thuật toán (5-tier locators, Bézier mouse, Circuit Breaker, Source Map VLQ reverse mapping, Account-scoping deterministic hash), triết lý thiết kế chi tiết từ Mục 0 đến Mục 18, và các định lượng tham số đã chốt, vui lòng tham khảo:

👉 **[Đặc Tả Kỹ Thuật Toàn Diện: DevBrowserTool.md](file:///c:/Users/lethe/Downloads/FreeTime/DevBrowserTool/DevBrowserTool.md)**
