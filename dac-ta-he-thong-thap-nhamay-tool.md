# ĐẶC TẢ KỸ THUẬT: HỆ THỐNG AGENT TƯƠNG TÁC WEB & SINH CÔNG CỤ TỰ ĐỘNG

**Phiên bản tài liệu:** 1.0
**Trạng thái:** Đặc tả thiết kế (chưa triển khai)

## 0. QUY ƯỚC ĐỌC TÀI LIỆU (BẮT BUỘC ĐỌC TRƯỚC)

Tài liệu này dùng ngôn ngữ chuẩn tắc để loại bỏ mơ hồ khi được agent/LLM đọc và thực thi theo:

- **PHẢI / BẮT BUỘC**: hành vi bắt buộc, không có ngoại lệ trừ khi tài liệu nêu rõ ngoại lệ.
- **KHÔNG ĐƯỢC / TUYỆT ĐỐI KHÔNG**: cấm tuyệt đối, không có ngoại lệ.
- **NÊN**: khuyến nghị mặc định, có thể lệch nếu có lý do ghi lại rõ ràng.
- **CÓ THỂ**: tuỳ chọn, không bắt buộc.
- Khi tài liệu nêu "X hay Y" mà không nói rõ ưu tiên, đây LÀ LỖI của tài liệu — không được tự suy diễn, phải dừng lại và hỏi người dùng.
- Mọi thuật ngữ viết hoa có định nghĩa chính thức tại Mục 17 (Bảng thuật ngữ). Nếu 1 từ viết hoa xuất hiện mà không có trong Mục 17, đây LÀ LỖI của tài liệu.
- Không suy diễn hành vi từ "tinh thần chung" của tài liệu nếu có mục cụ thể mô tả khác — mục cụ thể luôn thắng mô tả tổng quát.

---

## 1. TỔNG QUAN HỆ THỐNG

### 1.1 Mục tiêu
Xây dựng hệ thống cho phép AI Agent tương tác với trình duyệt/website để (a) tích luỹ tri thức về cấu trúc và cách vận hành của website theo thời gian, và (b) từ tri thức đó, sinh ra các Tool độc lập, đáng tin cậy, tự động hoá 1 tác vụ cụ thể trên website đó cho người dùng cuối.

### 1.2 Ba thành phần cốt lõi (KHÔNG được gộp lẫn vai trò)

| Thành phần | Có LLM? | Vai trò | Vòng đời |
|---|---|---|---|
| **Tháp** (Discovery Engine) | Có | Khám phá, quan sát, xây và duy trì Map | Chạy liên tục/theo yêu cầu, tích luỹ tri thức lâu dài |
| **Nhà máy** (Factory/Compiler) | Có | Biên dịch (mục tiêu người dùng + Map) → Tool hoàn chỉnh | Chạy 1 lần mỗi khi tạo/cập nhật 1 Tool |
| **Tool** | Mặc định KHÔNG. CÓ THỂ có LLM CHỈ khi phục vụ đúng mục đích nghiệp vụ của chính Tool đó (xem Mục 9) | Thực thi tác vụ đã biên dịch sẵn, không tự sửa cấu trúc thao tác của chính nó | Chạy độc lập, lâu dài, không cần Tháp/Nhà máy đứng sau giám sát |

**Nguyên tắc bất biến**: Tool KHÔNG BAO GIỜ tự ý khám phá lại cấu trúc website hay tự sửa selector/endpoint của chính nó bằng LLM. Mọi khả năng "tự sửa cấu trúc" CHỈ tồn tại ở Tháp và Nhà máy. Khi Tool gặp lỗi vượt quá khả năng xử lý cục bộ của nó (xem Mục 8.5), nó PHẢI dừng lại và ghi log có cấu trúc, KHÔNG ĐƯỢC tự suy luận cách sửa.

---

## 2. NGUYÊN TẮC NỀN TẢNG (áp dụng xuyên suốt mọi thành phần)

1. **Lưu trữ chỉ local**, không đồng bộ/chia sẻ lên máy chủ chung hay giữa người dùng khác nhau. Chỉ Map (không phải Tool) CÓ THỂ được xuất/nhập thủ công giữa các máy của cùng 1 người dùng.
2. **Tool không có LLM tự sửa cấu trúc** (xem Mục 1.2, Mục 9).
3. **Anti-detection CHỈ hỗ trợ Nhóm 1** (giảm dấu hiệu hành vi máy móc: throttle ngẫu nhiên, giả lập hành vi phụ trợ tự nhiên). **TUYỆT ĐỐI KHÔNG hỗ trợ Nhóm 2** (chủ động vô hiệu hoá cơ chế phòng thủ/khoá mà chính website dựng lên để chống gian lận/tự động hoá — ví dụ browser-lock trong thi cử). Định nghĩa đầy đủ 2 nhóm tại Mục 10.
4. **Không lưu giá trị runtime**, chỉ lưu công thức lấy giá trị (value_formula) trong Map, TRỪ khi giá trị đó chính là mục tiêu output của hành động `call_llm` thuộc Vai trò 1 (Mục 9) — trường hợp đó không thuộc phạm vi Map, nằm ngoài phạm vi đặc tả này.
5. Mọi quyết định "khó xử" (site đổi hoàn toàn, hành động không demo tay được, hành động chạm phần cứng bảo mật...) đều PHẢI dẫn tới 1 trong 2 kết quả: dừng lại bàn giao người dùng, HOẶC quay lại Tháp để tái khám phá — KHÔNG BAO GIỜ dẫn tới Tool tự "đoán" và tiếp tục chạy im lặng.

---

## 3. THÁP — ĐẶC TẢ CHI TIẾT

### 3.1 Quy trình khám phá 1 hành động cụ thể

1. **Kiểm tra source có sẵn trước tiên** (rẻ nhất, chính xác nhất): kiểm tra repo mã nguồn mở công khai của site (nếu có), file `.js.map` lộ ra cạnh bundle JS (giải mã bằng VLQ, dựng lại cây project), bundle chưa bị minify nặng. Nếu tìm được → trích xuất trực tiếp, BỎ QUA các bước dò mù bên dưới cho phần đã lộ source.
2. Nếu không có source lộ ra → vào **quy trình khám phá thông thường** (agent tự thử).
3. Agent PHẢI thử tối đa **3 lần** cho cùng 1 mục tiêu con (ví dụ tìm đúng định dạng 1 API). Vượt quá 3 lần thất bại liên tiếp → chuyển sang xin người dùng demo (Mục 3.2).
4. Danh sách hành động sau đây PHẢI luôn xin demo/xác nhận người dùng NGAY TỪ ĐẦU, KHÔNG được tự thử trước dù chưa vượt ngưỡng 3 lần: đăng nhập OAuth, nhập mật khẩu/thông tin nhạy cảm, hành động khó hoàn tác (submit/xoá/thanh toán), mọi hành động thuộc loại `elevated` (Mục 6.2), mọi node loại `hardware_bound` (Mục 6.2).
5. Trước khi ghi 1 node vào Map là "ổn định": PHẢI quan sát tối thiểu 2-3 lần độc lập (không cùng 1 lần request). Mẫu quan sát trong lúc site đang lỗi tạm thời (HTTP 5xx, rate-limit, mất mạng) PHẢI bị loại trừ, KHÔNG được tính vào số lần quan sát.
6. Nếu 2-3 lần quan sát cho ra **kết quả khác nhau** (không phải do lỗi tạm thời) → đây LÀ bằng chứng có nhiều biến thể (A/B test, personalization), PHẢI ghi thành nhiều `Variant` trong cùng 1 node, KHÔNG được chọn 1 biến thể rồi bỏ biến thể còn lại.

