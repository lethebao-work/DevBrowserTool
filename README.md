# DevBrowserTool — Hệ thống Tự Động Hoá & Sản Xuất Tool Trình Duyệt

> **Kiến trúc 3 Tầng: Tháp (Trinh Sát & Lập Map) ➔ Nhà Máy (Biên Dịch & Tối Ưu) ➔ Tool (Chrome Extension MV3 / Userscript / Advisor HUD Độc Lập)**

---

## 📖 Mục lục

1. [Giới thiệu kiến trúc](#-giới-thiệu-kiến-trúc)
2. [Cài đặt &amp; Khởi động nhanh](#-cài-đặt--khởi-động-nhanh)
3. [3 Cách Thao Tác &amp; Sử Dụng](#-3-cách-thao-tác--sử-dụng)
   - [Cách 1: Giao diện Dòng lệnh (CLI)](#cách-1-giao-diện-dòng-lệnh-cli)
   - [Cách 2: Giao diện Web App Dashboard](#cách-2-giao-diện-web-app-dashboard)
   - [Cách 3: VS Code Extension (.vsix)](#cách-3-vs-code-extension-vsix)
4. [Hướng dẫn Load &amp; Chạy Tool trong Google Chrome](#-hướng-dẫn-load--chạy-tool-trong-google-chrome)
5. [Cơ Chế Bảo Mật &amp; Phòng Thủ (Phase 5)](#-cơ-chế-bảo-mật--phòng-thủ)
6. [Kiểm chứng Thực Tế Trên Web Thật (Live E2E Verification)](#-kiểm-chứng-thực-tế-trên-web-thật)
7. [Cấu trúc Monorepo](#-cấu-trúc-monorepo)

---

## 🏛️ Giới thiệu Kiến trúc

DevBrowserTool tách biệt hoàn toàn giữa quá trình **khám phá nặng nề (Tháp)** và **công cụ thực thi siêu nhẹ (Tool)**:

```
┌─────────────────────────────────────────────────────────────┐
│                    THÁP (Discovery & Scout)                 │
│  - Trinh sát DOM, WebSocket, SSE, API ngầm                  │
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
│  3. Parameterizer: Tách biến động ({username}, {orderId})   │
│  4. DryRunRunner: Chạy thử trước khi xuất bản               │
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

---

## ⚡ Cài đặt & Khởi động nhanh

### Yêu cầu môi trường

- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **Trình duyệt**: Google Chrome (phiên bản ổn định)

### 1. Cài đặt dependencies

```bash
npm install
```

### 2. Biên dịch toàn bộ Monorepo

```bash
npm run build
```

Lệnh này sẽ biên dịch song song cả 3 gói: `@devbrowsertool/core`, `devbrowsertool-ui`, và `@devbrowsertool/cli`.

### 3. Kiểm tra toàn bộ Test Suite

```bash
npm test
```

*Kết quả: 16 test suites, 177/177 unit tests pass 100%.*

---

## 🖥️ 3 Cách Thao Tác & Sử Dụng

### Cách 1: Giao diện Dòng lệnh (CLI)

Gói `@devbrowsertool/cli` cung cấp lệnh trực tiếp:

```bash
# Xem trợ giúp
npx devbrowsertool help

# Xem danh sách tất cả Map domain và Tool đã tạo
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

### Cách 2: Giao diện Web App Dashboard

Giao diện Web App Server cho phép quản lý trực quan trạng thái Map, theo dõi độ trôi dạt (drift revision), và **1-Click Rebuild**:

1. Khởi động server từ terminal:
   ```bash
   npx devbrowsertool ui
   ```
2. Terminal sẽ in ra URL kèm Token bảo mật:
   ```text
   ======================================================
   🚀 Web App UI sẵn sàng tại: http://127.0.0.1:3456?token=7b9a...f4
   🔒 Host: 127.0.0.1 (Bảo vệ chống LAN access)
   🔑 CSRF Token: 7b9a2e6f4a1c...
   ======================================================
   ```
3. Nhấp vào đường link để mở Dashboard trong trình duyệt của bạn:
   - **Tab Map Viewer**: Trực quan hoá đồ thị Resource Nodes, độ tin cậy (confidence), và State Graph.
   - **Tab Tool Dashboard**: Danh sách Tool, trạng thái sức khoẻ (`healthy`, `drift_detected`, `tripped`), và nút **Rebuild Tool** tự động.

---

### Cách 3: Cài Đặt Vào IDE (Antigravity IDE / VS Code)

Extension đóng gói toàn bộ tính năng và giao diện Studio vào IDE của bạn:

1. **Cài đặt vào Antigravity IDE**:
   ```powershell
   & "C:\Users\lethe\AppData\Local\Programs\Antigravity IDE\bin\antigravity-ide.cmd" --install-extension "packages\ui\devbrowsertool-ui-0.1.0.vsix" --force
   ```
   *(Hoặc với VS Code tiêu chuẩn: `code --install-extension packages/ui/devbrowsertool-ui-0.1.0.vsix`)*

2. **Khởi chạy Studio & Live HUD (`Ctrl+Shift+P`)**:
   - `DevBrowserTool: Open DevBrowser Studio & Live HUD`: Mở cửa sổ Studio 2 cột tập trung (Cột trái: Trinh sát URL, Quản lý Maps/Tools, Ghi demo | Cột phải: Live Execution HUD với thanh tiến độ và thẻ màu phát sáng thời gian thực).
   - `DevBrowserTool: Start Demo Recording`: Bắt đầu ghi thao tác tay trên trình duyệt (đèn đỏ `🔴 Recording: <domain>` bật trên Status Bar).
   - `DevBrowserTool: Stop Demo Recording`: Dừng phiên ghi và tự động lưu Map.
   - `DevBrowserTool: Build Chrome Extension from Map`: Đóng gói nhanh Chrome Extension MV3.

---

## 🧩 Hướng dẫn Load & Chạy Tool trong Google Chrome

Sau khi Tool được build (thường lưu tại thư mục `~/.devbrowsertool/tools/<tên_tool>`), bạn thực hiện nạp vào Chrome thật như sau:

1. Mở trình duyệt **Google Chrome**.
2. Trên thanh địa chỉ, nhập: `chrome://extensions` và nhấn **Enter**.
3. Ở góc trên cùng bên phải, bật công tắc **"Developer mode" (Chế độ dành cho nhà phát triển)**.
4. Ở góc trên bên trái, bấm nút **"Load unpacked" (Tải tiện ích đã giải nén)**.
5. Duyệt và chọn thư mục của Tool vừa tạo (ví dụ: `C:\Users\<Tên_bạn>\.devbrowsertool\tools\httpbin_order_tool`).
6. Extension sẽ xuất hiện ngay lập tức trên thanh công cụ:
   - Chứa đầy đủ `manifest.json` (MV3), `background.js` (service worker), `content.js` (thực thi DOM), và `circuit-breaker.js` (tự động ngắt khi có sự cố).
   - Truy cập trang web mục tiêu (ví dụ: `https://httpbin.org/forms/post`) và bấm vào extension để chạy tác vụ.

---

## 🛡️ Cơ Chế Bảo Mật & Phòng Thủ

Các cơ chế bảo vệ cốt lõi được triển khai trực tiếp trong mã nguồn:

### 1. Phòng thủ CSRF & DNS Rebinding (`packages/ui/src/web-server.ts`)

```typescript
// 1. Chỉ bind vào 127.0.0.1, KHÔNG bind 0.0.0.0 (chặn truy cập từ mạng LAN)
this.server.listen(this.port, '127.0.0.1', ...);

// 2. Kiểm tra chặt chẽ Origin & Referer chống tấn công cross-tab
private isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  const validPrefixes = [
    `http://127.0.0.1:${this.port}`,
    `http://localhost:${this.port}`,
  ];
  if (origin) return validPrefixes.some(p => origin.startsWith(p));
  if (referer) return validPrefixes.some(p => referer.startsWith(p));
  return req.headers['x-dbt-token'] === this.csrfToken;
}

// 3. Mutating APIs (POST) bắt buộc phải có session token ngẫu nhiên
if (method === 'POST') {
  if (!this.validateCsrf(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: Missing or Invalid X-DBT-Token' }));
    return;
  }
}
```

### 2. Triệt tiêu dấu vết CDP & Chống bot doanh nghiệp (`packages/core/src/actions/stealth-driver.ts`)

- **SitePolicyResolver**: Tự động nhận diện chữ ký của các dịch vụ bên thứ ba (Cloudflare, DataDome, Akamai) từ header, cookies (`__cf_bm`, `cf-ray`) và challenge script.
- **CDPStealthAdapter**: Ẩn dấu vết tự động hóa ở tầng giao thức CDP (`Runtime.enable`, `navigator.webdriver`), chỉ kích hoạt khi domain có độ quan trọng cao (`importance_score >= 0.8`).

---

## 🌐 Kiểm chứng Thực Tế Trên Web Thật

Hệ thống đi kèm kịch bản kiểm tra toàn diện từ A-Z trên Google Chrome thật:

```bash
npx tsx scripts/live-e2e-demo.ts
```

### Kết quả chạy thực tế:

#### 1. Thử nghiệm trên `https://openfront.io/` (Site có Anti-Bot thật ngoài đời)

- Phản hồi: `HTTP 403`, Tiêu đề: `"Just a moment..."`
- `SitePolicyResolver.detectThirdPartyAntiBot`:
  - `Detected: 🚨 CÓ PHÁT HIỆN`
  - `Vendor: cloudflare`
  - `Signatures: [cf-ray, challenges.cloudflare.com]`
- **Hành vi chuẩn theo Đặc tả (Mục 3.1 & 3.2)**: Khi gặp thử thách Turnstile/CAPTCHA ngoài đời, Tháp **không tấn công mù quáng** mà tự động chuyển sang **"Chế độ xin Demo người dùng"** để con người giải quyết thử thách hoặc tái sử dụng profile có sẵn.

#### 2. Chu trình trọn vẹn A-Z trên `https://httpbin.org/forms/post`

- **Bước 1 (Discovery)**: `StaticAnalyzer` tự động quét DOM thật và bóc tách thành công 13 interactive elements (`input[name="custname"]`, `input[name="custtel"]`, `textarea[name="comments"]`, `button`).
- **Bước 2 (Map Storage)**: Lưu Map chuẩn vào `~/.devbrowsertool/maps/httpbin.org.json`.
- **Bước 3 (Factory Build)**: Đóng gói thành công Chrome Extension MV3 (`manifest.json`, `content.js`, `background.js`, `circuit-breaker.js`) và Advisor HUD script (`httpbin.org.advisor.user.js`).
- **Bước 4 (Live Execution)**: `ExecutionEngine` chạy chu trình 5 bước (Resolve ➔ Verify ➔ Act ➔ Confirm ➔ Fallback) trên Google Chrome:
  - Gõ tên khách hàng: `"Alice Walker"`
  - Gõ số điện thoại: `"+1-202-555-0143"`
  - Gõ ghi chú: `"Automated real order test via DevBrowserTool"`
  - Bấm nút `"Submit order"`
- **Bước 5 (Server Verification)**: Máy chủ web thật `httpbin.org/post` phản hồi mã 200 xác nhận đã nhận đúng 100% dữ liệu form đã điền.
- **Bước 6 (Drift Tracking)**: `ToolRegistry` theo dõi chính xác vòng đời và cảnh báo trôi dạt revision của Tool.

---

## 📁 Cấu trúc Monorepo

```text
DevBrowserTool/
├── packages/
│   ├── core/                    # Lõi hệ thống: Discovery, Map, Engine, Factory, Packager
│   │   ├── src/
│   │   │   ├── actions/         # Primitives, Bézier Stealth, Stealth Driver Adapter
│   │   │   ├── discovery/       # StaticAnalyzer, AntiDebugChecker, DemoRecorder
│   │   │   ├── engine/          # ExecutionEngine (5-step loop), CircuitBreaker
│   │   │   ├── factory/         # StateGraphPlanner, ActionCompiler, ToolFactory
│   │   │   ├── map/             # MapStore, AccountScoping, ImportanceEvaluator
│   │   │   └── packager/        # ExtensionPackager, UserscriptPackager, AdvisorPackager
│   │   └── tests/               # 16 test files, 177 unit tests
│   │
│   ├── ui/                      # VS Code Extension & Web App UI Server
│   │   ├── devbrowsertool-ui-0.1.0.vsix   # File cài đặt VS Code Extension
│   │   └── src/
│   │       ├── extension.ts     # Extension entry point & commands
│   │       ├── status-bar.ts    # Red warning recording status bar
│   │       ├── web-server.ts    # Web App Server (127.0.0.1, CSRF token)
│   │       └── views/           # Map Viewer & Tool Dashboard webview panels
│   │
│   └── cli/                     # Command Line Interface (@devbrowsertool/cli)
│       ├── bin/devbrowsertool.js
│       └── src/index.ts         # ui, list, inspect, build commands
│
├── scripts/
│   └── live-e2e-demo.ts         # Kịch bản chạy thực tế A-Z trên Chrome thật
├── dac-ta-he-thong-thap-nhamay-tool.md   # Đặc tả kỹ thuật gốc (16 mục)
└── README.md                    # Tài liệu này
```
