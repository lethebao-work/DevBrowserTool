# ĐẶC TẢ KỸ THUẬT TOÀN DIỆN: DEVBROWSERTOOL
## Hệ Thống Agent Tương Tác Web, Tích Lũy Tri Thức Cấu Trúc & Tự Động Sản Xuất Công Cụ

> **Phiên bản:** 2.0 (Master Architecture Specification)  
> **Trạng thái:** Đã triển khai & Kiểm chứng thực tế (Production-Ready)  
> **Kế thừa & Hợp nhất:** Toàn bộ đặc tả thiết kế gốc (`dac-ta-he-thong-thap-nhamay-tool.md`), 5 Phase phát triển, cuộc chuyển đổi sang Mô hình Agent-Driven MCP (Kiến trúc B), và các bài học kỹ thuật thực chiến (CSP compliance, Parameterization, 5-tier locators).

---

## 0. QUY ƯỚC ĐỌC TÀI LIỆU (BẮT BUỘC ĐỌC TRƯỚC)

Tài liệu này là chuẩn mực kỹ thuật cao nhất của dự án DevBrowserTool, sử dụng ngôn ngữ chuẩn tắc để loại bỏ mọi sự mơ hồ khi con người hoặc AI Agent đọc và thực thi:

- **PHẢI / BẮT BUỘC**: Hành vi bắt buộc, không có ngoại lệ trừ khi tài liệu nêu rõ ngoại lệ.
- **KHÔNG ĐƯỢC / TUYỆT ĐỐI KHÔNG**: Cấm tuyệt đối, không có bất kỳ ngoại lệ nào.
- **NÊN**: Khuyến nghị mặc định, có thể lệch nếu có lý do kỹ thuật chính đáng được ghi chép rõ ràng.
- **CÓ THỂ**: Tuỳ chọn, không bắt buộc.
- Khi tài liệu nêu "X hay Y" mà không nói rõ ưu tiên, đây LÀ LỖI của tài liệu — Agent không được tự suy diễn, phải dừng lại và yêu cầu người dùng xác nhận.
- Mọi thuật ngữ viết hoa có định nghĩa chính thức tại **Mục 16 (Bảng Thuật Ngữ)**. Nếu một từ viết hoa xuất hiện mà không có trong bảng thuật ngữ, đây LÀ LỖI của tài liệu.
- Không suy diễn hành vi từ "tinh thần chung" nếu có mục cụ thể mô tả khác — **mục cụ thể luôn thắng mô tả tổng quát**.

---

## 1. TỔNG QUAN HỆ THỐNG & TRIẾT LÝ CỐT LÕI

### 1.1 Mục tiêu Dự Án
Thông thường, các AI Agent hiện đại (như Antigravity IDE, Claude Code, Cursor) hoàn toàn có thể tự mở trình duyệt bằng công cụ có sẵn (như `browser-mcp` hoặc `chrome-devtools`) để cào dữ liệu hoặc tương tác với một website. Tuy nhiên, quy trình đó có hai nhược điểm chí mạng:
1. **Thiếu khả năng tích lũy tri thức**: Mỗi lần làm việc là một lần Agent phải "dò mù" từ đầu, tốn kém token, chậm chạp và dễ gãy khi giao diện có thay đổi nhỏ.
2. **Không sinh ra sản phẩm độc lập**: Người dùng cuối không thể chạy tác vụ lặp đi lặp lại nếu không mở Agent hoặc IDE lên điều khiển.

**DevBrowserTool ra đời để giải quyết triệt để hai nhược điểm này:**
- **Tích luỹ tri thức cấu trúc**: Khám phá, bóc tách và duy trì một bản đồ số (Map) về cấu trúc phần tử, API ẩn, kênh WebSocket và luồng trạng thái của website.
- **Nhà máy sản xuất công cụ tự động**: Từ tri thức cấu trúc đã tích lũy, hệ thống tự động biên dịch và đóng gói thành các **Tool độc lập, siêu nhẹ** (Chrome Extension Manifest V3, Userscript Tampermonkey, hoặc Advisor HUD Overlay) để người dùng cuối chạy hàng ngày trong trình duyệt mà **không cần Agent hay IDE đứng sau giám sát**.

### 1.2 Ba Thành Phần Cốt Lõi (Phân Định Rạch Ròi Vai Trò)

| Thành phần | Có LLM? | Vai trò | Vòng đời |
|---|---|---|---|
| **Tháp** *(Discovery Engine)* | Có (ở tầng Agent/IDE) | Khám phá, trinh sát, bóc tách cấu trúc DOM/API/WebSocket, xây dựng và duy trì Map. | Chạy định kỳ hoặc theo yêu cầu khi cần học website mới. |
| **Nhà máy** *(Tool Factory)* | Có (ở tầng Agent/IDE) | Lập kế hoạch hành trình (StateGraphPlanner), biên dịch các biến thể (ActionCompiler), tham số hóa và đóng gói thành artifact hoàn chỉnh. | Chạy 1 lần mỗi khi tạo mới hoặc cập nhật 1 Tool. |
| **Tool** *(Artifact Sản Phẩm)* | **Mặc định KHÔNG**. CHỈ có khi phục vụ đúng nghiệp vụ Tool (xem Mục 9). | Thực thi tác vụ tự động hóa theo kịch bản đã biên dịch sẵn, sử dụng thuật toán tự chữa lành tĩnh (Fallback & Fuzzy Healing cục bộ). | Chạy độc lập, lâu dài trong trình duyệt người dùng, không phụ thuộc vào Tháp hay Nhà máy. |