### 3.2 Cơ chế xin demo người dùng

- Khi kích hoạt, PHẢI hiển thị tín hiệu rõ ràng cho người dùng biết đang ở "chế độ ghi" (ví dụ đổi màu viền tab/icon trạng thái). KHÔNG ĐƯỢC ghi nền im lặng.
- Ngoài lúc được mở khoá để demo, người dùng KHÔNG được thao tác gì khác trên tab đang khám phá (tránh nhiễu dữ liệu quan sát — race condition giữa agent và người dùng).
- Với nhóm hành động phi-UI (`call_api` thuần, `patch_runtime`) — người dùng KHÔNG THỂ demo bằng tay theo cách thông thường. Trường hợp này, hệ thống PHẢI hiển thị log/request cụ thể cho người dùng xem và xin xác nhận bằng lựa chọn (đồng ý/từ chối), KHÔNG được yêu cầu người dùng "tự làm giúp".

### 3.3 Cấu trúc Map (2 lớp)

- **Resource Graph**: các đơn vị tài nguyên tĩnh hơn — endpoint API, vùng DOM có ý nghĩa (theo intent/role, KHÔNG theo selector thô), header signature, binary schema (Protobuf/Wasm boundary), local persistence (IndexedDB/Cache Storage), websocket channel, node hardware_bound.
- **State-Transition Graph**: các trạng thái của trang/app + hành động chuyển trạng thái + điều kiện tiên quyết (precondition) của mỗi transition.
- Khoá định danh của mỗi node PHẢI theo **intent/vai trò ngữ nghĩa** (ví dụ "nút Thích bài viết"), KHÔNG được khoá theo selector CSS/class do build tool tự sinh (dễ đổi).
- Khoá trạng thái trong SPA: tổ hợp (URL nếu có đổi + fingerprint cấu trúc DOM chính + route ảo nếu bắt được qua `pushState`). KHÔNG được dùng URL đơn lẻ làm khoá duy nhất.

### 3.4 Quy trình chẩn đoán chọn kênh thu thập dữ liệu (PHẢI thực hiện theo đúng thứ tự sau, dừng ở bước đầu tiên phù hợp)

1. Kiểm tra dữ liệu mục tiêu có bị mã hoá phía client trước khi truyền không (tìm lời gọi Web Crypto API, hoặc payload network là ciphertext vô nghĩa dù đã decode). NẾU CÓ → thu thập tại boundary mã hoá/giải mã, hoặc tại DOM sau khi đã render giải mã. DỪNG.
2. NẾU KHÔNG mã hoá VÀ site có kênh WebSocket thời gian thực đang hoạt động → ưu tiên đọc state qua WebSocket, DOM/canvas chỉ dùng để gửi input, KHÔNG dùng để đọc lại state nếu WebSocket đã đủ. DỪNG.
3. NẾU KHÔNG có WebSocket, kiểm tra Service Worker/Cache Storage/IndexedDB (`local_persistence`) trước khi kết luận "không tìm thấy API nào". DỪNG nếu tìm thấy.
4. NẾU logic nằm trong WebAssembly → CHỈ hook tại boundary JS↔Wasm (input/output của lời gọi hàm), TUYỆT ĐỐI KHÔNG cố đọc/hiểu logic bên trong module Wasm.
5. Trường hợp còn lại → dùng DOM/API thông thường theo tier tại Mục 6.1.

### 3.5 Chế độ khám phá sâu (6 bước) — chỉ kích hoạt khi site vượt quá khả năng khám phá thông thường (obfuscated nặng, dùng binary protocol không rõ schema)

Thứ tự: **Observe → Hook (ưu tiên) → Breakpoint (chỉ dùng khi hết cách khác) → Rebuild → Patch → Pure-extraction**.

- PHẢI kiểm tra dấu hiệu site có cơ chế anti-debug (debugger-statement lặp, đo thời gian thực thi để phát hiện breakpoint) TRƯỚC KHI bắt đầu Hook/Breakpoint mạnh tay. Nếu phát hiện anti-debug mạnh → xử lý thận trọng như site có độ nhạy cảm cao (Mục 3.7), cân nhắc dừng thay vì cố vượt qua.
- NÊN tích hợp/gọi các MCP chuyên biệt reverse-engineering có sẵn (loại công cụ như jsreverser-mcp, jshookmcp) làm backend kỹ thuật, KHÔNG bắt buộc tự viết lại toàn bộ từ đầu.
- Với site dùng Protobuf/binary không rõ định dạng: bắt vài frame mẫu → dùng LLM (1 lần, thuộc Tháp) đọc code JS liên quan để suy ngược cấu trúc → lưu thành node `binary_schema` → từ đó decode message thực tế thuần thuật toán, KHÔNG cần LLM nữa.

### 3.6 Chế độ thoát hiểm (Escape Hatch)

- **Điều kiện kích hoạt**: toàn bộ tier định vị đã biết (Mục 6.1) đều thất bại LIÊN TỤC, VÀ đã loại trừ được 2 nguyên nhân: mất phiên đăng nhập (kiểm tra trạng thái login trước) và site lỗi tạm thời.
- **Bước 1**: cấp quyền LLM thao tác CDP tự do (không ép theo action/node-type đã định nghĩa) với mục tiêu duy nhất là tìm ra cách quan sát/tương tác hoạt động được.
- **Bước 2**: khi tìm được cách hoạt động, PHẢI quyết định: đây là biến thể mới của node-type đã biết, hay cần node-type hoàn toàn mới? Chỉ chính thức hoá thành node-type mới trong schema chung khi đã gặp hiện tượng tương tự ở **≥2 domain khác nhau**. Nếu chỉ 1 lần → ghi nhận là biến thể đặc thù riêng của domain đó.
- **Bước 3**: node tạo ra từ thoát hiểm PHẢI gắn cờ `discovered_via: escape_hatch`, có TTL ngắn hơn node thông thường, và khi Tool dùng tới node này, PHẢI ưu tiên bàn giao người dùng sớm hơn thay vì thử nhiều biến thể.
- Chế độ này CHỈ tồn tại trong Tháp, KHÔNG BAO GIỜ xuất hiện trong Tool.
- Nếu bước 1 chạm tới closed shadow root hoặc hành động `patch_runtime` → VẪN PHẢI qua đúng cơ chế xác nhận elevated (Mục 6.2), không được bỏ qua vì đang ở "chế độ thoát hiểm".
- Có giới hạn ngân sách riêng (số lượt thử tối đa), không được chạy vô hạn.

### 3.7 Phân loại mức độ quan trọng của site

- Cơ chế: mặc định tự động (heuristic dựa trên tín hiệu: có form thanh toán, có OAuth, có nhập thông tin cá nhân, tần suất truy cập...), người dùng CÓ THỂ điều chỉnh điểm số (không phải chọn nhị phân), kèm lý do.
- Nếu heuristic và điều chỉnh của người dùng lệch nhau nhiều lần liên tiếp cho cùng 1 domain → hệ thống PHẢI tự điều chỉnh lại trọng số heuristic cho domain đó.
- Site có điểm quan trọng cao hơn → ngưỡng confidence yêu cầu cao hơn, tần suất re-verify dày hơn, mức độ anti-detection Nhóm 1 áp dụng mạnh hơn.

### 3.8 Circuit Breaker cấp domain (trong Tháp, khi khám phá)

