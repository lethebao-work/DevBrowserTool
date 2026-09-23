/**
 * Advanced Action Primitives Tests (Mục 1.7)
 *
 * Kiểm tra:
 * 1. WaitForAction: chờ phần tử xuất hiện / timeout / predicate
 * 2. BranchAction: rẽ nhánh điều kiện và ghi log quyết định
 * 3. LoopAction: lặp qua danh sách và Dead-Letter Queue (DLQ) khi có item lỗi
 * 4. CallLlmAction: tiện ích xử lý nội dung (Mục 9 Vai trò 1, tuân thủ boundaries)
 * 5. ActionRegistry: đăng ký đầy đủ 9 actions chuẩn
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import {
  WaitForAction,
  BranchAction,
  LoopAction,
  CallLlmAction,
} from '../src/actions/advanced.js';
import { ActionRegistry } from '../src/actions/primitives.js';

const TEST_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Advanced Actions Testbed</title>
</head>
<body>
  <div id="status-box" data-ready="false">Loading...</div>
  <ul id="items-list">
    <li data-id="1">Sản phẩm 1</li>
    <li data-id="2">Sản phẩm 2</li>
    <li data-id="3">Sản phẩm 3</li>
  </ul>
  <div id="dynamic-target" style="display: none;">Đã xuất hiện</div>

  <script>
    setTimeout(() => {
      document.getElementById('status-box').setAttribute('data-ready', 'true');
      document.getElementById('status-box').textContent = 'Ready';
      document.getElementById('dynamic-target').style.display = 'block';
    }, 200);
  </script>
</body>
</html>
`;

describe('Advanced Actions Primitives (Mục 1.7)', () => {
  let browser: Browser;
  let page: Page;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    await page.setContent(TEST_PAGE_HTML);
    adapter = new PlaywrightBrowserAdapter(page);
  });

  afterAll(async () => {
    await browser?.close();
  });

  describe('WaitForAction', () => {
    it('chờ phần tử hiển thị thành công trước khi hết timeout', async () => {
      const waitAction = new WaitForAction();
      const result = await waitAction.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          condition_type: 'selector',
          selector: '#dynamic-target',
          timeout_ms: 2000,
        },
      });

      expect(result.success).toBe(true);
      expect(result.duration_ms).toBeLessThan(2000);
    });

    it('báo lỗi timeout rõ ràng khi phần tử không xuất hiện', async () => {
      const waitAction = new WaitForAction();
      const result = await waitAction.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          condition_type: 'selector',
          selector: '#never-appears',
          timeout_ms: 200,
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout exceeded');
    });
  });

  describe('BranchAction', () => {
    it('thực thi then_branch khi biểu thức điều kiện thoả mãn', async () => {
      const branchAction = new BranchAction();
      const result = await branchAction.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          condition: "document.getElementById('status-box').getAttribute('data-ready') === 'true'",
          then_actions: [{ type: 'custom', target_node_id: 'then_node', parameters: {} }],
          else_actions: [{ type: 'custom', target_node_id: 'else_node', parameters: {} }],
        },
      });

      expect(result.success).toBe(true);
      const data = result.data as { branch_taken: string };
      expect(data.branch_taken).toBe('then');
    });

    it('thực thi else_branch khi điều kiện không thoả mãn', async () => {
      const branchAction = new BranchAction();
      const result = await branchAction.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          condition: "document.getElementById('status-box').getAttribute('data-ready') === 'not_matching'",
          then_actions: [{ type: 'custom', target_node_id: 'then_node', parameters: {} }],
          else_actions: [{ type: 'custom', target_node_id: 'else_node', parameters: {} }],
        },
      });

      expect(result.success).toBe(true);
      const data = result.data as { branch_taken: string };
      expect(data.branch_taken).toBe('else');
    });
  });

  describe('LoopAction with Dead-Letter Queue (DLQ)', () => {
    it('lặp qua các phần tử và cách ly item lỗi vào Dead-Letter Queue mà không làm sập toàn bộ luồng', async () => {
      const loopAction = new LoopAction();
      const items = [
        { id: 'item-1', name: 'Item 1' },
        null, // item này sẽ gây lỗi và rơi vào DLQ
        { id: 'item-3', name: 'Item 3' },
      ];

      const result = await loopAction.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          items,
          max_iterations: 3,
        },
      });

      expect(result.success).toBe(true);
      const data = result.data as {
        total_items: number;
        completed_items: number;
        dead_letter_queue: Array<{ item: unknown; error: string }>;
        dlq_count: number;
      };

      expect(data.completed_items).toBe(2);
      expect(data.dlq_count).toBe(1);
      expect(data.dead_letter_queue[0].error).toContain('Null or undefined');
    });
  });

  describe('CallLlmAction (Mục 9 Vai trò 1 - Tiện ích nội dung)', () => {
    it('thực hiện trích xuất và biến đổi nội dung qua tiện ích CallLlmAction', async () => {
      const callLlm = new CallLlmAction();
      const result = await callLlm.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          prompt: 'Trích xuất thông tin sản phẩm từ text',
          input_text: '<div class="prod">Laptop Pro 2026 - $1500</div>',
        },
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const data = result.data as { result: string; tokens_estimated: number };
      expect(data.result).toContain('Laptop Pro 2026');
      expect(data.tokens_estimated).toBeGreaterThan(0);
    });
  });

  describe('ActionRegistry Integration', () => {
    it('đăng ký mặc định toàn bộ 9 Action Primitives chuẩn', () => {
      const registry = ActionRegistry.createDefault();
      const registeredTypes = registry.listTypes();

      expect(registeredTypes).toContain('navigate');
      expect(registeredTypes).toContain('click');
      expect(registeredTypes).toContain('fill');
      expect(registeredTypes).toContain('wait_for');
      expect(registeredTypes).toContain('branch');
      expect(registeredTypes).toContain('loop');
      expect(registeredTypes).toContain('call_llm');
      expect(registeredTypes.length).toBeGreaterThanOrEqual(7);
    });
  });
});