```
┌─────────────────────────────────────────────────────────────┐
│                    THÁP (Discovery Engine)                  │
│  - Trinh sát DOM, WebSocket, SSE, API ngầm, Local Storage   │
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

**Nguyên tắc bất biến**: Tool KHÔNG BAO GIỜ tự ý khám phá lại cấu trúc website hay tự sửa selector/endpoint của chính nó bằng LLM. Mọi khả năng "tự sửa cấu trúc" CHỈ tồn tại ở Tháp và Nhà máy. Khi Tool gặp lỗi vượt quá khả năng xử lý cục bộ của nó, nó PHẢI dừng lại và ghi log có cấu trúc, KHÔNG ĐƯỢC tự suy luận cách sửa.

---

## 2. NGUYÊN TẮC NỀN TẢNG (Áp Dụng Xuyên Suốt Hệ Thống)

1. **Lưu trữ Cục Bộ (Local-Only)**: Toàn bộ dữ liệu Map, cấu hình Tool và token bảo mật được lưu trữ tại máy cục bộ người dùng (`~/.devbrowsertool/`). Tuyệt đối không gửi hay đồng bộ dữ liệu cấu trúc lên bất kỳ máy chủ đám mây công cộng nào. Map có thể được xuất/nhập thủ công giữa các máy của cùng một người dùng.
2. **Tool Không Có LLM Tự Sửa Cấu Trúc**: Tool được tối ưu hóa cho tốc độ thực thi miligiây và tính tin cậy tuyệt đối, dựa trên thuật toán cục bộ thay vì gọi LLM tốn kém và bất định.
3. **Phân Định Nghiêm Ngặt Chính Sách Anti-Detection**:
   - **Nhóm 1 (ĐƯỢC hỗ trợ)**: Giảm thiểu các dấu hiệu hành vi máy móc (delay ngẫu nhiên theo phân phối Gaussian, di chuyển chuột cong Bezier tự nhiên, mô phỏng nhịp gõ phím con người).
   - **Nhóm 2 (TUYỆT ĐỐI CẤM)**: Chủ động phá hoại, vượt qua hoặc vô hiệu hóa các cơ chế bảo mật/chống gian lận mà website dựng lên có chủ đích (ví dụ: browser-lock trong thi cử, anti-bot enterprise Cloudflare/DataDome). Khi gặp cơ chế này, hệ thống PHẢI coi là tín hiệu dừng và bàn giao cho người dùng.
4. **Không Lưu Giá Trị Runtime Thô**: Map chỉ lưu công thức trích xuất giá trị (`value_formula`), không lưu dữ liệu nhạy cảm hay dữ liệu nghiệp vụ của phiên làm việc.
5. **Dừng Lại Hoặc Tái Khám Phá**: Mọi tình huống bất khả kháng (giao diện đổi hoàn toàn, chạm ngưỡng phần cứng bảo mật Passkey/WebAuthn) PHẢI dẫn tới 1 trong 2 kết quả: dừng lại bàn giao người dùng, HOẶC yêu cầu Tháp tái khám phá — không bao giờ để Tool tự "đoán mò".

---

## 3. THÁP (DISCOVERY ENGINE) — ĐẶC TẢ CHI TIẾT

### 3.1 Quy Trình Khám Phá 1 Hành Động Cụ Thể
1. **Kiểm tra Source-First (Ưu tiên số 1 - Rẻ nhất, chính xác nhất)**:
   - Tự động kiểm tra file `.js.map` lộ ra cạnh các bundle JavaScript. Sử dụng bộ giải mã VLQ để khôi phục cấu trúc source code gốc, tìm kiếm các route, API endpoints và model schema. Nếu tìm thấy, trích xuất trực tiếp và bỏ qua bước dò giao diện.
2. **Quy trình Khám Phá Thông Thường (Agent Tự Thử)**:
   - Agent thực hiện tối đa **3 lần thử** cho cùng một mục tiêu con. Nếu vượt quá 3 lần thất bại liên tiếp, hệ thống tự động kích hoạt **Cơ chế xin Demo người dùng (Mục 3.2)**.
3. **Các Hành Động BẮT BUỘC Xin Xác Nhận/Demo Ngay Từ Đầu** (Không được tự thử):
   - Đăng nhập OAuth / SSO bên thứ ba.
   - Nhập mật khẩu, mã OTP, hoặc dữ liệu định danh cá nhân nhạy cảm.
   - Các hành động khó hoàn tác: Submit thanh toán, xóa dữ liệu, gửi đơn hàng.
   - Các hành động thuộc loại `elevated` (Mục 6.3) hoặc `hardware_bound` (WebAuthn/Passkey).
4. **Xác Thực Độ Ổn Định (Multi-Observation)**:
   - Một node chỉ được đánh dấu là `stable` khi đã được quan sát thành công tối thiểu **2-3 lần độc lập**. Các lần quan sát trong lúc mạng lỗi hoặc HTTP 5xx không được tính.
   - Nếu 2-3 lần quan sát trả về kết quả khác nhau (do A/B testing hoặc cá nhân hóa), hệ thống PHẢI lưu thành nhiều `Variant` trong cùng một node, không được tùy tiện loại bỏ biến thể nào.

### 3.2 Cơ Chế Xin Demo Người Dùng (Demo Recorder)
- Khi kích hoạt chế độ demo, hệ thống PHẢI hiển thị tín hiệu trực quan rõ ràng (thanh trạng thái chuyển màu đỏ rực `🔴 Recording: <domain>`). Tuyệt đối cấm ghi lén người dùng.
- Tab trình duyệt được khóa tạm thời khỏi các thao tác can thiệp của Agent để tránh xung đột race condition với thao tác tay của con người.
- Với các hành động phi giao diện (`call_api`, `patch_runtime`), hệ thống hiển thị bảng thông số request cụ thể và xin người dùng xác nhận bằng nút bấm Đồng ý/Từ chối, không yêu cầu người dùng thao tác tay những thứ họ không làm được trên UI.

### 3.3 Cấu Trúc Map 2 Lớp (Resource Graph & State-Transition Graph)
Bản đồ tri thức của DevBrowserTool gồm hai đồ thị bổ trợ:
1. **Resource Graph (Tài nguyên tĩnh/bán tĩnh)**:
   - Quản lý 7 loại tài nguyên: `dom_element`, `endpoint`, `header_signature`, `binary_schema`, `local_persistence`, `websocket_channel`, `hardware_bound`.
   - Định danh của mỗi node PHẢI dựa trên **vai trò ngữ nghĩa (intent)** (ví dụ: `submit_order_button`, `customer_name_input`), TUYỆT ĐỐI KHÔNG dùng selector CSS do framework tự sinh ngẫu nhiên làm ID định danh.
2. **State-Transition Graph (Đồ thị chuyển trạng thái)**:
   - Dành riêng cho các ứng dụng Single Page Application (SPA).
   - Khóa trạng thái là tổ hợp 3 thành phần: `(url_pattern, dom_fingerprint, virtual_route)`.
   - Mỗi cạnh chuyển trạng thái gắn liền với một hành động và điều kiện tiên quyết (`preconditions`).

### 3.4 Quy Trình Chẩn Đoán Kênh Thu Thập Dữ Liệu (5 Bước Thứ Tự)
Hệ thống chẩn đoán theo thứ tự ưu tiên sau và dừng lại ngay ở bước đầu tiên phù hợp:
1. **Client-side Encryption**: Kiểm tra xem dữ liệu có bị mã hóa phía client trước khi truyền không (Web Crypto API). Nếu có, hook tại ranh giới giải mã hoặc đọc tại DOM sau khi đã render.
2. **WebSocket Realtime**: Nếu site có kênh WebSocket đang hoạt động, ưu tiên đọc trạng thái qua WebSocket; DOM chỉ dùng để gửi tương tác input.
3. **Local Persistence**: Kiểm tra Service Worker, Cache Storage và IndexedDB trước khi kết luận "không có API nào".
4. **WebAssembly Boundary**: Nếu logic nằm trong Wasm, CHỈ hook tại ranh giới trao đổi JS ↔ Wasm (tham số và kết quả hàm), tuyệt đối không can thiệp reverse module Wasm.
5. **DOM/API Tiêu Chuẩn**: Sử dụng bộ định vị 5 tầng theo Mục 6.1.

### 3.5 Chế Độ Khám Phá Sâu (Deep Discovery - 6 Bước)
Chỉ kích hoạt khi website bị làm rối mã nguồn nặng (obfuscated) hoặc sử dụng giao thức nhị phân riêng biệt:
$$\text{Observe} \longrightarrow \text{Hook} \longrightarrow \text{Breakpoint} \longrightarrow \text{Rebuild} \longrightarrow \text{Patch} \longrightarrow \text{Pure-extraction}$$
- Kiểm tra anti-debug trước khi đặt Hook/Breakpoint: Hiệu chuẩn baseline động qua 3 vòng lặp, nếu phát hiện độ trễ thực thi lệch $\ge 5.0$ lần hoặc gặp câu lệnh `debugger` lặp lại $\ge 3$ lần, hệ thống lập tức hạ mức can thiệp để bảo vệ an toàn cho phiên làm việc.
- Đối với giao thức nhị phân (Protobuf): Bắt các frame mẫu, Agent phân tích cấu trúc JS 1 lần để suy ra `binary_schema`, sau đó lưu schema vào Map để engine decode thuần túy mà không cần gọi LLM ở runtime.

### 3.6 Chế Độ Thoát Hiểm (Escape Hatch)
- **Điều kiện kích hoạt**: Toàn bộ 5 tier định vị đều thất bại liên tục, sau khi đã loại trừ nguyên nhân mất phiên đăng nhập hoặc rớt mạng.
- Agent được cấp quyền tương tác CDP linh hoạt để tìm cách thao tác hoạt động được.
- Khi tìm được, node tạo ra PHẢI được gắn cờ `discovered_via: "escape_hatch"`, TTL rút ngắn xuống **7 ngày** (thay vì 30 ngày chuẩn), và ưu tiên bàn giao người dùng sớm khi có biến động.

### 3.7 Đánh Giá Mức Độ Quan Trọng Của Site (Importance Score)
- Heuristic tự động tính điểm từ $0.0$ đến $1.0$ dựa trên tín hiệu: Có form thanh toán, OAuth, nhập thông tin cá nhân, tần suất sử dụng.
- Người dùng có quyền can thiệp điều chỉnh điểm số.
- Khi có sự bất đồng giữa Heuristic và Người dùng lệch $\ge 0.25$ qua $\ge 3$ lần liên tiếp, hệ thống tự động học và điều chỉnh lại trọng số heuristic cho domain đó.
- Site có điểm $\ge 0.8$ được xếp vào nhóm **Critical**: Yêu cầu ngưỡng tin cậy cao hơn, tự động kích hoạt chế độ Stealth Driver tầng giao thức.

### 3.8 Circuit Breaker Cấp Domain (Trong Tháp)
- Nếu tỷ lệ node lỗi vượt ngưỡng trong thời gian ngắn (ngưỡng chuẩn: $\ge 5$ lỗi liên tiếp trong 10 phút), Tháp đánh dấu toàn bộ Map của domain đó là "nghi ngờ" và kích hoạt tái khám phá diện rộng.
- Luôn kiểm tra loại trừ lỗi mất session đăng nhập trước khi kích hoạt Circuit Breaker.

### 3.9 Account-Scoping & Quản Lý Đa Tài Khoản
- Map được phân tách làm hai vùng:
  - `base_nodes`: Các node cấu trúc dùng chung cho mọi tài khoản trên domain.
  - `account_slots`: Các node biến thể (`delta_nodes`) gắn riêng với từng tài khoản.
- **Khóa định danh Account Slot**: BẮT BUỘC là SHA-256 hash có tính xác định (deterministic) dựa trên bộ ba: `(domain, normalized_identifier, namespace_tag)`. Tuyệt đối không dùng salt ngẫu nhiên vì sẽ phá vỡ khả năng hợp nhất dữ liệu đa phiên.
- **Quy tắc Thăng Cấp**: Một node chỉ được thăng cấp từ `delta_nodes` lên `base_nodes` khi được quan sát thấy giống hệt nhau trên $\ge 2$ tài khoản độc lập.

### 3.10 Vòng Đời Biến Thể (Variant Lifecycle Management)
- Mỗi node lưu trữ tối đa **5 biến thể (Variants)** để chống phình to dữ liệu.
- Khi có biến thể thứ 6 xuất hiện, hệ thống tự động loại bỏ biến thể yếu nhất (có `confidence` thấp nhất và lâu không được xác thực).
- Chỉ số `confidence` được tính toán theo cửa sổ trượt giảm dần theo thời gian (time-decay), không cộng dồn lịch sử cũ để phản ánh đúng hiện trạng mới nhất của website.

---

## 4. ĐẶC TẢ MAP SCHEMA (ĐỒ THỊ TRI THỨC CẤU TRÚC)

Định dạng JSON chuẩn được lưu trữ nguyên tử (atomic write qua file `.tmp` rồi rename) tại thư mục `~/.devbrowsertool/maps/<domain>.json`:

```typescript
interface MapFile {
  schema_version: string;          // Phiên bản schema (ví dụ: "2.0.0")
  content_revision: number;        // Tăng tuyến tính sau mỗi lần cập nhật nội dung
  domain: string;                  // Domain gốc (ví dụ: "httpbin.org")
  bundle_id: string | null;        // ID liên kết nếu thuộc Site Bundle (OAuth/SSO)
  importance_score: number;        // Điểm số quan trọng (0.0 đến 1.0)
  importance_source: "auto" | "user" | "hybrid";
  base_nodes: ResourceNode[];      // Tài nguyên dùng chung cho mọi tài khoản
  account_slots: {
    [account_hash: string]: {
      delta_nodes: ResourceNode[]; // Tài nguyên đặc thù của riêng tài khoản đó
    };
  };
  state_graph: StateNode[];        // Đồ thị trạng thái và chuyển dịch (SPA)
}