- Nếu tỷ lệ node fail vượt ngưỡng trong thời gian ngắn → PHẢI đánh dấu toàn bộ map của domain đó là "nghi ngờ", kích hoạt tái khám phá diện rộng, KHÔNG xử lý fail từng node lẻ tẻ.
- TRƯỚC KHI kích hoạt circuit breaker, PHẢI kiểm tra và loại trừ khả năng mất phiên đăng nhập (session/cookie hết hạn, redirect về trang login) — nếu là mất phiên, chỉ cần yêu cầu đăng nhập lại, KHÔNG kích hoạt circuit breaker.

### 3.9 Account-scoping

- Map gồm `base_nodes` (dùng chung mọi tài khoản trên domain) + `account_slots` (mỗi slot là 1 hash định danh nội bộ của tài khoản, KHÔNG dùng email/userId thật làm khoá).
- Account hash PHẢI có tính xác định (deterministic) dựa trên bộ ba (domain, normalized identifier, namespaceTag cố định) — TUYỆT ĐỐI KHÔNG dùng salt ngẫu nhiên/theo-phiên vì sẽ phá vỡ tính xác định cần thiết cho Multi-agent merge (Mục 3.10).
- 1 node/variant chỉ được "thăng cấp" từ delta (riêng 1 account) lên base (dùng chung) khi đã quan sát giống hệt nhau ở **≥2 account khác nhau**.
- Phát hiện đổi tài khoản: khi userId nội bộ trích xuất được khác với slot hiện tại → tạo slot mới, base map vẫn dùng lại ngay không cần verify lại.

### 3.10 Multi-agent/multi-session

- Mỗi agent/session khám phá PHẢI dùng 1 tab/session cô lập riêng, không chia sẻ tab với agent khác hoặc với thao tác tay của người dùng cùng lúc.
- Merge kết quả giữa các agent: tự động merge phần không mâu thuẫn. Phần mâu thuẫn → PHẢI gộp thành nhiều `Variant` (không được tự chọn 1 bên đúng rồi xoá bên kia). Việc loại bỏ 1 variant yếu chỉ được thực hiện qua cơ chế TTL/fail-rate tự nhiên (Mục 3.11), KHÔNG qua thuật toán "chọn người thắng" ngay lúc merge.
- Merge PHẢI xác định đúng account-slot tương ứng của từng bên trước khi merge, không được merge "mù" gây lẫn dữ liệu delta của 1 account vào base map dùng chung.

### 3.11 Vòng đời Variant (chống phình to)

- Mỗi node có số lượng `Variant` tối đa = **5** (giá trị chốt, xem Mục 15.1). Biến thể mới vượt ngưỡng → thay thế biến thể yếu nhất (theo confidence/tần suất quan sát gần nhất).
- `confidence` PHẢI tính theo cửa sổ thời gian gần nhất (trọng số giảm dần theo thời gian), KHÔNG được tính tổng tích luỹ toàn thời gian — tránh việc 1 biến thể từng đúng nhiều trong quá khứ nhưng đang fail liên tục vẫn được ưu tiên thử trước.
- Biến thể quá hạn TTL và tần suất xuất hiện thấp nhất trong nhóm → hạ ưu tiên trước, chỉ xoá hẳn sau khi hạ ưu tiên đủ lâu mà vẫn không được quan sát lại.

### 3.12 Locale

- Ưu tiên tín hiệu phi-text (icon/svg path, vị trí tương đối, thuộc tính HTML không phải text) hơn text khi xác định intent của 1 phần tử.
- Nếu bắt buộc dùng tín hiệu text, PHẢI gắn nhãn locale quan sát được vào node/variant đó — không dùng chung 1 biến thể text cho mọi locale.

### 3.13 Site Bundle (nhiều domain liên quan)

- Khi quan sát 1 chuỗi hành động di chuyển qua lại giữa ≥2 domain trong cùng 1 phiên khám phá (ví dụ redirect OAuth) → tự động tạo/gán `bundle_id` liên kết các domain đó.
- Bundle KHÔNG sở hữu dữ liệu — dữ liệu vẫn nằm trong map riêng từng domain. Bundle chỉ là lớp liên kết cho phép state-transition graph của domain A trỏ sang state thuộc domain B.
- Nội dung nhúng từ domain khác qua iframe (kể cả không phải OAuth) PHẢI tách map riêng theo đúng domain sở hữu nội dung, map của domain chứa iframe chỉ giữ 1 con trỏ tham chiếu, KHÔNG được nhân bản dữ liệu vào map chứa nó.

---

## 4. ĐẶC TẢ MAP (SCHEMA)

```
MapFile {
  schema_version: string        // đổi khi CẤU TRÚC map thay đổi (hiếm)
  content_revision: number      // tăng liên tục theo MỌI cập nhật nội dung
  domain: string
  bundle_id: string | null
  importance_score: number
  importance_source: "auto" | "user" | "hybrid"
  base_nodes: [ResourceNode]
  account_slots: {
    [account_hash]: { delta_nodes: [ResourceNode] }
  }
  state_graph: [StateNode]
}

ResourceNode {
  id: string
  type: "endpoint" | "dom_element" | "header_signature"
      | "binary_schema" | "local_persistence"
      | "websocket_channel" | "hardware_bound"
  intent: string                 // vai trò ngữ nghĩa, KHÔNG phải selector thô
  variants: [Variant]
  discovered_via: "normal" | "escape_hatch"
  requires_elevation: boolean    // true nếu closed-shadow-root hoặc patch_runtime
}

Variant {
  value_formula: string          // công thức lấy giá trị, KHÔNG phải giá trị thật
  confidence: number              // decay theo thời gian gần nhất
  last_verified: timestamp
  fail_count_recent: number
  locale: string | null
}

StateNode {
  id: string
  match_key: { url_pattern, dom_fingerprint, virtual_route }
  preconditions: [node_id]        // các node phải thoả trước khi state này khả dụng
  transitions: [{ action_ref, target_state_id }]
}
```

**Ghi chú phạm vi (PHẢI đọc kỹ, tránh hiểu sai)**: Map ở đây CHỈ mô tả **cấu trúc/cách thao tác** với website (selector, endpoint, luồng trạng thái). Map KHÔNG chứa và KHÔNG có mục đích lưu trữ **dữ liệu nghiệp vụ** (ví dụ: đáp án câu hỏi, nội dung bài viết đã tạo, kết quả tính toán nghiệp vụ). Bất kỳ tính năng nào dạng "ngân hàng dữ liệu đã học" (learned answer bank) đều KHÔNG thuộc phạm vi hệ thống này — đây là quyết định đã chốt rõ ràng, KHÔNG được agent tự suy diễn thêm tính năng này khi triển khai.

- Versioning: PHẢI ghi file theo kiểu atomic (ghi ra file tạm → rename đè lên file chính) ngay từ phiên bản đầu tiên.
- Export/Import: CHỈ áp dụng cho MapFile, TUYỆT ĐỐI KHÔNG áp dụng cho Tool (Tool không có cơ chế export/import — xem Mục 5.4).

---

## 5. NHÀ MÁY — ĐẶC TẢ CHI TIẾT

### 5.1 Đầu vào
1. Mục tiêu người dùng (ngôn ngữ tự nhiên).
2. Map hiện có liên quan (domain/bundle tương ứng).
3. Cấu hình bổ sung: API key riêng nếu Tool cần `call_llm` (Vai trò 1, Mục 9), mức anti-detection áp dụng.

