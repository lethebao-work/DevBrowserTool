/**
 * Phase 2 Tests — Account Scoping Engine & Map Visualizer (Mục 3.9 & Mục 10 lớp 2)
 *
 * Kiểm tra:
 * 1. Anonymized Account Hash: SHA-256 nội bộ, không rò rỉ PII
 * 2. Tự động phát hiện đổi tài khoản trên trình duyệt & tạo slot mới
 * 3. Thăng cấp Delta node -> Base node khi quan sát giống nhau ở >= 2 accounts
 * 4. Map Visualizer: Xuất đồ thị 2 lớp (Cytoscape.js & Mermaid)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import { AccountScopingEngine } from '../src/map/account-scoping.js';
import { MapVisualizer } from '../src/map/visualizer.js';
import { MapStore } from '../src/map/store.js';
import type { ResourceNode, MapFile } from '../src/map/schema.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ACCOUNT_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>User Portal</title>
  <meta name="user-id" content="user_dev_99812">
</head>
<body>
  <div id="app">
    <h1>Xin chào, Developer!</h1>
  </div>
</body>
</html>
`;

describe('Phase 2 — Account Scoping & Map Visualizer (Mục 3.9 & Mục 10)', () => {
  let browser: Browser;
  let page: Page;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    await page.setContent(ACCOUNT_PAGE_HTML);
    adapter = new PlaywrightBrowserAdapter(page);
  });

  afterAll(async () => {
    await browser?.close();
  });

  describe('AccountScopingEngine: Hash định danh ẩn danh (Mục 3.9)', () => {
    it('sinh hash nội bộ SHA-256 và không chứa thông tin PII nhạy cảm', () => {
      const email = 'user.private.data@example.com';
      const hash1 = AccountScopingEngine.generateAccountHash(email, 'example.com');

      expect(hash1).toMatch(/^acc_[a-f0-9]{16}$/);
      // Tuyệt đối không chứa plaintext
      expect(hash1).not.toContain('user.private.data');
      expect(hash1).not.toContain('example.com');

      // Tính tất định: cùng input -> cùng hash
      const hash2 = AccountScopingEngine.generateAccountHash('  USER.PRIVATE.DATA@example.com ', 'example.com');
      expect(hash1).toBe(hash2);

      // Khác user -> khác hash
      const hashOther = AccountScopingEngine.generateAccountHash('other.user@example.com', 'example.com');
      expect(hash1).not.toBe(hashOther);
    });
  });

  describe('AccountScopingEngine: Phát hiện đổi tài khoản (Mục 3.9)', () => {
    it('phát hiện đúng tài khoản từ meta tag và tự tạo slot mới trong Map', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-acc-${Date.now()}`));
      let map = store.createMap('portal.example.com');

      const result = await AccountScopingEngine.detectAccountChange(adapter, store, map);

      expect(result.current_hash).toBeDefined();
      expect(result.slot_created).toBe(true);
      expect(result.updated_map.account_slots[result.current_hash]).toBeDefined();

      // Base nodes vẫn giữ nguyên
      expect(result.updated_map.base_nodes).toEqual(map.base_nodes);
    });

    it('nhận diện sự kiện chuyển đổi tài khoản khi hash hiện tại khác với session mới', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-acc-switch-${Date.now()}`));
      let map = store.createMap('portal.example.com');
      const oldHash = 'acc_old_session_123';

      const result = await AccountScopingEngine.detectAccountChange(adapter, store, map, oldHash);

      expect(result.changed).toBe(true);
      expect(result.previous_hash).toBe(oldHash);
      expect(result.current_hash).not.toBe(oldHash);
    });
  });

  describe('AccountScopingEngine: Thăng cấp Delta node -> Base node (Mục 3.9)', () => {
    it('KHÔNG thăng cấp nếu node chỉ mới quan sát ở 1 tài khoản', () => {
      const store = new MapStore(join(tmpdir(), `dbt-promote-single-${Date.now()}`));
      let map = store.createMap('saas.example.com');

      const deltaNode: ResourceNode = {
        id: 'btn_export_csv',
        intent: 'Xuất báo cáo CSV',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v1',
            value_formula: '#export-csv',
            confidence: 0.9,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      };

      map = store.addAccountSlot(map, 'acc_slot_1', [deltaNode]);

      const report = AccountScopingEngine.promoteDeltaToBase(map);

      expect(report.promoted_count).toBe(0);
      expect(report.updated_map.base_nodes.length).toBe(0);
      expect(report.updated_map.account_slots['acc_slot_1'].delta_nodes.length).toBe(1);
    });

    it('TỰ ĐỘNG THĂNG CẤP lên Base node khi quan sát giống nhau ở >= 2 tài khoản khác nhau', () => {
      const store = new MapStore(join(tmpdir(), `dbt-promote-multi-${Date.now()}`));
      let map = store.createMap('saas.example.com');

      const deltaNodeAccount1: ResourceNode = {
        id: 'btn_download_invoice',
        intent: 'Tải hoá đơn VAT',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v_acc1',
            value_formula: 'button.btn-download-vat',
            confidence: 0.85,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      };

      const deltaNodeAccount2: ResourceNode = {
        id: 'btn_download_invoice',
        intent: 'Tải hoá đơn VAT', // Cùng intent ở tài khoản thứ 2
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v_acc2',
            value_formula: 'button.btn-download-vat',
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      };

      map = store.addAccountSlot(map, 'acc_slot_1', [deltaNodeAccount1]);
      map = store.addAccountSlot(map, 'acc_slot_2', [deltaNodeAccount2]);

      expect(map.base_nodes.length).toBe(0);

      // Thực hiện thăng cấp
      const report = AccountScopingEngine.promoteDeltaToBase(map);

      expect(report.promoted_count).toBe(1);
      expect(report.updated_map.base_nodes.length).toBe(1);

      const promotedBase = report.updated_map.base_nodes[0];
      expect(promotedBase.intent).toBe('Tải hoá đơn VAT');
      expect(promotedBase.variants.length).toBeGreaterThanOrEqual(1);

      // BẮT BUỘC: Đã xoá khỏi delta_nodes của cả 2 account slots để chống trùng lặp
      expect(report.updated_map.account_slots['acc_slot_1'].delta_nodes.length).toBe(0);
      expect(report.updated_map.account_slots['acc_slot_2'].delta_nodes.length).toBe(0);
    });

    it('MÂU THUẪN (Mục 3.10): Khi 2 accounts cùng intent nhưng selector khác nhau (A/B testing hoặc phân quyền), PHẢI gộp thành ĐA BIẾN THỂ (multi-variant) trong Base Node', () => {
      const store = new MapStore(join(tmpdir(), `dbt-promote-conflict-${Date.now()}`));
      let map = store.createMap('portal.example.com');

      // Account 1 (ví dụ nhóm A/B test A hoặc tài khoản thường)
      const deltaNodeAccount1: ResourceNode = {
        id: 'node_export_data',
        intent: 'Xuất dữ liệu giao dịch',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v_acc1_csv',
            value_formula: '#btn-export-csv',
            confidence: 0.90,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      };

      // Account 2 (ví dụ nhóm A/B test B hoặc tài khoản admin nhìn thấy nút khác)
      const deltaNodeAccount2: ResourceNode = {
        id: 'node_export_data',
        intent: 'Xuất dữ liệu giao dịch', // Cùng intent nghiệp vụ
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v_acc2_excel',
            value_formula: '.menu-item-export-excel', // SELECTOR MÂU THUẪN / KHÁC BIỆT
            confidence: 0.85,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      };

      map = store.addAccountSlot(map, 'acc_slot_user', [deltaNodeAccount1]);
      map = store.addAccountSlot(map, 'acc_slot_admin', [deltaNodeAccount2]);

      // Thực hiện thăng cấp
      const report = AccountScopingEngine.promoteDeltaToBase(map);

      expect(report.promoted_count).toBe(1);
      expect(report.updated_map.base_nodes.length).toBe(1);

      const promotedBase = report.updated_map.base_nodes[0];
      expect(promotedBase.intent).toBe('Xuất dữ liệu giao dịch');

      // QUAN TRỌNG NHẤT (Mục 3.10): Không được tự ý chọn 1 bên bỏ 1 bên!
      // Base node PHẢI có cả 2 variants của 2 accounts
      expect(promotedBase.variants.length).toBe(2);
      const formulas = promotedBase.variants.map(v => v.value_formula);
      expect(formulas).toContain('#btn-export-csv');
      expect(formulas).toContain('.menu-item-export-excel');

      // Delta nodes của cả 2 slots đều được giải phóng
      expect(report.updated_map.account_slots['acc_slot_user'].delta_nodes.length).toBe(0);
      expect(report.updated_map.account_slots['acc_slot_admin'].delta_nodes.length).toBe(0);
    });
  });

  describe('MapVisualizer: Đồ thị 2 lớp (Mục 10 lớp 2)', () => {
    it('chuyển đổi MapFile sang Cytoscape Graph Data Model đầy đủ nodes và edges', () => {
      const store = new MapStore(join(tmpdir(), `dbt-viz-${Date.now()}`));
      let map = store.createMap('app.example.com');

      const baseNode: ResourceNode = {
        id: 'btn_save',
        intent: 'Lưu thay đổi',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v_save',
            value_formula: '#save-btn',
            confidence: 0.9,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      };
      map = store.addNode(map, baseNode);

      // Thêm State Node & Transition
      map = store.addState(map, {
        id: 'state_home',
        match_key: { url_pattern: '/home', dom_fingerprint: 'fp_123', virtual_route: null },
        preconditions: ['btn_save'],
      });
      map = store.addState(map, {
        id: 'state_settings',
        match_key: { url_pattern: '/settings', dom_fingerprint: 'fp_456', virtual_route: null },
      });
      map = store.addTransition(map, 'state_home', 'click_nav_settings', 'state_settings');

      // Thêm Delta Node
      map = store.addAccountSlot(map, 'acc_vip_hash', [
        {
          id: 'btn_vip_feature',
          intent: 'Tính năng VIP',
          type: 'dom_element',
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: 'v_vip',
              value_formula: '#vip-action',
              confidence: 0.8,
              last_verified: Date.now(),
              ttl_ms: 86400000,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
          ],
        },
      ]);

      const cyData = MapVisualizer.toCytoscapeData(map);

      // Kiểm tra nodes
      expect(cyData.nodes.some(n => n.data.id === 'res_btn_save')).toBe(true);
      expect(cyData.nodes.some(n => n.data.id === 'state_state_home')).toBe(true);
      expect(cyData.nodes.some(n => n.data.category === 'delta_resource')).toBe(true);

      // Kiểm tra edges
      expect(cyData.edges.some(e => e.data.type === 'precondition')).toBe(true);
      expect(cyData.edges.some(e => e.data.type === 'transition' && e.data.label === 'click_nav_settings')).toBe(true);
    });

    it('sinh mã biểu đồ Mermaid markdown hợp lệ', () => {
      const store = new MapStore(join(tmpdir(), `dbt-mermaid-${Date.now()}`));
      let map = store.createMap('mermaid.example.com');
      map = store.addNode(map, {
        id: 'node_test',
        intent: 'Nút kiểm thử',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v_t',
            value_formula: '#test',
            confidence: 0.9,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      });

      const mermaid = MapVisualizer.toMermaid(map);
      expect(mermaid).toContain('flowchart TD');
      expect(mermaid).toContain('Base Resource Graph');
      expect(mermaid).toContain('Nút kiểm thử');
    });
  });
});