interface ResourceNode {
  id: string;                      // Khóa định danh duy nhất (theo intent)
  type: "endpoint" 
      | "dom_element" 
      | "header_signature"
      | "binary_schema" 
      | "local_persistence"
      | "websocket_channel" 
      | "hardware_bound";
  intent: string;                  // Mô tả ngữ nghĩa (ví dụ: "submit_order_button")
  variants: Variant[];             // Danh sách tối đa 5 biến thể định vị
  discovered_via: "normal" | "escape_hatch";
  requires_elevation: boolean;     // true nếu cần truy cập closed-shadow-root hoặc patch_runtime
}

interface Variant {
  value_formula: string;           // Công thức định vị/trích xuất (CSS/XPath/AX/JS)
  confidence: number;             // Điểm tin cậy (0.0 đến 1.0, suy giảm theo thời gian)
  last_verified: number;          // Timestamp epoch ms của lần kiểm chứng gần nhất
  fail_count_recent: number;      // Số lần thất bại trong cửa sổ hiện tại
  locale: string | null;           // Nhãn ngôn ngữ (ví dụ: "vi-VN", "en-US")
}

interface StateNode {
  id: string;                      // ID trạng thái
  match_key: {
    url_pattern: string;           // Regex hoặc mẫu so khớp URL
    dom_fingerprint: string;       // Hash đặc trưng cấu trúc khung DOM chính
    virtual_route?: string;        // Route ảo bắt được qua pushState/hashchange
  };
  preconditions: string[];         // Danh sách node ID phải thỏa mãn trước khi vào state
  transitions: Array<{
    action_ref: string;            // ID hành động kích hoạt chuyển trạng thái
    target_state_id: string;       // ID trạng thái đích đến
  }>;
}
```

---

## 5. NHÀ MÁY (TOOL FACTORY) — ĐẶC TẢ CHI TIẾT

### 5.1 Đầu Vào Của Nhà Máy
1. **Mục tiêu của người dùng**: Yêu cầu tự động hóa diễn đạt bằng ngôn ngữ tự nhiên (ví dụ: *"Tự động điền thông tin khách hàng và bấm gửi đơn hàng trên form post của httpbin.org"*).
2. **Bản đồ cấu trúc liên quan (MapFile)**: Đọc từ MapStore cục bộ của domain mục tiêu.
3. **Cấu hình tùy chọn**: Mức độ can thiệp anti-detection, API key (nếu Tool cần gọi LLM nghiệp vụ).

### 5.2 Quy Trình Sản Xuất Tool (5 Bước Bắt Buộc)
1. **Lập Kế Hoạch (StateGraphPlanner)**:
   - Phân tích mục tiêu người dùng và tìm đường đi ngắn nhất trên State-Transition Graph.
   - Nếu phát hiện thiếu node hoặc thiếu cạnh chuyển dịch, Nhà máy tạm dừng và yêu cầu Tháp khám phá bổ sung trong phạm vi ngân sách cho phép (Mục 14.4).
2. **Biên Dịch Chuỗi Hành Động (ActionCompiler)**:
   - Chuyển đổi kế hoạch thành danh sách các `ActionSpec`.
   - **Bảo toàn đa biến thể**: Mỗi action khi được biên dịch PHẢI giữ lại TOÀN BỘ các biến thể hợp lệ từ ResourceNode để Tool có sẵn cơ chế fallback tĩnh tại chỗ.
3. **Tham Số Hóa An Toàn (Parameterization)**:
   - Các giá trị cụ thể được người dùng nhập lúc demo hoặc mô tả (ví dụ tên `"Alice"`, số điện thoại `"+1-202-555-0143"`) được bóc tách thành các biến giữ chỗ dạng `{{custname}}`, `{{custtel}}`.
   - Lưu trữ schema định nghĩa tham số kèm `default_value` vào cấu hình của Tool.
4. **Chạy Thử Xác Thực (Dry-Run Runner)**:
   - Thực thi chuỗi hành động thông qua Engine Thực Thi.
   - **Tách biệt giá trị**: Trong bước Dry-run, giá trị thực tế được nội suy tạm thời để kiểm thử tương tác trên trình duyệt thật; mã nguồn xuất xưởng vẫn giữ nguyên biến mẫu template `{{...}}`.
   - Nếu có bước nào bị trượt vào Fallback trong lúc Dry-run, hệ thống coi đây là cảnh báo cấu trúc chưa đủ ổn định và yêu cầu kiểm tra lại.
5. **Đóng Gói Thành Phẩm (ExtensionPackager / UserscriptPackager / AdvisorPackager)**:
   - Sinh mã nguồn hoàn chỉnh không phụ thuộc, tính toán quyền hạn tối thiểu (Least Privilege).

### 5.3 Ba Hình Thức Đóng Gói Thành Phẩm

| Hình thức | Mục đích & Khi nào sử dụng | Đặc điểm kỹ thuật bắt buộc |
|---|---|---|
| **Chrome Extension (Manifest V3)** | Chạy ngầm tự động, tin cậy, không cần mở IDE hay Agent. | Sử dụng Service Worker (`background.js`), Content Script (`content.js`), mã hóa chuẩn CSP `script-src 'self'`, tích hợp `circuit-breaker.js`. Quyền hạn được tính toán tối thiểu theo đúng actions có trong kịch bản. |
| **Userscript (`.user.js`)** | Cài đặt linh hoạt qua Tampermonkey/Violentmonkey, dễ chia sẻ nội bộ. | Tích hợp khối metadata `@name`, `@match`, `@run-at document-idle`, tự động chèn engine thực thi và cơ chế fallback. Hỗ trợ `@updateURL` để tự nhận bản vá. |
| **Advisor Overlay HUD** | Chế độ hướng dẫn người dùng: Không tự bấm, chỉ làm nổi bật (Spotlight) vị trí tiếp theo trên màn hình. | Chỉ sử dụng primitive `extract` và vẽ khung Spotlight/Tooltip hướng dẫn, trao quyền quyết định click cuối cùng cho con người. |

---

## 6. ĐẶC TẢ ACTION PRIMITIVE & BỘ ĐỊNH VỊ 5 TẦNG (5-TIER LOCATORS)

### 6.1 Bộ Định Vị 5 Tầng (5-Tier Locators)
Khi thực hiện các thao tác tương tác giao diện (`click`, `fill`), hệ thống và Tool BẮT BUỘC phải thử định vị theo thứ tự 5 tầng sau và dừng lại ở tầng đầu tiên tìm thấy phần tử hợp lệ:

```
┌────────────────────────────────────────────────────────┐
│ Tier 1: Accessibility Tree (CDP fullAXTree role/name)  │  ◄── Ưu tiên cao nhất (Chuẩn ngữ nghĩa)
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Tier 2: JS Query (querySelector, XPath, :has-text)    │  ◄── Phổ biến, hiệu năng cao
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Tier 3: CDP DOM Domain (Xuyên thấu Closed Shadow DOM)  │  ◄── Elevated Action
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Tier 4: Fuzzy Local-Heal (Levenshtein, Text Sim ≥ 0.85)│  ◄── Tự phục hồi không cần LLM
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ Tier 5: Coordinate / CV (Canvas, WebGL, Bounding Box)  │  ◄── Giải pháp cuối cùng
└────────────────────────────────────────────────────────┘
```

1. **Tier 1 — Accessibility Tree Query**: Sử dụng CDP domain `Accessibility` để tìm phần tử qua `role` và thuộc tính `name` (nguồn ngữ nghĩa `aria-*`). Đây là tầng chuẩn nhất vì liên kết trực tiếp với vai trò ngữ nghĩa của phần tử.
2. **Tier 2 — JS Query**: Truy vấn qua `document.querySelector` hoặc các bộ chọn văn bản CSS mở rộng.
3. **Tier 3 — CDP DOM Query**: Truy vấn trực tiếp qua tầng giao thức CDP DOM. Bắt buộc dùng khi cần định vị phần tử nằm bên trong **Closed Shadow Root** (nơi JavaScript trong trang bị cô lập). Đây là thao tác `elevated`.
4. **Tier 4 — Fuzzy Local-Heal (Tự Phục Hồi Cục Bộ)**: So khớp gần đúng dựa trên văn bản, placeholder hoặc nhãn liên kết bằng thuật toán Levenshtein Distance kết hợp Token Jaccard. Ngưỡng chấp nhận BẮT BUỘC $\ge 0.85$. Hoàn toàn chạy offline, không gọi LLM.
5. **Tier 5 — Computer Vision & Coordinate**: Click theo tọa độ vật lý tương đối hoặc tuyệt đối, dành cho các giao diện dựng trên HTML5 `<canvas>` hoặc WebGL nơi không có cây DOM.

### 6.2 Bảng Đầy Đủ Action Primitive

| Action | Chức năng | Cơ chế kỹ thuật & Ràng buộc bắt buộc |
|---|---|---|
| `navigate(url)` | Chuyển trang | Đợi network idle và kiểm tra trạng thái HTTP. |
| `fill(node_ref, value)` | Điền dữ liệu vào input | **Thử nghiệm 2 giai đoạn**: Gán trực tiếp qua `.value` $\rightarrow$ Đọc lại xác nhận. Nếu framework (như React/Vue) khôi phục lại giá trị cũ, tự động chuyển sang kích hoạt qua `prototype setter` (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)` kèm dispatch event `input` và `change`). |
| `click(node_ref)` | Bấm phần tử | Thực hiện theo bộ định vị 5 tầng. Kết hợp mô phỏng nhịp chuột tự nhiên. |
| `call_api(node_ref, params)` | Gọi trực tiếp API | Gửi HTTP request ngầm với cookie và authorization header của phiên hiện tại. |
| `extract(node_ref)` | Trích xuất nội dung | Đọc dữ liệu text/attribute từ DOM. BẮT BUỘC lọc prompt-injection trước khi sử dụng. |
| `call_llm(prompt, data)` | Gọi LLM Nghiệp Vụ | **CHỈ dùng cho Vai trò 1 (Mục 9)** phục vụ nghiệp vụ của Tool (ví dụ tóm tắt nội dung bài viết). Cấm dùng để tự vá cấu trúc. Sử dụng API key riêng của người dùng. |
| `deep_scan_local` | Quét dữ liệu client | Quét LocalStorage, SessionStorage, IndexedDB. Chỉ trả về các trường khớp schema đã định trước, cấm dump toàn bộ dữ liệu thô. |
| `patch_runtime` | Ghi đè hàm hệ thống | Thao tác `elevated`. Dùng để quan sát mạng (`window.fetch`, `WebSocket`). Phải chạy ở `document_start` trong MAIN world và không được ghi đè trắng làm gãy các extension khác. |
| `wait_for(condition)` | Chờ điều kiện | Chờ phần tử xuất hiện hoặc URL thay đổi với timeout an toàn. |
| `branch(condition, a, b)` | Rẽ nhánh điều kiện | Đánh giá dựa trên trạng thái đã khớp với State Graph, không dùng LLM phán đoán lại. |
| `loop(items, sub_action)` | Lặp danh sách | Triển khai theo mô hình Transaction Queue: Phần tử lỗi nhiều lần được đẩy vào Dead-Letter Queue để không chặn toàn bộ chuỗi. |