### 5.2 Quy trình build (5 bước, PHẢI theo đúng thứ tự)

1. **Lập kế hoạch** (LLM, chỉ 1 lần): tìm đường đi trên State-Transition Graph từ trạng thái hiện tại tới mục tiêu. Nếu thiếu đoạn nào → gọi Tháp khám phá bổ sung (theo ngân sách giới hạn tại Mục 5.5), rồi quay lại bước này.
2. **Biên dịch thành chuỗi Action cụ thể** (Mục 6): mỗi action mang theo TOÀN BỘ biến thể đã biết từ Map (không chỉ 1 biến thể ưu tiên), để Tool có sẵn fallback tĩnh (Mục 8.5).
3. **Tham số hoá**: giá trị cụ thể dùng lúc demo/mô tả (không phải value_formula tự trích xuất được) → chuyển thành input parameter, PHẢI xác nhận danh sách này với người dùng trước khi tiếp tục.
4. **Dry-run xác thực**: chạy thử toàn bộ chuỗi qua chính Engine Thực thi (Mục 8), có LLM giám sát CHỈ trong giai đoạn này. Bất kỳ bước nào rơi vào Fallback trong dry-run PHẢI được coi là tín hiệu: hoặc Map thiếu (quay lại bước 1), hoặc yêu cầu người dùng không khả thi (hỏi lại người dùng).
5. **Đóng gói** (Mục 5.3): sinh artifact cuối cùng.

### 5.3 Hình thức đóng gói (chọn cùng người dùng lúc build — PHẢI hỏi rõ, không tự ý chọn mặc định nếu người dùng chưa nói rõ)

| Hình thức | Khi nào phù hợp | Đặc điểm bắt buộc |
|---|---|---|
| Script nội bộ (qua Agent) | Dùng cá nhân, không thường xuyên | Chạy qua Engine hiện có |
| Chrome Extension (Manifest V3) | Cần chạy độc lập, không cần Agent | Permission tính theo đúng action thực tế có mặt (Mục 5.6); nếu có `patch_runtime`, script MAIN-world PHẢI chạy ở `document_start` |
| Userscript (`.user.js`) | Cần cập nhật thường xuyên, nhẹ | NÊN dùng `@updateURL` để tự động cập nhật |
| Chế độ Advisor/Overlay | Người dùng muốn tự quyết định hành động, chỉ cần gợi ý | Chỉ dùng `extract` + hiển thị, KHÔNG tự thực hiện action nào thay người dùng |

### 5.4 Không có export/import hay versioning riêng cho Tool
Tool LUÔN được build mới hoàn toàn từ Map + Nhà máy tại thời điểm build. Khi cần "sửa Tool", quy trình là: người dùng yêu cầu → Nhà máy build lại bản mới → người dùng thay thế bản cũ (thủ công với Extension, tự động với Userscript qua `@updateURL`). KHÔNG tồn tại cơ chế Tool tự cập nhật chính nó.

### 5.5 Ranh giới với Tháp trong lúc build
Nếu Kế hoạch (bước 1, Mục 5.2) cần 1 đoạn Map chưa có, Nhà máy PHẢI gọi Tháp khám phá bổ sung theo đúng cơ chế tại Mục 3, có giới hạn ngân sách (số tool call/token) theo đúng mục tiêu hiện tại — KHÔNG được để việc này lan sang khám phá toàn site nếu người dùng chỉ yêu cầu 1 tính năng cụ thể (trừ khi người dùng chủ động yêu cầu "khám phá sâu toàn site").

Phân biệt 2 loại thu thập trong lúc build/khám phá bổ sung:
- **Chủ động**: agent tự thực hiện thêm hành động chỉ để khám phá — PHẢI giới hạn theo ngân sách.
- **Bị động**: dữ liệu vô tình lộ ra trong lúc thực hiện đúng mục tiêu chính (ví dụ đang xem network log để tìm API X, tình cờ thấy API Y) — LUÔN được ghi lại vào Map, không tính vào ngân sách vì không tốn thêm chi phí.

### 5.6 Tính toán permission tối thiểu (bắt buộc, bước cuối cùng của build)
Nhà máy PHẢI tính chính xác tập quyền cần thiết dựa trên chuỗi action thực tế có trong Tool, KHÔNG được xin quyền rộng hơn "phòng khi cần dùng sau" — nếu Tool không có `patch_runtime`, KHÔNG khai báo MAIN-world script; nếu không cần đọc cookie, KHÔNG xin quyền `cookies`.

---

## 6. ĐẶC TẢ ACTION PRIMITIVE

### 6.1 Danh sách Action và Tier định vị phần tử

Với `click` và `fill`, việc định vị phần tử/endpoint PHẢI thử theo đúng thứ tự tier sau, dừng ở tier đầu tiên thành công:

1. **Accessibility Tree query**: dùng CDP domain `Accessibility` (`Accessibility.getFullAXTree`) để tìm phần tử theo `role`/`name` (nguồn `aria-*`, semantics gốc của trình duyệt). Đây là tier ưu tiên CAO NHẤT vì khớp trực tiếp với nguyên tắc "khoá theo intent/vai trò ngữ nghĩa" (Mục 3.3) — không cần suy luận qua CSS/DOM structure trung gian. Chỉ chuyển sang tier 2 khi site không cung cấp đủ thông tin accessibility (thiếu `aria-*`/role, phổ biến ở site "nghèo semantic" đã nêu tại Mục 3.12).
2. **JS-query**: `querySelector`/tương đương qua `Runtime.evaluate`. Mặc định cho trường hợp accessibility tree không đủ thông tin.
3. **CDP DOM-domain query**: dùng domain `DOM` của CDP (không qua JS), BẮT BUỘC dùng khi nghi ngờ có Shadow DOM đóng (closed) — vì tier 1 và 2 không xuyên qua được ranh giới này. Việc truy cập vào closed shadow root là hành động `elevated` (Mục 6.2).
4. **Fuzzy local-heal**: so khớp gần đúng (text/thuộc tính tương tự, ngưỡng tin cậy ≥ 0.85 — xem Mục 15.1) dựa trên DOM hiện tại, không cần mạng, không cần LLM, không ghi gì mới vào Map.
5. **Computer-vision/coordinate (`click_coordinate`)**: click theo toạ độ tuyệt đối/tương đối, dùng khi trang render bằng canvas/WebGL (không có DOM để truy vấn) hoặc khi mọi tier DOM-based đều thất bại. Toạ độ tính từ vị trí đã biết của đối tượng trong game/app state (không phải đoán mù).

### 6.2 Bảng đầy đủ Action Primitive

