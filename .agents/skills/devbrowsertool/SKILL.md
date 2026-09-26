---
name: devbrowsertool
description: Quy trình trinh sát website và đóng gói thành công cụ tự động (Chrome Extension/Userscript) sử dụng DevBrowserTool MCP Server kết hợp với browser-mcp/chrome-devtools. Kích hoạt khi người dùng muốn khám phá trang web, tạo tool, bot, hoặc tự động hóa một website.
---

# Hướng dẫn sử dụng DevBrowserTool (Kiến trúc B - Agent-Driven)

DevBrowserTool là một **Hệ Thống Trích Xuất Tri Thức & Nhà Máy Đóng Gói Tool Web** cho AI Agent.
Nguyên tắc cốt lõi: **DevBrowserTool KHÔNG tự mở browser riêng** — Agent dùng chính session browser thật của mình (qua `browser-mcp` hoặc `chrome-devtools`) để tương tác, còn DevBrowserTool đảm nhiệm xử lý tri thức 7 loại tài nguyên, 5-tier locators và đóng gói tool độc lập.

---

## Quy trình 5 bước hoàn chỉnh để tạo Tool cho một Website

### Bước 1: Lấy công thức bóc tách (Recipes)
Gọi công cụ MCP:
```json
devbrowsertool.get_scout_scripts({
  "url": "https://openfront.io"
})
```
Kết quả trả về danh sách các JavaScript expressions (IIFE):
- `page_info`: Lấy tiêu đề và URL
- `dom_elements`: Bóc tách toàn bộ buttons, inputs, tabs, modal controls
- `performance_entries`: Bóc tách API REST/GraphQL từ Resource Timing
- `storage_keys`: Bóc tách LocalStorage/SessionStorage
- `websocket_detection`: Phát hiện kênh WebSocket

---

### Bước 2: Tự chạy scripts trên tab trình duyệt của Agent
Dùng `browser-mcp.browser_execute_script` (hoặc `chrome-devtools.evaluate_script`) để chạy từng script trên tab đang mở:

```javascript
// 1. Chạy dom_elements script
domData = browser_execute_script({ code: scripts.find(s => s.id === 'dom_elements').code })

// 2. Chạy performance_entries script
perfData = browser_execute_script({ code: scripts.find(s => s.id === 'performance_entries').code })

// 3. Chạy storage_keys script
storageData = browser_execute_script({ code: scripts.find(s => s.id === 'storage_keys').code })

// 4. (Tùy chọn) Bắt network traffic qua chrome-devtools nếu cần
networkData = chrome-devtools.list_network_requests({ pageId: "...", resourceTypes: ["xhr", "fetch"] })
```

---

### Bước 3: Nạp dữ liệu thô vào DevBrowserTool
Gửi toàn bộ dữ liệu thô về DevBrowserTool để bóc tách thành Bản đồ tri thức (MapFile 7 loại tài nguyên):

```json
devbrowsertool.ingest_scout_data({
  "url": "https://openfront.io",
  "page_info": { "title": "OpenFront", "url": "https://openfront.io" },
  "dom_elements": domData,
  "performance_entries": perfData,
  "storage_keys": storageData,
  "network_requests": networkData
})
```

DevBrowserTool sẽ tự động:
- Khử trùng lặp endpoints & trích xuất API schema
- Mô hình hóa đồ thị chuyển trạng thái (State Graph)
- Gán hệ thống định vị 5 tầng (CSS, JS DOM, Text, Accessibility, Coordinate) kèm Confidence và TTL
- Lưu trữ vào MapStore cục bộ

---

### Bước 4: Khám phá controls và suy luận chuỗi hành động
Gọi `propose_actions` để lấy danh sách controls có sẵn:
```json
devbrowsertool.propose_actions({
  "domain": "openfront.io"
})
```

Dựa vào yêu cầu của người dùng (ví dụ: *"Đổi tên người chơi thành Hero và bấm nút Vào trận"*), Agent tự suy luận chuỗi action và gọi `compile_actions`:

```json
devbrowsertool.compile_actions({
  "domain": "openfront.io",
  "actions": [
    {
      "intent": "node-input-player-name",
      "type": "fill",
      "params": { "value": "{{player_name}}" }
    },
    {
      "intent": "node-button-btn-join",
      "type": "click"
    }
  ]
})
```

---

### Bước 5: Đóng gói thành Tool độc lập (Chrome Extension MV3)
Gọi `build_tool`:
```json
devbrowsertool.build_tool({
  "domain": "openfront.io",
  "tool_name": "openfront_autojoin",
  "package_type": "chrome_extension",
  "action_specs": compiledActions,
  "input_params": [
    {
      "name": "player_name",
      "label": "Tên người chơi",
      "type": "string",
      "default_value": "Player1"
    }
  ]
})
```

Kết quả trả về đường dẫn thư mục Extension đã build (ví dụ: `~/.devbrowsertool/tools/openfront.io/openfront_autojoin`).
Báo cho người dùng cách nạp vào Chrome:
1. Mở `chrome://extensions`
2. Bật **Developer mode**
3. Bấm **Load unpacked** và chọn thư mục vừa tạo!