Mọi action đều PHẢI có thuộc tính `on_failure` tường minh với một trong 3 giá trị: `"stop"` | `"skip_and_continue"` | `"ask_user"`.

### 6.3 Phân Loại Ranh Giới: Elevated vs. Hardware-Bound
- **Elevated Action**: Hành động có rủi ro bảo mật nhưng **CÓ THỂ tự động hóa** sau khi người dùng đã cấp quyền xác nhận tối thiểu 1 lần (ví dụ: truy cập closed shadow root, hook `patch_runtime`).
- **Hardware-Bound Action**: Các hành động liên quan tới **WebAuthn / Passkey / FIDO2**. Khóa bí mật nằm vĩnh viễn trong chip bảo mật phần cứng (TPM/Secure Enclave), hoàn toàn không thể trích xuất. Node loại này **PHẢI LUÔN DỪNG LẠI bàn giao cho người dùng thao tác vật lý trong MỌI LẦN CHẠY**. Tuyệt đối cấm thiết kế bất kỳ cơ chế nào cố gắng tự động hóa loại node này.

---

## 7. ENGINE THỰC THI & THUẬT TOÁN TỰ PHỤC HỒI

Engine Thực Thi vận hành theo vòng lặp 5 bước khép kín (Resolve $\rightarrow$ Verify $\rightarrow$ Act $\rightarrow$ Confirm $\rightarrow$ Fallback), được dùng chung cho cả môi trường Dry-run của Nhà máy lẫn môi trường Production của Tool:

```
┌────────────────────────────────────────────────────────┐
│ 1. RESOLVE: Khớp trạng thái trang với StateNode        │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ 2. VERIFY-BEFORE-ACT: Kiểm tra rẻ tiền sự tồn tại      │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ 3. ACT: Thực thi qua primitive tương ứng               │
└──────────────────────────┬─────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────┐
│ 4. CONFIRM: Xác thực kết quả có đúng kỳ vọng không     │
└──────────────┬───────────────────────────┬─────────────┘
       [Khớp thành công]           [Thất bại/Sai lệch]
               ▼                           ▼
┌──────────────────────────────┐ ┌──────────────────────────────────────┐
│ Cập nhật last_verified       │ │ 5. FALLBACK:                         │
│ & tăng điểm confidence       │ │ - Thử các variants còn lại (theo decay)
└──────────────────────────────┘ │ - Thử Tier 4 Fuzzy Local-Heal       │
                                 │ - Thử Tier 5 Coordinate/CV           │
                                 │ - Hết cách: Ghi log có cấu trúc và   │
                                 │   dừng lại kích hoạt Circuit Breaker │
                                 └──────────────────────────────────────┘
```