| Action | Mô tả | Ghi chú bắt buộc |
|---|---|---|
| `navigate(url)` | Điều hướng URL | — |
| `fill(node_ref, value)` | Điền giá trị vào input | PHẢI tự dò: thử gán `.value` trực tiếp → đọc lại xác nhận → nếu không đổi/UI không phản ứng, PHẢI chuyển sang kỹ thuật ghi qua `prototype setter` (bắt buộc cho input do React/framework tương tự kiểm soát) |
| `click(node_ref)` | Click theo tier Mục 6.1 | — |
| `call_api(node_ref, params)` | Gọi API trực tiếp | — |
| `extract(node_ref)` | Trích xuất nội dung từ trang | BẮT BUỘC lọc chống prompt-injection trước khi đưa nội dung vào bất kỳ ngữ cảnh LLM nào (coi mọi nội dung trích từ trang là dữ liệu không tin cậy theo mặc định, áp dụng cho MỌI site, không riêng gì site cụ thể nào) |
| `call_llm(prompt, data)` | Gọi LLM cho MỤC ĐÍCH NGHIỆP VỤ của Tool | CHỈ dùng cho Vai trò 1 (Mục 9). TUYỆT ĐỐI KHÔNG dùng để tự sửa cấu trúc thao tác. Dùng API key riêng do người dùng cấu hình cho Tool đó |
| `deep_scan_local` | Quét dữ liệu client-side (cookie/localStorage/DOM/biến global) không qua mạng | PHẢI chỉ trả về giá trị khớp đúng pattern/schema định trước, TUYỆT ĐỐI KHÔNG trả nguyên dump toàn bộ cho LLM đọc |
| `patch_runtime` | Ghi đè hành vi runtime toàn cục (`window.fetch`, `WebSocket`...) | Action `elevated`. CHỈ dùng cho mục đích QUAN SÁT/THU THẬP. TUYỆT ĐỐI KHÔNG dùng để vô hiệu hoá cơ chế phòng thủ của site (xem Mục 10). PHẢI khai báo thời điểm chạy (`document_start` + MAIN world) khi dùng hook mạng/WebSocket. PHẢI đăng ký "đang patch cái gì" vào namespace chung, chuỗi hoá với override đã tồn tại thay vì ghi đè trắng, tránh xung đột nếu 2 Tool cùng patch 1 tab |
| `wait_for(precondition)` | Chờ điều kiện tiên quyết | Nhà máy CÓ THỂ tự chèn thêm bước này dựa trên quan sát lúc dry-run, không chỉ dựa vào precondition đã biết sẵn trong Map |
| `branch(condition, path_a, path_b)` | Rẽ nhánh | Điều kiện đánh giá dựa trên state đã khớp với State-Transition Graph, KHÔNG phải LLM phán đoán lại mỗi lần chạy |
| `loop(list_source, sub_action)` | Lặp qua danh sách | PHẢI triển khai dạng hàng đợi giao dịch (transaction queue): phần tử fail liên tục → đẩy vào danh sách dead-letter (không dừng cả chuỗi, không lặp vô hạn tại đúng phần tử đó). Concurrency PHẢI tự điều chỉnh giảm khi quan sát thấy tỷ lệ lỗi/rate-limit tăng, KHÔNG dùng batch size cố định |

Mọi action PHẢI có field `on_failure` tường minh, giá trị 1 trong: `stop` | `skip_and_continue` | `ask_user`. KHÔNG được có hành vi mặc định ẩn trong engine mà không khai báo tường minh ở action đó.

### 6.3 Phân loại Elevated và Hardware-bound (KHÔNG được nhầm lẫn 2 loại này)

- **`elevated`**: hành động rủi ro cao nhưng CÓ THỂ tự động hoá được sau khi đã xin xác nhận người dùng ít nhất 1 lần (ví dụ truy cập closed shadow root qua tier 3, `patch_runtime`). Gồm: mọi truy cập closed shadow root, mọi `patch_runtime`.
- **`hardware_bound`**: hành động liên quan WebAuthn/Passkey — private key nằm vĩnh viễn trong phần cứng bảo mật của thiết bị, KHÔNG THỂ trích xuất hay tái sử dụng dưới bất kỳ hình thức nào. Node loại này PHẢI LUÔN dừng lại bàn giao người dùng thao tác vật lý **MỖI LẦN chạy**, kể cả sau khi đã "khám phá" thành công 1 lần trước đó. TUYỆT ĐỐI KHÔNG được thiết kế bất kỳ cơ chế tự động hoá hay ghi nhớ nào cho node loại này. Không có TTL "hết hạn để thử lại tự động" cho loại này vì nó không bao giờ được tự động hoá.

---

## 7. ENGINE THỰC THI (dùng trong cả Tool và bước Dry-run của Nhà máy)

Vòng lặp 5 bước, PHẢI theo đúng thứ tự, không được bỏ bước:

1. **Resolve**: khớp trạng thái hiện tại của trang với 1 `StateNode` (theo `match_key`: URL + DOM fingerprint + route ảo), lấy ra action + toàn bộ variant + precondition liên quan.
2. **Verify-before-act**: kiểm tra rẻ tiền (ví dụ `querySelector` tồn tại hay không) với variant có confidence cao nhất TRƯỚC KHI thực thi — nếu không khớp bất kỳ variant nào, chuyển thẳng sang bước 5 (Fallback) mà không lãng phí 1 lượt Act.
3. **Act**: thực thi action qua đúng primitive tương ứng (Mục 6).
4. **Confirm**: kiểm tra kết quả đúng kỳ vọng đã ghi trong Map hay không.
   - Với node thuộc dạng tài liệu cộng tác/CRDT (nội dung hội tụ dần theo thời gian, không ổn định tức thời): Confirm PHẢI đọc lại nhiều lần trong 1 khoảng thời gian giới hạn, coi là ổn định khi giá trị không đổi qua N lần đọc liên tiếp — KHÔNG được kết luận đúng/sai chỉ qua 1 lần đọc.
   - 3 nhánh kết quả: (a) đúng kỳ vọng → cập nhật `last_verified`/`confidence` của variant. (b) thất bại do dấu hiệu mất phiên đăng nhập (PHẢI kiểm tra trạng thái login trước khi kết luận nguyên nhân khác) → yêu cầu đăng nhập lại, KHÔNG tính vào circuit breaker. (c) thất bại thật sự → sang bước 5.
5. **Fallback** (CHỈ trong phạm vi Tool, TUYỆT ĐỐI KHÔNG gọi LLM ở bước này khi đang chạy trong Tool đã đóng gói):
   - Thử variant ưu tiên kế tiếp (sắp xếp theo confidence decay-theo-thời gian, Mục 3.11).
   - Hết variant → thử fuzzy local-heal (Mục 6.1, tier 3).
   - Vẫn thất bại và node thuộc loại canvas/hình ảnh → thử computer-vision/coordinate (tier 4).
   - Hết mọi tier → PHẢI: (i) ghi log có cấu trúc (node nào fail, variant nào đã thử, response/trạng thái DOM lúc fail), (ii) dừng đúng tại bước đó, (iii) bàn giao người dùng theo đúng `on_failure` đã khai báo của action đó — bao gồm cả việc tự động scroll/focus tới đúng vị trí cần thao tác nếu khả thi.
   - Log PHẢI ghi nhận cả những lần "phải dùng variant không phải ưu tiên số 1 nhưng vẫn thành công" — đây là tín hiệu cảnh báo sớm Map đang lệch dần, dùng để kích hoạt yêu cầu Nhà máy build lại trước khi xảy ra lỗi hẳn.

### 7.1 Circuit Breaker cấp Tool (khác Circuit Breaker cấp Tháp tại Mục 3.8)
- Tool PHẢI tự đếm số lần fail liên tiếp theo từng node/domain trong 1 khung thời gian trượt (dùng bộ nhớ cục bộ của Tool, ví dụ `chrome.storage`), KHÔNG cần Tháp/Nhà máy đứng nền.
- Vượt ngưỡng → Tool tự chuyển trạng thái "tạm ngưng, cần chú ý" cho đúng phần đó, PHẢI kiểm tra loại trừ nguyên nhân mất phiên đăng nhập trước khi kết luận là lỗi cấu trúc thật sự.

---

## 8. CHÍNH SÁCH ANTI-DETECTION

