/**
 * Phase 2 Tests — Element Locator Tier 3 & Tier 4 (Mục 6.1, 6.3, 15.1)
 *
 * Kiểm tra:
 * 1. Tier 3 CDP DOM: Xuyên thủng Shadow DOM (Open & Closed)
 * 2. Tier 3 CDP DOM: Đánh dấu `requiresElevation: true` với Closed Shadow Root (Mục 6.3)
 * 3. Tier 4 Fuzzy Local-Heal: Tự chữa lành khi ID/Class bị hash đổi với ngưỡng ≥ 0.85 (Mục 15.1)
 * 4. Tier 4 Fuzzy Local-Heal: Từ chối khi điểm tương đồng < 0.85
 * 5. ExecutionEngine Fallback: Tự động kích hoạt Tier 4 khi toàn bộ variants thất bại (Mục 7 step 5)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import {
  locateElement,
  findByCdpDom,
  findByFuzzyHeal,
} from '../src/locator/index.js';
import { ExecutionEngine } from '../src/engine/executor.js';
import { ActionRegistry } from '../src/actions/primitives.js';
import { MapStore } from '../src/map/store.js';
import { MAP_CONSTANTS, type Action, type MapFile, type ResourceNode } from '../src/map/schema.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SHADOW_DOM_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Shadow DOM & Fuzzy Test Page</title>
</head>
<body>
  <h1>Test Page Phase 2</h1>

  <!-- Phần tử thông thường có ID bị dynamic hash (cho Fuzzy Heal) -->
  <div class="checkout-container">
    <button id="checkout-btn-v2-hash98234" class="btn-primary" aria-label="Xác nhận thanh toán đơn hàng">
      Xác nhận thanh toán
    </button>
  </div>

  <!-- Custom Element có Open Shadow DOM -->
  <open-component id="open-host"></open-component>

  <!-- Custom Element có Closed Shadow DOM -->
  <closed-component id="closed-host"></closed-component>

  <script>
    // 1. Tạo Open Shadow Root
    const openHost = document.getElementById('open-host');
    const openRoot = openHost.attachShadow({ mode: 'open' });
    openRoot.innerHTML = \`
      <div class="open-inner">
        <button id="inside-open-shadow" class="shadow-btn">Nút trong Open Shadow</button>
      </div>
    \`;

    // 2. Tạo Closed Shadow Root
    const closedHost = document.getElementById('closed-host');
    const closedRoot = closedHost.attachShadow({ mode: 'closed' });
    closedRoot.innerHTML = \`
      <div class="closed-inner">
        <button id="inside-closed-shadow" class="secure-btn">Nút bảo mật trong Closed Shadow</button>
      </div>
    \`;

    // Mô phỏng cơ chế theo dõi/registry cho closed shadow roots (Mục 6.3)
    closedHost._closedShadowRoot = closedRoot;
  </script>
</body>
</html>
`;

describe('Phase 2 — Tier 3 CDP DOM & Tier 4 Fuzzy Local-Heal', () => {
  let browser: Browser;
  let page: Page;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    await page.setContent(SHADOW_DOM_HTML);
    adapter = new PlaywrightBrowserAdapter(page);
  });

  afterAll(async () => {
    await browser?.close();
  });

  describe('Tier 3: CDP DOM Query & Shadow DOM (Mục 6.1 & 6.3)', () => {
    it('định vị thành công phần tử bên trong Open Shadow Root (requiresElevation = false)', async () => {
      const result = await findByCdpDom(adapter, '#inside-open-shadow');

      expect(result.found).toBe(true);
      expect(result.tier).toBe(3);
      expect(result.tierName).toBe('cdp_dom');
      expect(result.requiresElevation).toBe(false);
      expect(result.description).toContain('OPEN Shadow DOM');
    });

    it('định vị thành công phần tử bên trong Closed Shadow Root và đánh dấu elevated (Mục 6.3)', async () => {
      const result = await findByCdpDom(adapter, '#inside-closed-shadow');

      expect(result.found).toBe(true);
      expect(result.tier).toBe(3);
      expect(result.tierName).toBe('cdp_dom');
      // BẮT BUỘC: Truy cập vào Closed Shadow Root là hành động Elevated
      expect(result.requiresElevation).toBe(true);
      expect(result.description).toContain('CLOSED Shadow DOM');
      expect(result.description).toContain('elevated: true');
    });

    it('locateElement() CHẶN LẠI (found = false, requiresElevation = true) khi gặp Closed Shadow Root mà allowElevation !== true (Mục 6.3)', async () => {
      // Khi không truyền allowElevation (mặc định false)
      const blockedResult = await locateElement(adapter, {
        formula: '#inside-closed-shadow',
        skipTiers: [1, 2],
      });

      // BẮT BUỘC: Không được trả về found = true để action tự ý click lén lút
      expect(blockedResult.found).toBe(false);
      expect(blockedResult.requiresElevation).toBe(true);
      expect(blockedResult.description).toContain('Blocked: Element is inside CLOSED Shadow DOM');
      expect(blockedResult.description).toContain('Requires elevated confirmation');
    });

    it('locateElement() cho phép tiếp tục (found = true, requiresElevation = true) khi allowElevation = true (Mục 6.3)', async () => {
      const allowedResult = await locateElement(adapter, {
        formula: '#inside-closed-shadow',
        skipTiers: [1, 2],
        allowElevation: true, // Người dùng hoặc runtime đã xác nhận cấp quyền
      });

      expect(allowedResult.found).toBe(true);
      expect(allowedResult.requiresElevation).toBe(true);
      expect(allowedResult.tier).toBe(3);
    });

    it('tích hợp vào cascading locateElement khi Tier 1 và Tier 2 bỏ qua hoặc thất bại', async () => {
      // document.querySelector thông thường ngoài document sẽ không tìm thấy inside-open-shadow
      const cascadedResult = await locateElement(adapter, {
        formula: '#inside-open-shadow',
        // Bỏ qua Tier 1 & 2 để test trực tiếp Tier 3
        skipTiers: [1, 2],
      });

      expect(cascadedResult.found).toBe(true);
      expect(cascadedResult.tier).toBe(3);
    });
  });

  describe('Tier 4: Fuzzy Local-Heal (Mục 6.1 & Mục 15.1)', () => {
    it('chữa lành selector thành công khi ID có hash động ngẫu nhiên (ngưỡng ≥ 0.85)', async () => {
      // Giả lập selector gốc trong Map là #checkout-btn-v2 nhưng DOM thật là #checkout-btn-v2-hash98234
      const result = await findByFuzzyHeal(adapter, {
        formula: '#checkout-btn-v2',
        intent: 'Xác nhận thanh toán',
      });

      expect(result.found).toBe(true);
      expect(result.tier).toBe(4);
      expect(result.tierName).toBe('fuzzy_heal');
      expect(result.confidence).toBeGreaterThanOrEqual(MAP_CONSTANTS.FUZZY_HEAL_MIN_CONFIDENCE); // ≥ 0.85
      expect((result.value as any).id).toBe('checkout-btn-v2-hash98234');
    });

    it('tự động chữa lành theo text content và aria-label tương tự', async () => {
      const result = await findByFuzzyHeal(adapter, {
        intent: 'Xác nhận thanh toán đơn', // Lệch nhẹ so với text hiển thị
      });

      expect(result.found).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('từ chối khi độ tương đồng thấp hơn ngưỡng 0.85', async () => {
      const result = await findByFuzzyHeal(adapter, {
        intent: 'Đăng nhập tài khoản quản trị viên', // Không liên quan gì đến checkout
      });

      expect(result.found).toBe(false);
      expect(result.confidence ?? 0).toBeLessThan(0.85);
    });
  });

  describe('ExecutionEngine Fallback: Tích hợp Tier 4 (Mục 7 step 5)', () => {
    it('tự động fallback sang Tier 4 Fuzzy Local-Heal khi tất cả variants đã lưu đều thất bại', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-fuzzy-exec-${Date.now()}`));
      const registry = ActionRegistry.createDefault();
      const engine = new ExecutionEngine(registry, store);

      let map = store.createMap('checkout-test.com');

      // Tạo node có selector cũ bị lệch hash nhẹ sau khi site cập nhật ID
      // Formula trong Map: #checkout-btn-v2-hash98 (dài 22 ký tự)
      // ID thật trong DOM: #checkout-btn-v2-hash98234 (dài 25 ký tự) -> Dice score = 0.933 >= 0.85
      const node: ResourceNode = {
        id: 'btn_confirm_payment',
        intent: 'Hoàn tất thủ tục đơn hàng', // Không chứa substring để Tier 1 A11y tree không match
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v_old_dead',
            value_formula: '#checkout-btn-v2-hash98',
            confidence: 0.9,
            last_verified: Date.now() - 100000,
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now() - 100000,
          },
        ],
      };
      map = store.addNode(map, node);

      const action: Action = {
        id: 'act_click_checkout',
        type: 'click',
        node_ref: 'btn_confirm_payment',
        on_failure: 'stop',
      };

      const result = await engine.execute([action], map, adapter);

      // Kết quả: Action thành công nhờ Tier 4 Fuzzy Local-Heal!
      expect(result.success).toBe(true);
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].engineStep).toBe('fallback');
      expect(result.steps[0].actionResult?.used_fallback).toBe(true);
      expect(result.logs.some(l => l.message.includes('Tier 4 Fuzzy Local-Heal'))).toBe(true);

      // Quan trọng: Map gốc KHÔNG bị tự sửa cấu trúc (Mục 6.1 & Mục 1.2)
      const unchangedNode = map.base_nodes.find(n => n.id === 'btn_confirm_payment')!;
      expect(unchangedNode.variants.length).toBe(1);
      expect(unchangedNode.variants[0].id).toBe('v_old_dead');
    });

    it('BẮT BUỘC thử hết các variants đã biết trước khi nhảy sang Tier 4 Fuzzy Local-Heal (Mục 7 step 5)', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-fallback-order-${Date.now()}`));
      const registry = ActionRegistry.createDefault();
      const engine = new ExecutionEngine(registry, store);

      let map = store.createMap('fallback-order-test.com');

      // Tạo node có:
      // - Variant 1 (ưu tiên 1): Selector chết (#dead-non-existent-selector)
      // - Variant 2 (ưu tiên 2): Selector sống khớp Open Shadow DOM (#inside-open-shadow)
      // - Intent: "Nút trong Open Shadow"
      const node: ResourceNode = {
        id: 'btn_multi_variant',
        intent: 'Nút trong Open Shadow',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v1_dead',
            value_formula: '#dead-non-existent-selector',
            confidence: 0.95, // Cao nhất
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
          {
            id: 'v2_alive',
            value_formula: '#inside-open-shadow',
            confidence: 0.70, // Thấp hơn v1, nhưng selector còn sống
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      };
      map = store.addNode(map, node);

      const action: Action = {
        id: 'act_click_order_test',
        type: 'click',
        node_ref: 'btn_multi_variant',
        on_failure: 'stop',
      };

      const result = await engine.execute([action], map, adapter);

      // Kết quả: Action thành công nhờ Variant 2, KHÔNG ĐƯỢC nhảy cóc sang Fuzzy Heal!
      expect(result.success).toBe(true);
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].actionResult?.used_variant_id).toBe('v2_alive');
      expect(result.steps[0].actionResult?.used_fallback).toBe(true);
      // Log PHẢI xác nhận dùng non-primary variant, KHÔNG dùng Fuzzy heal
      expect(result.logs.some(l => l.message.includes('Fallback succeeded with non-primary variant "v2_alive"'))).toBe(true);
      expect(result.logs.some(l => l.message.includes('Tier 4 Fuzzy Local-Heal'))).toBe(false);
    });
  });
});