### 7.1 Thuật Toán Xác Thực Hội Tụ Trạng Thái CRDT (Mục 7, Step 4)
Đối với các website cộng tác thời gian thực (Google Docs, Figma, Notion) nơi nội dung hội tụ bất đồng bộ qua mạng:
- Bước Confirm PHẢI thực hiện đọc lại giá trị **3 lần liên tiếp**.
- Khoảng cách giữa mỗi lần đọc là **50ms**.
- Giá trị chỉ được coi là xác nhận thành công khi cả 3 lần đọc cho kết quả hoàn toàn giống nhau.
- Timeout tối đa cho toàn bộ quá trình hội tụ là **1.000ms (1 giây)**.

### 7.2 Thuật Toán Circuit Breaker Cấp Tool
- Triển khai độc lập trong file `circuit-breaker.js` của Chrome Extension bằng `chrome.storage.local`.
- **Cơ chế đếm**: Duy trì một danh sách timestamp các lần thất bại trong khung thời gian trượt **10 phút**.
- **Ngưỡng ngắt mạch**: Khi ghi nhận $\ge 5$ lần thất bại liên tiếp cùng loại:
  1. Kiểm tra loại trừ lỗi mất session đăng nhập (redirect trang login hoặc mất cookie). Nếu là mất session, chỉ hiển thị thông báo yêu cầu đăng nhập lại, không ngắt mạch.
  2. Nếu là lỗi cấu trúc thật sự: Chuyển trạng thái sang `tripped` (ngắt mạch).
  3. Từ chối thực thi các lần chạy tiếp theo để bảo vệ an toàn cho tài khoản người dùng.
  4. Hiển thị thông báo trên giao diện Extension khuyến nghị người dùng: *"Website đã đổi cấu trúc, vui lòng mở Nhà máy để Rebuild lại Tool"*.

---

## 8. CHÍNH SÁCH ANTI-DETECTION & HUMAN EMULATION

### 8.1 Phân Định Ranh Giới Đạo Đức & Kỹ Thuật
- **Nhóm 1 (Hành vi tự nhiên - ĐƯỢC PHÉP)**:
  - **Quỹ đạo chuột Bezier**: Di chuyển con trỏ chuột theo đường cong Cubic Bézier qua tối thiểu **20 bước nội suy**, có gia tốc ở đoạn giữa và giảm tốc khi tới gần mục tiêu.
  - **Mô phỏng nhịp gõ phím**: Khoảng trễ ngẫu nhiên giữa hai ký tự dao động từ **50ms đến 240ms**, thỉnh thoảng có sai số nhỏ mô phỏng phản xạ tự nhiên của con người.
  - **Gaussian Jitter**: Thêm độ trễ phụ trợ ngẫu nhiên xung quanh mốc **150ms** trước khi click hoặc focus vào phần tử.
- **Nhóm 2 (Phá vỡ bảo mật - TUYỆT ĐỐI CẤM)**:
  - Cấm can thiệp hoặc vô hiệu hóa các cơ chế phát hiện gian lận chủ động của website (như bypass kiểm tra camera trong thi cử trực tuyến, lách kiểm tra môi trường lockdown).

### 8.2 Xử Lý Dấu Vết Tầng Giao Thức CDP (CDP Fingerprint)
- Hạ tầng Chromium mặc định khi bật CDP sẽ tự động gắn cờ `navigator.webdriver = true` và làm lộ các biến nội bộ qua lệnh gọi `Runtime.enable`.
- **Giải pháp**: Tích hợp `CDPStealthAdapter` và `SitePolicyResolver`.
- Hệ thống tự động phân tích headers và cookies (`__cf_bm`, `cf-ray`, v.v.) để nhận diện các hệ thống phòng thủ doanh nghiệp (Cloudflare, DataDome, Akamai).
- Đối với các site thông thường, hệ thống giữ nguyên giao thức tiêu chuẩn để đạt tốc độ cao nhất. Khi site có điểm quan trọng `importance_score >= 0.8`, hệ thống tự động kích hoạt chế độ Stealth tầng sâu: Tẩy xóa `navigator.webdriver`, làm giả danh sách plugins và thông số WebGL trước khi trang load.

---

## 9. CHÍNH SÁCH SỬ DỤNG LLM (PHÂN BIỆT RẠCH RÒI 2 VAI TRÒ)

| Tiêu chí | Vai trò 1: Phục vụ Nghiệp Vụ | Vai trò 2: Tự Sửa Cấu Trúc |
|---|---|---|
| **Mục đích** | Hiểu hoặc sinh nội dung nghiệp vụ phục vụ đúng chức năng của Tool (ví dụ: đọc câu hỏi để chọn đáp án phù hợp, trích xuất ý chính bài báo). | Tìm lại selector mới, phân tích DOM khi website đổi layout hoặc gãy endpoint. |
| **Vị trí tồn tại** | Nằm trong Tool đã đóng gói thông qua action primitive `call_llm`. | **CHỈ tồn tại trong Tháp và Nhà máy**. Tuyệt đối KHÔNG BAO GIỜ có mặt trong Tool đóng gói. |
| **API Key sử dụng** | API Key riêng của người dùng cấu hình riêng cho Tool đó. | Sử dụng trực tiếp môi trường Agent/IDE của Antigravity, không yêu cầu key riêng từ Tool. |
| **Có mặt trong Production?** | Có thể có (nếu nghiệp vụ yêu cầu). | **CẤM TUYỆT ĐỐI**. |

---

## 10. GIAO DIỆN NGƯỜI DÙNG (3 LỚP ĐỒNG BỘ)

1. **Command Interface (Tương tác qua Agent MCP)**:
   - Giao tiếp ngôn ngữ tự nhiên thông qua bộ 10 công cụ MCP của DevBrowserTool kết hợp với `browser-mcp`.
   - Hiển thị trực tiếp bảng biểu bước kiểm thử, danh sách tham số hóa có thể chỉnh sửa trực tiếp.
2. **DevBrowser Studio & Live HUD (Webview trong Antigravity IDE / VS Code)**:
   - Giao diện 2 cột tích hợp sẵn trong IDE:
     - **Cột trái**: Trinh sát URL, quản lý Map, kích hoạt Demo Recorder với Status Bar cảnh báo.
     - **Cột phải**: Live Execution HUD với thanh tiến độ thời gian thực và thẻ màu phản ánh từng bước thực thi (Resolve $\rightarrow$ Act $\rightarrow$ Confirm).
3. **Web App Dashboard Server (Giao diện Web Độc Lập)**:
   - Máy chủ HTTP nội bộ bind cứng tại `127.0.0.1:3456`, bảo vệ bằng Session Token ngẫu nhiên chống tấn công DNS Rebinding và CSRF.
   - Trực quan hóa toàn bộ Resource Graph, State-Transition Graph, theo dõi độ trôi dạt revision của các Tool và cung cấp nút **1-Click Rebuild**.

---

## 11. TIẾN HÓA KIẾN TRÚC: CUỘC ĐẠI PHẪU SANG KIẾN TRÚC B (AGENT-DRIVEN MCP)

### 11.1 Giả Định Ban Đầu & Bài Học Thực Nghiệm Thất Bại
Trong thiết kế ban đầu (Kiến trúc A/C), dự án dự định để `WebAppServer` tự đóng vai trò một MCP Client kết nối trực tiếp vào `browser-mcp`, hoặc tự mở cổng Chrome DevTools Protocol (CDP) cổng 9222/9229 để điều khiển tab của trình duyệt người dùng.

Tuy nhiên, qua thực nghiệm kỹ thuật sâu (Spike test tại `scripts/spike-cdp-direct.ts`), chúng ta phát hiện **hai rào cản nền tảng không thể vượt qua**:
1. **Chrome thường ngày KHÔNG mở cổng Remote Debugging**: Google Chrome mặc định chặn toàn bộ cổng debug vì lý do bảo mật; 100% các cổng 9222, 9223, 9229 đều bị từ chối kết nối (`fetch failed`).
2. **Cơ chế Session Isolation của `browser-mcp`**: Công cụ `browser-mcp` của IDE tạo ra các Tab Group cô lập riêng cho từng phiên agent. Một tiến trình backend độc lập bên ngoài hoàn toàn không thể nhìn thấy hoặc chiếm quyền điều khiển các tab này.