### 8.1 Định nghĩa 2 nhóm (PHÂN BIỆT RÕ, KHÔNG ĐƯỢC GỘP)
- **Nhóm 1 (ĐƯỢC hỗ trợ)**: giảm dấu hiệu hành vi máy móc thông thường — throttle theo phân phối ngẫu nhiên (không delay cố định), giả lập hành vi phụ trợ tự nhiên (scroll nhẹ, độ trễ hợp lý) trước hành động chính, áp dụng có chọn lọc theo mức độ quan trọng của site (Mục 3.7).
- **Nhóm 2 (TUYỆT ĐỐI KHÔNG hỗ trợ)**: chủ động vô hiệu hoá cơ chế phòng thủ/giám sát mà chính website cố ý dựng lên để chống gian lận/tự động hoá (ví dụ: override `window.open`/`fetch` để né browser-lock, giả `navigator.userAgent` để qua mặt hệ thống khoá trình duyệt trong thi cử).

### 8.2 Hệ quả khi gặp cơ chế khoá chủ động của site
Khi Tháp hoặc Tool phát hiện dấu hiệu site đang chủ động chặn bằng cơ chế khoá (ví dụ kiểu `xxx-lock://`), PHẢI coi đây là **tín hiệu dừng**, báo cho người dùng biết, KHÔNG ĐƯỢC tự tìm cách lách qua.

### 8.3 CDP fingerprint (rủi ro tầng giao thức, không phải hành vi)
- Hạ tầng hiện tại (browser-mcp, chrome-devtools-mcp) dùng CDP theo cách thông thường, có thể mang sẵn tín hiệu bị phát hiện ở tầng giao thức (side-effect của `Runtime.enable`), độc lập với hành vi.
- Quyết định: TIẾP TỤC dùng hạ tầng hiện tại bình thường cho đa số site. CHỈ cân nhắc driver thay thế chuyên biệt (dạng né CDP-detection) khi site VỪA được gắn nhãn "quan trọng cao" VỪA có khả năng dùng anti-bot cấp doanh nghiệp (Cloudflare Enterprise/DataDome/Akamai-class).
- KHÔNG được coi việc chỉ vá `navigator.webdriver` bằng JS là đủ để bảo vệ site quan trọng — đây chỉ là lớp phòng thủ yếu nhất, dễ bị chính công cụ chống bot nhận diện ngược lại.

---

## 9. CHÍNH SÁCH SỬ DỤNG LLM (2 VAI TRÒ — KHÔNG ĐƯỢC GỘP LẪN)

| | Vai trò 1 — Nghiệp vụ (ĐƯỢC phép trong Tool) | Vai trò 2 — Tự sửa cấu trúc (CHỈ ở Tháp/Nhà máy) |
|---|---|---|
| Mục đích | Hiểu/sinh nội dung phục vụ ĐÚNG chức năng chính của Tool (vd: đọc câu hỏi và chọn đáp án, viết bình luận theo ngữ cảnh) | Tìm lại selector/endpoint/schema mới khi site đổi cấu trúc |
| Nằm ở đâu | Trong Tool đã đóng gói, action `call_llm` | CHỈ trong Tháp/Nhà máy, KHÔNG BAO GIỜ đóng gói vào Tool |
| API key | Do người dùng tự cấu hình riêng cho Tool đó | Thuộc hạ tầng Agent/Nhà máy, không liên quan Tool |
| Có mặt trong Tool production? | CÓ | KHÔNG BAO GIỜ |

**Quy tắc phân định**: nếu mục tiêu của chính Tool đó cần hiểu/sinh nội dung → Vai trò 1, hợp lệ. Nếu mục đích là "để Tool tự vá lại cách nó thao tác với trang" → Vai trò 2, KHÔNG được đóng gói vào Tool dưới bất kỳ hình thức nào.

---

## 10. GIAO DIỆN NGƯỜI DÙNG (3 lớp, bổ sung cho nhau, không thay thế nhau)

1. **Command interface** (chat, qua Agent hiện có): PHẢI có tín hiệu UI rõ ràng khi đang ở "chế độ ghi" lúc xin demo (Mục 3.2); danh sách tham số hoá (Mục 5.2 bước 3) PHẢI hiển thị dạng có thể sửa tay, không chỉ hỏi qua văn bản; kết quả dry-run PHẢI hiển thị dạng bảng bước nào pass/fail, không chỉ văn xuôi.
2. **Map Viewer**: hiển thị Resource Graph + State-Transition Graph dạng đồ thị trực quan theo domain/bundle; mỗi node hiển thị confidence/TTL/số biến thể/lần verify cuối; PHẢI cho phép người dùng sửa tay/thêm biến thể thủ công.
3. **Tool Dashboard**: danh sách Tool đã build, mỗi Tool hiển thị map version đang dùng, lần chạy cuối, log lỗi có cấu trúc gần nhất, nút "yêu cầu Nhà máy build lại" nối trực tiếp với tín hiệu circuit breaker/cảnh báo sớm (Mục 7, Mục 7.1).

---

## 11. LỘ TRÌNH TRIỂN KHAI (MVP → mở rộng)

| Giai đoạn | Phạm vi |
|---|---|
| **0 — Nền tảng** | Toàn bộ hệ thống viết bằng **TypeScript/Node.js** (Mục 16). Action primitive cơ bản (`navigate`, `click`, `fill`, `call_api`, `extract`) dùng tier Accessibility Tree + JS-query (Mục 6.1, tier 1-2); chỉ có Resource Graph (chưa có State Graph); khám phá CHỈ qua demo người dùng (chưa có agent-first tự động); Map lưu local, ghi atomic, có `schema_version`+`content_revision` ngay từ đầu; CHỈ đóng gói dạng Chrome Extension; giao diện Command/Map Viewer ở dạng **VS Code Extension** (nhúng IDE hiện có), Web app độc lập KHÔNG thuộc phạm vi giai đoạn này |
| **1 — Tự động hoá khám phá cơ bản** | Thêm State-Transition Graph + precondition; thêm agent-first (ngưỡng 3 lần thử) + fallback demo; thêm đa biến thể + confidence/TTL; thêm Circuit Breaker cấp Tool |
| **2 — Mở rộng khả năng định vị** | Thêm tier CDP DOM-domain (Shadow DOM) + fuzzy local-heal; thêm account-scoping (base/delta); thêm Map Viewer |
| **3 — Site phức tạp/real-time** | Thêm hỗ trợ WebSocket/binary schema; thêm Escape Hatch; thêm tier computer-vision/coordinate (canvas); thêm đóng gói dạng Userscript |
| **4 — Quy mô & độ bền** | Thêm kiểm tra source-first (source-map discovery); Chế độ khám phá sâu (6 bước) + tích hợp MCP reverse-engineering; multi-agent merge; Site Bundle; export/import Map |
| **5 — Nâng cao (tuỳ chọn, làm sau)** | Driver thay thế chuyên biệt cho site critical+anti-bot doanh nghiệp; chế độ Advisor/Overlay; Tool Dashboard đầy đủ |

---

## 12. GIỚI HẠN ĐÃ BIẾT (KHÔNG cố giải quyết, chấp nhận là ranh giới của hệ thống)