### 11.2 Kiến Trúc B: Agent-Driven MCP (Lựa Chọn Tối Thượng)
Thay vì cố gắng biến backend thành người lái xe (driver), chúng ta đảo ngược mô hình:
- **Agent là Người Lái Xe (Driver)**: Agent sở hữu quyền điều khiển trình duyệt thông qua `browser-mcp` / `chrome-devtools` (điều hướng, click, thực thi JS trong tab hiện tại).
- **DevBrowserTool là Bộ Não & Nhà Máy (Brain & Factory)**: DevBrowserTool đóng vai trò MCP Server cung cấp trí tuệ cấu trúc:
  - Cung cấp các công thức trinh sát JavaScript an toàn (`ScoutScripts`).
  - Tiếp nhận và phân loại dữ liệu trinh sát thành 7 loại tài nguyên chuẩn (`ScoutProcessor` & `MapStore`).
  - Đề xuất chuỗi hành động ngữ nghĩa (`ActionCompiler.proposeActions`).
  - Biên dịch kịch bản thực thi hoàn chỉnh (`ActionCompiler.compileActions`).
  - Đóng gói xuất xưởng Tool hoàn chỉnh độc lập (`ToolFactory.build`).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENT (Antigravity IDE)                         │
│                                                                        │
│   ┌───────────────────────────┐      ┌─────────────────────────────┐   │
│   │ browser-mcp / devtools    │      │ devbrowsertool (MCP Bridge) │   │
│   │ (Điều khiển trình duyệt)  │      │ (Bộ não cấu trúc & Nhà máy) │   │
│   └─────────────┬─────────────┘      └──────────────┬──────────────┘   │
└─────────────────┼───────────────────────────────────┼──────────────────┘
                  │                                   │ stdio (JSON-RPC)
                  ▼                                   ▼
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│          GOOGLE CHROME           │  │          DEVBROWSERTOOL          │
│    (Tab người dùng đang duyệt)   │  │    (Core Engine & Web Server)    │
│                                  │  │                                  │
│ - Chạy Scout Recipes JS          │  │ - ScoutProcessor & MapStore      │
│ - Thực thi Dry-Run Scripts       │  │ - Action Compiler & Planner      │
│ - Tải Chrome Extension MV3       │  │ - Extension & Userscript Factory │
└──────────────────────────────────┘  └──────────────────────────────────┘
```

---

## 12. CHI TIẾT 10 CÔNG CỤ MCP CHO AGENT

DevBrowserTool cung cấp 10 công cụ chuẩn Model Context Protocol (MCP) thông qua tiến trình `packages/mcp-bridge/dist/index.js`, kết nối an toàn với máy chủ WebAppServer nội bộ:

### 1. `get_scout_scripts`
- **Mục đích**: Trả về các đoạn mã JavaScript thuần (recipes) để Agent tiêm vào tab trình duyệt nhằm thu thập dữ liệu cấu trúc.
- **Tham số**:
  - `categories` (array, tùy chọn): `["dom_interactive", "performance_timing", "local_storage", "websocket_sniffer"]`.
- **Đầu ra**: Mảng các đối tượng chứa `category` và mã `script` JavaScript hoàn chỉnh.

### 2. `ingest_scout_data`
- **Mục đích**: Tiếp nhận kết quả thô do Agent chạy script trên trang gửi về, tự động chuẩn hóa và lưu vào MapStore.
- **Tham số**:
  - `domain` (string, bắt buộc): Tên miền mục tiêu (ví dụ: `"httpbin.org"`).
  - `url` (string, bắt buộc): URL đầy đủ tại thời điểm trinh sát.
  - `raw_data` (object, bắt buộc): Dữ liệu chứa kết quả của các script trinh sát.
- **Đầu ra**: Thống kê số lượng node được tạo mới/cập nhật và `revision` hiện tại của Map.

### 3. `query_map`
- **Mục đích**: Truy vấn dữ liệu bản đồ cấu trúc đã tích lũy của một domain.
- **Tham số**:
  - `domain` (string, bắt buộc): Tên miền cần tra cứu.
  - `query_type` (enum): `"summary"` | `"nodes"` | `"endpoints"` | `"state_graph"`.
  - `intent_filter` (string, tùy chọn): Bộ lọc theo từ khóa ngữ nghĩa.
- **Đầu ra**: Cấu trúc dữ liệu chi tiết của Map phù hợp với bộ lọc.

### 4. `propose_actions`
- **Mục đích**: Phân tích ý định của người dùng và đề xuất danh sách các hành động tương tác phù hợp nhất.
- **Tham số**:
  - `domain` (string, bắt buộc): Tên miền mục tiêu.
  - `intent` (string, bắt buộc): Ý định tự động hóa (ví dụ: `"fill order form and submit"`).
  - `current_state` (string, tùy chọn): ID trạng thái hiện tại trên State Graph.
- **Đầu ra**: Danh sách các `ActionSpec` được sắp xếp theo độ ưu tiên logic.

### 5. `compile_actions`
- **Mục đích**: Biên dịch danh sách hành động thành các đoạn script JavaScript thực thi hoàn chỉnh có sẵn 5-tier fallback locators, Bézier mouse và Gaussian jitter.
- **Tham số**:
  - `domain` (string, bắt buộc): Tên miền mục tiêu.
  - `actions` (array, bắt buộc): Danh sách `ActionSpec` cần biên dịch.
  - `stealth_level` (enum): `"none"` | `"standard"` | `"high"`.
- **Đầu ra**: Đoạn mã JavaScript độc lập sẵn sàng thực thi trực tiếp trên trang.

### 6. `get_execution_scripts`
- **Mục đích**: Trả về kịch bản thực thi từng bước phục vụ giai đoạn Dry-Run kiểm chứng trước khi xuất bản.
- **Tham số**:
  - `tool_name` (string, bắt buộc): Tên công cụ đang thử nghiệm.
  - `step_index` (number, tùy chọn): Chỉ số bước cụ thể cần lấy script.
- **Đầu ra**: Script của bước tương ứng kèm điều kiện kiểm chứng xác nhận.

### 7. `ingest_execution_result`
- **Mục đích**: Tiếp nhận kết quả phản hồi của bước Dry-Run từ Agent để đánh giá độ ổn định và cập nhật confidence của các node.
- **Tham số**:
  - `tool_name` (string, bắt buộc): Tên công cụ.
  - `step_index` (number, bắt buộc): Bước vừa thực hiện.
  - `success` (boolean, bắt buộc): Kết quả thực thi.
  - `details` (object, tùy chọn): Thông tin lỗi hoặc kết quả DOM trả về.
- **Đầu ra**: Đánh giá bước tiếp theo (tiếp tục, thử fallback hay dừng lại).

### 8. `build_tool`
- **Mục đích**: Đóng gói sản phẩm hoàn chỉnh và xuất xưởng ra đĩa cứng tại thư mục `~/.devbrowsertool/tools/<tool_name>`.
- **Tham số**:
  - `domain` (string, bắt buộc): Tên miền.
  - `tool_name` (string, bắt buộc): Tên công cụ (ví dụ: `"httpbin_order_tool"`).
  - `tool_type` (enum): `"chrome_extension"` | `"userscript"` | `"advisor_overlay"`.
  - `actions` (array, tùy chọn): Danh sách hành động (nếu bỏ trống sẽ lấy từ kịch bản đã biên dịch).
  - `input_params` (object, tùy chọn): Định nghĩa các tham số đầu vào.
- **Đầu ra**: Đường dẫn thư mục chứa artifact hoàn chỉnh và hướng dẫn nạp vào Chrome.

### 9. `list_tools`
- **Mục đích**: Liệt kê toàn bộ các công cụ đã được sản xuất cùng trạng thái sức khỏe và độ lệch phiên bản (drift status).
- **Tham số**: Không yêu cầu tham số.
- **Đầu ra**: Danh sách các công cụ, loại đóng gói, ngày tạo, phiên bản Map và trạng thái (`healthy`, `drift_detected`, `tripped`).

### 10. `locate_element`
- **Mục đích**: Hỗ trợ Agent tìm kiếm nhanh selector tối ưu cho một phần tử cụ thể dựa trên tri thức đã có trong Map.
- **Tham số**:
  - `domain` (string, bắt buộc): Tên miền.
  - `intent_or_text` (string, bắt buộc): Nhãn chữ hoặc mô tả vai trò của phần tử.
- **Đầu ra**: Danh sách selector xếp theo thứ tự độ tin cậy từ cao xuống thấp.

---

## 13. RANH GIỚI TIN CẬY (TRUST BOUNDARY) & CÁC BÀI HỌC KỸ THUẬT THỰC CHIẾN

### 13.1 Ranh Giới Tin Cậy: Mô Hình Agent-In-The-Loop
- Trong Kiến trúc B, công cụ `ingest_scout_data` hoàn toàn tin tưởng dữ liệu do Agent cung cấp. Backend DevBrowserTool KHÔNG tự thực hiện kết nối mạng độc lập để kiểm chứng xem dữ liệu đó có bị giả mạo hay không.
- **Lý do thiết kế**: DevBrowserTool là công cụ cá nhân nội bộ phục vụ cặp đôi Developer/Agent trên máy trạm cá nhân, không phải dịch vụ SaaS nhiều người dùng (multi-tenant). Ranh giới an toàn nằm ở chính phiên làm việc được người dùng kiểm soát trong IDE.

### 13.2 Giải Quyết Triệt Để Lỗi CSP Violation Trong Chrome Extension MV3
- **Vấn đề phát sinh thực tế**: Trong kịch bản kiểm thử E2E trên trình duyệt Google Chrome thật, khi Chrome Extension MV3 được nạp vào, cơ chế Content Security Policy (`script-src 'self'`) lập tức chặn đứng và ném lỗi nghiêm trọng nếu trong code có sử dụng `eval()` hoặc `new Function()` để thực thi selector động.
- **Giải pháp dứt điểm (`packages/core/src/packager/templates.ts`)**:
  - Loại bỏ hoàn toàn `eval()` và `new Function()`.
  - Thiết kế thuật toán `resolveSelector(selector)` thuần DOM:
    1. Tự động bóc tách (unwrap) các chuỗi selector dạng `document.querySelector("...")` bằng biểu thức chính quy an toàn.
    2. Tự động nhận diện và phân tích cú pháp pseudo-selector không chuẩn `:has-text("...")` bằng cách duyệt cây DOM và kiểm tra `textContent.includes(...)` thuần túy.
    3. Kết quả: 100% tuân thủ chính sách bảo mật khắt khe nhất của Chrome MV3 mà vẫn hỗ trợ đầy đủ các bộ chọn phức tạp.

### 13.3 Xử Lý Tham Số Hóa An Toàn (Safe Parameterization vs. Dry-Run)
- **Vấn đề phát sinh thực tế**: Khi kiểm thử Dry-run, hệ thống cần giá trị thật (ví dụ tên `"Alice Walker"`) để điền form thử nghiệm. Tuy nhiên, nếu thay thế trực tiếp vào kịch bản thì artifact xuất xưởng sẽ bị "chết cứng" giá trị đó, làm mất tính năng điền form tự động linh hoạt cho người dùng khác.
- **Giải pháp dứt điểm (`packages/core/src/factory/builder.ts`)**:
  - **Tách biệt 2 luồng dữ liệu**:
    - Luồng Dry-Run: Tạo một bản sao tạm thời của các action và nội suy giá trị thật để chạy thử trên trình duyệt.
    - Luồng Xuất Xưởng (Production Artifact): Giữ nguyên vẹn các biến giữ chỗ dạng `{{custname}}`, `{{custtel}}` trong mã nguồn đóng gói.
  - Cơ chế Runtime trong `content.js`: Tự động tìm kiếm tham số thông qua hàm `resolveParamValue(rawVal)`: Ưu tiên giá trị do người dùng truyền vào lúc click extension $\rightarrow$ nếu không có thì lấy `default_value` đã khai báo $\rightarrow$ nếu không có thì giữ nguyên chuỗi.

---

## 14. BẢNG THAM SỐ KỸ THUẬT ĐÃ CHỐT

Toàn bộ các giá trị sau đây là số liệu CHÍNH THỨC, bắt buộc tuân thủ trong toàn bộ mã nguồn:

### 14.1 Độ Tin Cậy & Khớp Mờ (Confidence & Fuzzy Match)
- Ngưỡng tin cậy cao để ưu tiên biến thể: **0.85**
- Ngưỡng tương đồng tối thiểu cho Tier 4 Fuzzy Local-Heal: **0.85**

### 14.2 Thời Gian Sống (Time-To-Live - TTL)
- Node khám phá thông thường (`discovered_via: "normal"`): **30 ngày** kể từ `last_verified`.
- Node khám phá qua Thoát Hiểm (`discovered_via: "escape_hatch"`): **7 ngày**.
- Khi hết hạn TTL, node không bị xóa ngay mà bị hạ mức ưu tiên dần theo thuật toán time-decay.

### 14.3 Ngưỡng Kích Hoạt Circuit Breaker
- Số lần thất bại liên tiếp để kích hoạt: **$\ge 5$ lần thất bại trong khung thời gian 10 phút**.
- Bắt buộc kiểm tra loại trừ lỗi mất session trước khi kích hoạt.

### 14.4 Ngân Sách Khám Phá Bổ Sung (Chủ Động Trong Lúc Build)
- Giới hạn tối đa cho mỗi mục tiêu: **10 tool calls HOẶC ~5.000 tokens**.
- Không áp dụng giới hạn cho việc thu thập thụ động (dữ liệu tình cờ bắt được qua log mạng).

### 14.5 Giới Hạn Biến Thể
- Số lượng `Variant` tối đa được lưu trên mỗi `ResourceNode`: **5 biến thể**.

### 14.6 Thông Số Ổn Định Ứng Dụng Cộng Tác / CRDT
- Số lần đọc liên tiếp phải có cùng kết quả: **3 lần**.
- Khoảng cách giữa các lần đọc: **50ms**.
- Timeout tối đa: **1.000ms (1 giây)**.

### 14.7 Thông Số Nhận Diện Anti-Debug
- Số vòng lặp hiệu chuẩn baseline động: **3 vòng**.
- Tỷ lệ chênh lệch thời gian thực thi bất thường so với baseline: **$\ge 5.0$ lần**.
- Số lần phát hiện câu lệnh debugger lặp lại liên tiếp: **$\ge 3$ lần**.
- Kích thước tối đa của file `.js.map` được giải mã trong bộ nhớ: **10 MB (10.485.760 bytes)**.
- Số bước điều hướng khứ hồi tối đa cho chuỗi SSO/OAuth: **5 bước**.

### 14.8 Thông Số Stealth & Human Emulation
- Ngưỡng điểm quan trọng để kích hoạt Stealth Driver: **`importance_score >= 0.8`**.
- Khoảng thời gian trễ giữa các phím gõ ngẫu nhiên: **50ms – 240ms**.
- Độ trễ cơ sở Gaussian Jitter: **150ms**.
- Số bước nội suy đường cong di chuyển chuột Cubic Bézier: **20 bước**.
- Độ lệch điểm số giữa Heuristic và User để kích hoạt tự học trọng số: **$\ge 0.25$ qua $\ge 3$ lần liên tiếp**.
- Cổng kết nối mặc định của Web App Server: **3456** (bind cứng `127.0.0.1`).

---

## 15. KIẾN TRÚC MÃ NGUỒN & CẤU TRÚC MONOREPO

Dự án được xây dựng dưới dạng Monorepo chuẩn mực, 100% sử dụng **TypeScript (Node.js)** và tuân thủ nguyên tắc không trộn lẫn ngôn ngữ trong lõi:

```text
DevBrowserTool/
├── .agents/
│   ├── mcp_config.json                 # Cấu hình nạp MCP Server vào Antigravity IDE
│   └── skills/
│       └── devbrowsertool/             # Skill hướng dẫn Agent-Driven workflow (SKILL.md)
│
├── packages/
│   ├── core/                           # @devbrowsertool/core: Thư viện lõi độc lập
│   │   ├── src/
│   │   │   ├── actions/                # 5-tier locators, Bézier mouse, Stealth adapter
│   │   │   ├── discovery/              # Scout scripts, ScoutProcessor, SourceMap, Anti-debug
│   │   │   ├── engine/                 # 5-step loop (ExecutionEngine), CircuitBreaker
│   │   │   ├── factory/                # Planner, ActionCompiler, Builder (ToolFactory)
│   │   │   ├── map/                    # MapStore, AccountScoping, ImportanceEvaluator
│   │   │   └── packager/               # Chrome MV3, Userscript, Advisor HUD Packagers
│   │   └── tests/                      # 20 test files, 200 unit tests (pass 100%)
│   │
│   ├── ui/                             # devbrowsertool-ui: VS Code Extension & Web App
│   │   ├── devbrowsertool-ui-0.1.0.vsix # Gói cài đặt Extension cho IDE
│   │   └── src/
│   │       ├── extension.ts            # Điểm kích hoạt VS Code Extension
│   │       ├── status-bar.ts           # Đèn cảnh báo ghi hình (Red Recording Status Bar)
│   │       ├── web-server.ts           # WebAppServer (Port 3456) & 10 REST endpoints (/api/mcp/*)
│   │       └── views/                  # Studio 2 cột, Map Viewer & Tool Dashboard
│   │
│   ├── mcp-bridge/                     # @devbrowsertool/mcp-bridge: Cầu nối MCP chuẩn
│   │   ├── src/index.ts                # Khai báo 10 MCP Tools kết nối stdio với Agent
│   │   └── package.json
│   │
│   └── cli/                            # @devbrowsertool/cli: Giao diện dòng lệnh
│       ├── bin/devbrowsertool.js       # Entry point CLI
│       └── src/index.ts                # Các lệnh: ui, list, inspect, build
│
├── scripts/
│   ├── agent-e2e-openfront.ts          # Kịch bản kiểm thử E2E quy trình Agent trên Chrome thật
│   └── live-e2e-demo.ts                # Kịch bản kiểm thử trực tiếp Playwright
├── DevBrowserTool.md                   # Tài liệu đặc tả kỹ thuật này
└── README.md                           # Hướng dẫn mở đầu & khởi động nhanh
```

---

## 16. BẢNG THUẬT NGỮ CHÍNH THỨC

| Thuật ngữ | Định nghĩa kỹ thuật |
|---|---|
| **Tháp** *(Discovery Engine)* | Thành phần thu thập, phân tích, xây dựng và duy trì bản đồ tri thức cấu trúc website. Có sử dụng LLM ở tầng Agent. |
| **Nhà máy** *(Tool Factory)* | Thành phần biên dịch mục tiêu của người dùng và Map thành Tool hoàn chỉnh. Có sử dụng LLM ở tầng Agent. |
| **Tool** *(Artifact)* | Sản phẩm đầu ra độc lập (Chrome Extension, Userscript, Advisor HUD), thực thi tác vụ cụ thể, **không có LLM tự sửa cấu trúc**. |
| **Map** | Cơ sở tri thức cục bộ gồm Resource Graph (7 loại tài nguyên) và State-Transition Graph của một domain. |
| **Resource Graph** | Đồ thị lưu trữ các node tài nguyên: DOM, API endpoint, WebSocket, Storage, Schemas. |
| **State-Transition Graph** | Đồ thị mô tả các trạng thái màn hình (SPA) và các hành động chuyển trạng thái kèm điều kiện tiên quyết. |
| **Variant** | Một biến thể định vị hoặc trích xuất cụ thể của một node (mỗi node tối đa 5 variants). |
| **value_formula** | Công thức định vị hoặc tính toán giá trị (không lưu dữ liệu thô). |
| **Elevated Action** | Hành động có rủi ro bảo mật (truy cập Closed Shadow DOM, hook runtime) nhưng có thể tự động hóa sau khi xin phép người dùng. |
| **Hardware-Bound Action** | Hành động gắn chặt với phần cứng bảo mật (Passkey/WebAuthn), tuyệt đối không thể tự động hóa, luôn cần con người thao tác vật lý. |
| **Escape Hatch** | Chế độ khẩn cấp trong Tháp cấp quyền tự do cho Agent tìm cách tương tác khi toàn bộ 5 tier định vị đều gãy. |
| **Circuit Breaker** | Cơ chế ngắt mạch an toàn: Đếm số lần thất bại liên tiếp trong khung thời gian trượt để tạm dừng hoạt động và báo người dùng. |
| **Account Slot** | Vùng lưu trữ riêng biệt của một tài khoản trong Map, định danh bằng SHA-256 hash có tính xác định. |
| **Site Bundle** | Nhóm liên kết nhiều domain liên quan trong cùng một chuỗi nghiệp vụ (ví dụ quy trình đăng nhập SSO/OAuth). |
| **Kiến trúc B (Agent-Driven)** | Mô hình vận hành nơi Agent làm người điều khiển trình duyệt, còn DevBrowserTool đóng vai trò MCP Server cung cấp trí tuệ và sản xuất Tool. |

---

## 17. QUY TRÌNH VẬN HÀNH THỰC TẾ A-Z (END-TO-END WORKFLOW)

Quy trình chuẩn mực khi người dùng yêu cầu Agent tự động hóa một trang web mới:

```
[Người dùng yêu cầu tạo Tool cho URL]
                 │
                 ▼
[Bước 1: Agent mở URL bằng browser-mcp / chrome-devtools]
                 │
                 ▼
[Bước 2: Agent gọi devbrowsertool.get_scout_scripts()]
                 │
                 ▼
[Bước 3: Agent chạy script trên trang qua browser_execute_script()]
                 │
                 ▼
[Bước 4: Agent gửi dữ liệu về qua devbrowsertool.ingest_scout_data()]
                 │  (ScoutProcessor phân tích 7 loại tài nguyên & lưu Map)
                 ▼
[Bước 5: Agent gọi devbrowsertool.propose_actions(domain, intent)]
                 │  (Nhận danh sách hành động đề xuất, LLM tinh chỉnh logic)
                 ▼
[Bước 6: Agent gọi devbrowsertool.compile_actions(actions)]
                 │  (Nhận mã JavaScript 5-tier & Bézier mouse)
                 ▼
[Bước 7: Agent chạy thử kiểm chứng Dry-Run trên tab thật]
                 │  (ingest_execution_result đánh giá xác thực)
                 ▼
[Bước 8: Agent gọi devbrowsertool.build_tool(domain, tool_name, type)]
                 │
                 ▼
[Tool xuất xưởng tại ~/.devbrowsertool/tools/<name>]
                 │
                 ▼