1. Node `hardware_bound` (WebAuthn/Passkey) KHÔNG BAO GIỜ tự động hoá được — luôn cần thao tác vật lý người dùng mỗi lần.
2. Local-only nghĩa là chuyển máy/thiết bị khác sẽ mất toàn bộ Map tích luỹ trừ khi người dùng chủ động export/import.
3. Nội dung mã hoá đầu-cuối phía client chỉ đọc được ở dạng plaintext tại DOM sau khi render hoặc tại boundary mã hoá/giải mã — không đọc được qua network capture.
4. Trạng thái trong app dạng CRDT/cộng tác thời gian thực không có "đúng tại 1 thời điểm" tuyệt đối — hành động của Tool có thể bị merge/ghi đè bởi thao tác đồng thời của người khác, đây là rủi ro cố hữu của loại app này.
5. Hệ thống KHÔNG có cơ chế lưu trữ dữ liệu nghiệp vụ (đáp án, nội dung đã sinh...) — nằm ngoài phạm vi Map, không thuộc thiết kế này.

---

## 13. TỰ KIỂM TRA MƠ HỒ (dành cho agent triển khai)

Trước khi lập trình bất kỳ phần nào của đặc tả này, agent triển khai PHẢI:
- Đối chiếu đúng mục số liên quan trong tài liệu này (không suy diễn từ trí nhớ/thói quen chung).
- Nếu 1 chi tiết cần thiết để code KHÔNG có trong tài liệu (ví dụ: ngưỡng cụ thể của "confidence cao", giá trị chính xác của khung thời gian circuit breaker) → PHẢI hỏi lại người dùng để chốt con số cụ thể, KHÔNG được tự chọn 1 giá trị mặc định và coi là hiển nhiên.
- Nếu phát hiện 2 mục trong tài liệu có vẻ mâu thuẫn nhau → PHẢI dừng lại, nêu rõ mâu thuẫn, hỏi người dùng, KHÔNG tự chọn 1 bên để làm theo.

---

## 15. THAM SỐ KỸ THUẬT ĐÃ CHỐT

Các giá trị sau là số liệu CHÍNH THỨC, thay thế mọi cụm "ví dụ"/"gợi ý" xuất hiện ở các mục trước đó. Agent triển khai PHẢI dùng đúng các giá trị này, KHÔNG được tự chọn giá trị khác.

### 15.1 Confidence & Fuzzy-match
- Ngưỡng "confidence cao" (dùng để ưu tiên 1 variant, quyết định thăng cấp base/delta, v.v.): **0.85**
- Ngưỡng tin cậy tối thiểu để Fuzzy local-heal (Mục 6.1, tier 4) được coi là 1 kết quả chấp nhận được: **0.85**

### 15.2 TTL (Time-To-Live)
- Node/Variant khám phá bình thường (`discovered_via: normal`): TTL = **30 ngày** kể từ `last_verified`.
- Node/Variant khám phá qua Escape Hatch (`discovered_via: escape_hatch`, Mục 3.6): TTL = **7 ngày**.
- Hết TTL KHÔNG đồng nghĩa xoá ngay — theo đúng cơ chế hạ ưu tiên dần tại Mục 3.11.

### 15.3 Circuit Breaker (áp dụng cả Mục 3.8 — cấp Tháp, và Mục 7.1 — cấp Tool)
- Ngưỡng kích hoạt: **≥ 5 lần fail liên tiếp/cùng loại trong cửa sổ trượt 10 phút**.
- Trước khi kích hoạt, PHẢI luôn thực hiện bước loại trừ mất phiên đăng nhập/site lỗi tạm thời theo đúng Mục 3.8/7.1 — ngưỡng số ở đây chỉ áp dụng SAU bước loại trừ đó.

### 15.4 Ngân sách khám phá bổ sung (Mục 5.5 — thu thập chủ động)
- Tối đa **10 tool call HOẶC ~5.000 token**, tính riêng cho MỖI mục tiêu cụ thể mà Nhà máy đang build.
- Vượt ngân sách mà chưa đủ dữ liệu → PHẢI dừng, báo lại người dùng (thiếu thông tin để hoàn thành mục tiêu), KHÔNG tự ý xin thêm ngân sách.
- Ngân sách này KHÔNG áp dụng cho thu thập bị động (Mục 5.5) — thu thập bị động không giới hạn vì không phát sinh chi phí hành động thêm.

### 15.5 Số lượng Variant tối đa / node
- **5** (đã cập nhật là giá trị chốt tại Mục 3.11).

### 15.6 CRDT / Collaborative Multi-read Stability (Mục 7 step 4)
- Số lần đọc liên tiếp giá trị phải giống nhau để coi là hội tụ: **3**
- Khoảng cách giữa 2 lần đọc liên tiếp: **50ms**
- Thời gian chờ tối đa trước khi timeout: **1000ms** (1 giây)

### 15.7 Quy mô & Độ bền — Tham số Phase 4 (Mục 3.1, 3.5, 3.13, 4)
- Anti-debug dynamic baseline: số vòng lặp warm-up hiệu chuẩn baseline phiên: **3 vòng**
- Anti-debug timing ratio threshold: tỷ lệ chênh lệch thời gian so với baseline hiệu chuẩn: **≥ 5.0 lần** (giá trị khởi điểm mang tính định hướng phương pháp, cần tinh chỉnh lại theo thực nghiệm trên nhiều loại máy/tải hệ thống thực tế khi Tháp vận hành, không coi là con số tối ưu vĩnh viễn; thay thế hoàn toàn ngưỡng cố định ms để triệt tiêu hiệu ứng trễ do CDP debug-mode và khác biệt cấu hình máy)
- Anti-debug repeated signals: số lần phát hiện bất thường lặp lại tối thiểu trước khi kết luận: **≥ 2 lần liên tiếp**
- Anti-debug loop count threshold: số lần phát hiện debugger statement lặp trước khi gắn cờ nhạy cảm: **3 lần**
- Source-map max size: dung lượng tối đa file source-map giải mã an toàn trong bộ nhớ: **10MB (10 * 1024 * 1024 bytes)**
- Site Bundle max return steps: số bước điều hướng tối đa cho chuỗi khứ hồi OAuth/SSO: **5 bước**

### 15.8 Nâng Cao & Mở Rộng — Tham số Phase 5 (Mục 3.7, 5.3, 8.1, 8.3, 16)
- Critical site importance threshold: ngưỡng điểm quan trọng để coi là site critical, kích hoạt stealth driver: **0.8**
- Stealth typing delay: nhịp gõ phím tối thiểu và tối đa giữa 2 phím: **50ms – 240ms**
- Stealth jitter base: độ trễ phụ trợ ngẫu nhiên cơ sở (Gaussian jitter): **150ms**
- Stealth mouse bezier steps: số điểm nội suy tối thiểu cho quỹ đạo chuột cong Bezier: **20 bước**
- Importance adaptive deviation threshold: khoảng lệch điểm số giữa Heuristic và User override để coi là bất đồng: **0.25**
- Importance adaptive min discrepancies: số lần bất đồng liên tiếp tối thiểu để kích hoạt tự học trọng số heuristic: **3 lần**
- Web UI default port: cổng mặc định cho Web App UI server độc lập: **3456** (bind cứng `127.0.0.1`, bắt buộc kiểm tra Origin/Referer và CSRF token)

---

## 16. LỰA CHỌN CÔNG NGHỆ & NGÔN NGỮ (đã chốt)

| Hạng mục | Quyết định |
|---|---|
| Ngôn ngữ chính | **TypeScript/Node.js cho toàn bộ hệ thống** (Tháp, Nhà máy, Engine, Tool packaging). KHÔNG dùng Python cho phần lõi. Nếu sau này tích hợp 1 thư viện chỉ có bản Python (ví dụ Browser Use gốc), PHẢI bọc qua 1 tiến trình/service riêng biệt, KHÔNG trộn 2 ngôn ngữ trong cùng 1 module lõi. |
| Giao diện người dùng (Mục 10) | Xây **cả Web app lẫn VS Code Extension**, nhưng **VS Code Extension (nhúng trong Antigravity IDE) làm trước**. Web app độc lập là phần mở rộng sau, KHÔNG thuộc phạm vi MVP (Mục 11, Giai đoạn 0-1). |
| LLM cho Tháp/Nhà máy (Vai trò 2, Mục 9) | Gọi **qua Agent/MCP hiện có** (Agent đang chạy trong IDE), KHÔNG cấu hình API key riêng cho việc này. Điều này KHÔNG áp dụng cho Vai trò 1 (`call_llm` trong Tool) — Vai trò 1 VẪN dùng API key riêng do người dùng tự cấu hình cho từng Tool, theo đúng Mục 9, không thay đổi. |
| Tier định vị phần tử (Mục 6.1) | Bổ sung **Accessibility Tree** làm Tier 1 (ưu tiên cao nhất), đẩy JS-query, CDP DOM-domain, Fuzzy local-heal, Computer-vision xuống thành Tier 2-5 tương ứng. Đã cập nhật trực tiếp vào Mục 6.1. |

---

## 17. BẢNG THUẬT NGỮ

| Thuật ngữ | Định nghĩa |
|---|---|
| Tháp | Thành phần khám phá, xây và duy trì Map, có LLM |
| Nhà máy | Thành phần biên dịch Map + mục tiêu người dùng thành Tool, có LLM |
| Tool | Sản phẩm cuối, thực thi tác vụ, không tự sửa cấu trúc |
| Map | Tri thức tích luỹ về cấu trúc/cách vận hành 1 website, gồm Resource Graph + State-Transition Graph |
| Resource Graph | Tập hợp node mô tả tài nguyên (endpoint, DOM, schema...) |
| State-Transition Graph | Tập hợp trạng thái + hành động chuyển trạng thái + precondition |
| Variant | 1 biến thể cụ thể của cách lấy/thao tác 1 node (có thể có nhiều biến thể/node) |
| value_formula | Công thức lấy giá trị (không phải giá trị thật) |
| Elevated | Hành động rủi ro cao, tự động hoá được nhưng cần xác nhận người dùng trước |
| Hardware_bound | Hành động gắn với xác thực phần cứng (WebAuthn), không thể tự động hoá |
| Escape Hatch | Chế độ cho LLM thao tác CDP tự do khi mọi cách đã biết đều thất bại |
| Nhóm 1 / Nhóm 2 (anti-detection) | Xem Mục 8.1 |
| Account slot | Định danh nội bộ (hash) của 1 tài khoản trong Map, không dùng thông tin thật |
| Site Bundle | Nhóm nhiều domain liên quan trong cùng 1 luồng nghiệp vụ |

---

## 18. MÔ HÌNH VẬN HÀNH AGENT-DRIVEN MCP (ARCHITECTURE B)

### 18.1 Nguyên tắc nền tảng
- **Agent là người điều khiển phiên duyệt trình duyệt**: DevBrowserTool KHÔNG tự mở instance Playwright/Chromium độc lập trong luồng hoạt động thông thường của Agent (tránh xung đột session, anti-bot, cookies, và phân mảnh context giữa IDE Agent và Tool).
- **Phân định rõ ràng trách nhiệm**:
  - `browser-mcp` / `chrome-devtools`: Đảm nhiệm việc mở tab, tương tác giao diện người dùng, duy trì phiên đăng nhập và thực thi script trên trang web mục tiêu.
  - `devbrowsertool` (MCP Server via stdio bridge `packages/mcp-bridge`): Đảm nhiệm vai trò Trí tuệ & Cấu trúc — cung cấp công thức trinh sát (Scout Recipes), trích xuất và lưu trữ Map 7 loại tài nguyên (Scout Processor & MapStore), đề xuất hành động (Action Proposer), biên dịch kịch bản (Action Compiler), và tự động đóng gói Extension MV3 / Userscripts (Tool Factory).
  - `LiveScoutEngine (Playwright riêng)`: CHỈ đóng vai trò fallback cục bộ hoặc phục vụ kiểm thử thị giác độc lập (visual testing / headless CLI), KHÔNG phải là phương thức chính trong quy trình tương tác của Agent.

### 18.2 Chu trình 5 bước Agent-Driven (Workflow)
1. **Lấy công thức trinh sát**: Agent gọi `get_scout_scripts(categories)` từ DevBrowserTool để nhận các script JavaScript thuần (DOM interactive, Performance API, Storage, WebSocket sniffer).
2. **Thực thi trên tab đang mở**: Agent dùng `browser_execute_script` (của browser-mcp) để chạy các recipe trên trang web người dùng đang duyệt.
3. **Nạp dữ liệu & Xây dựng Map**: Agent gọi `ingest_scout_data(domain, raw_data)` gửi kết quả về cho DevBrowserTool. `ScoutProcessor` tự động phân loại thành 7 loại tài nguyên chuẩn (semantic DOM, API endpoints, web sockets, v.v.) và lưu trữ vào MapStore với versioning và hashing bảo mật.
4. **Lập kế hoạch hành động**: Agent gọi `propose_actions(domain, intent)` để nhận danh sách hành động đề xuất. Agent sử dụng năng lực suy luận ngôn ngữ tự nhiên (LLM) để tinh chỉnh selector, tham số hóa biến động.
5. **Biên dịch & Đóng gói**: Agent gọi `compile_actions` để lấy executable scripts (5-tier fallback locators, Bézier stealth mouse, randomized jitter), sau đó gọi `build_tool(domain, tool_name, tool_type)` để đóng gói sản phẩm hoàn chỉnh (Chrome Extension MV3 / Userscript / Advisor HUD) sẵn sàng tải vào trình duyệt người dùng.

### 18.3 Ranh giới tin cậy (Trust Boundary) & Giới hạn đã biết
- **Mô hình tin cậy Agent-in-the-Loop**: Trong Kiến trúc B, `ingest_scout_data` hoàn toàn tin tưởng dữ liệu do Agent cung cấp (DOM interactive nodes, Performance timing, Local Storage, WebSocket frames). Hệ thống backend KHÔNG thể tự xác minh độc lập tại tầng network/CDP rằng dữ liệu đó có thực sự được cào từ đúng URL khai báo tại thời điểm đó hay không.
- **Mục đích thiết kế**: DevBrowserTool vận hành như một trợ lý kiến trúc và nhà máy sinh công cụ cục bộ cho cá nhân (Local Personal Agent Tool), không phải dịch vụ multi-tenant công cộng. Do đó, ranh giới tin cậy được đặt tại chính phiên làm việc của Agent. Bất kỳ hệ thống nào tích hợp downstream PHẢI ghi nhận ranh giới này: `ingest_scout_data` không có cơ chế chứng thực nguồn gốc dữ liệu độc lập (data provenance verification) ngoài định dạng schema đã validate qua Zod.
- **Thao tác build_tool là 1-bước thuần backend**: Khác với `dry_run_tool` (yêu cầu mô hình 2 bước: lấy script thực thi và trả kết quả dry-run về server), `build_tool` là thao tác biên dịch mã nguồn và đóng gói artifact thuần túy trên đĩa (`~/.devbrowsertool/tools/<name>`), hoàn toàn không cần tương tác với trình duyệt. Vì vậy, việc giữ nguyên `build_tool` dạng 1-bước là quyết định có chủ đích và tối ưu về mặt kiến trúc.