[Người dùng nạp vào Chrome qua chrome://extensions và sử dụng độc lập]
```

### 17.1 Kiểm Chứng Thực Tế Trên Web Thật (Real-World Verification)
Hệ thống đã được kiểm chứng độc lập trên hai môi trường web thật:
1. **Kiểm chứng phát hiện Anti-Bot trên `https://openfront.io/`**:
   - Khi gặp thử thách Cloudflare Turnstile/CAPTCHA (HTTP 403, tiêu đề `"Just a moment..."`), `SitePolicyResolver` nhận diện chính xác chữ ký `cf-ray` và `challenges.cloudflare.com`.
   - Hệ thống lập tức dừng lại, từ chối tấn công mù quáng và chuyển sang xin Demo người dùng theo đúng chuẩn mực Mục 8.1 & 3.2.
2. **Kiểm chứng chu trình A-Z trên `https://httpbin.org/forms/post`**:
   - Tự động trinh sát 13 interactive elements qua `get_scout_scripts` và `ingest_scout_data`.
   - Tham số hóa an toàn các trường `custname`, `custtel`, `comments`.
   - Biên dịch và đóng gói thành công Chrome Extension MV3 tuân thủ CSP 100%.
   - Chạy kiểm thử thành công trên Google Chrome thật, máy chủ `httpbin.org/post` phản hồi mã 200 xác nhận đã nhận trọn vẹn dữ liệu.

---

## 18. QUY TRÌNH BẢO TRÌ & NÂNG CẤP TOOL (DRIFT DETECTION & REBUILD)

1. **Phát Hiện Trôi Dạt (Drift Detection)**:
   - Khi website thay đổi giao diện, Tháp tiến hành trinh sát lại và tăng `content_revision` của Map.
   - Giao diện Web App Dashboard và VS Code Extension tự động đánh dấu các Tool cũ bằng trạng thái cảnh báo màu vàng: `drift_detected` (Tool đang dùng revision cũ hơn bản đồ hiện tại).
2. **Tái Đóng Gói Một Chạm (1-Click Rebuild)**:
   - Người dùng bấm nút **"Rebuild Tool"** trên Dashboard hoặc Agent gọi lại `build_tool`.
   - Nhà máy tự động đọc Map mới nhất, biên dịch lại chuỗi hành động và ghi đè bản build mới vào thư mục Tool.
   - Với Userscript: Người dùng nhận bản vá tự động qua `@updateURL`.
   - Với Chrome Extension: Người dùng chỉ cần bấm nút Reload biểu tượng mũi tên xoay tròn trên trang `chrome://extensions`.
