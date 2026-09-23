/**
 * Demo Recorder Tests (Mục 3.2, 3.3, 0.7)
 *
 * Kiểm tra:
 * 1. Suy luận intent ngữ nghĩa và chuẩn hoá ID (deriveIntent, slugifyIntent)
 * 2. Trích xuất ResourceNode & Variants từ các RecordedEvent (Tier 1 Accessibility & Tier 2 CSS)
 * 3. Chu trình điều phối phiên ghi trên trình duyệt:
 *    - startRecording (tín hiệu viền và banner đỏ rõ ràng, Mục 3.2)
 *    - lockTab (ngăn user thao tác ngoài lúc demo, Mục 3.2)
 *    - unlockTab
 *    - stopRecording (dọn dẹp DOM và trả về sự kiện)
 * 4. Xác nhận hành động phi-UI (requestNonUiActionApproval, Mục 3.2)
 * 5. Tích hợp với MapStore: nạp nodes ghi được vào Map
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import { DemoRecorder } from '../src/recorder/recorder.js';
import { deriveIntent, slugifyIntent, extractResourceNodesFromEvents } from '../src/recorder/extractor.js';
import type { DomElementSnapshot, RecordedEvent } from '../src/recorder/types.js';
import { MapStore } from '../src/map/store.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_PAGE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>Demo Recorder Test Page</title>
</head>
<body>
  <h1>Interactive Testbed</h1>
  <button id="login-btn" role="button" aria-label="Đăng nhập tài khoản">Đăng nhập</button>
  <a id="details-link" href="#details" role="link">Xem chi tiết sản phẩm</a>
  <input id="email-input" type="text" placeholder="Nhập địa chỉ email" />
</body>
</html>
`;

describe('Demo Recorder (Mục 3.2)', () => {
  describe('Intent Extraction & Slugification', () => {
    it('chuẩn hoá tên intent tiếng Việt thành ID không dấu an toàn', () => {
      expect(slugifyIntent('btn', 'Đăng nhập hệ thống')).toBe('btn_dang_nhap_he_thong');
      expect(slugifyIntent('input', 'Mật khẩu & Mã pin (2FA)')).toBe('input_mat_khau_ma_pin_2fa');
      expect(slugifyIntent('link', '')).toBe('link_element');
    });

    it('suy ra vai trò ngữ nghĩa cho nút bấm (button)', () => {
      const snap: DomElementSnapshot = {
        tagName: 'BUTTON',
        id: 'submit-btn',
        className: 'btn-primary',
        role: 'button',
        ariaLabel: 'Xác nhận đặt hàng',
        textContent: 'Đặt hàng ngay',
        placeholder: null,
        name: null,
        inputType: null,
        selector: '#submit-btn',
      };

      const result = deriveIntent(snap, 'click');
      expect(result.role).toBe('button');
      expect(result.id).toBe('btn_xac_nhan_dat_hang');
      expect(result.intent).toBe('Nút Xác nhận đặt hàng');
    });

    it('suy ra vai trò ngữ nghĩa cho ô nhập (textbox)', () => {
      const snap: DomElementSnapshot = {
        tagName: 'INPUT',
        id: 'email',
        className: null,
        role: null,
        ariaLabel: null,
        textContent: null,
        placeholder: 'Nhập email của bạn',
        name: 'user_email',
        inputType: 'text',
        selector: '#email',
      };

      const result = deriveIntent(snap, 'fill');
      expect(result.role).toBe('textbox');
      expect(result.id).toBe('input_nhap_email_cua_ban');
      expect(result.intent).toBe('Ô nhập Nhập email của bạn');
    });
  });

  describe('extractResourceNodesFromEvents', () => {
    it('chuyển đổi danh sách sự kiện thành ResourceNode và 2 Tier variants', () => {
      const events: RecordedEvent[] = [
        {
          id: 'e1',
          type: 'click',
          timestamp: Date.now(),
          target: {
            tagName: 'BUTTON',
            id: 'btn-pay',
            className: 'pay-btn',
            role: 'button',
            ariaLabel: 'Thanh toán ngay',
            textContent: 'Thanh toán',
            placeholder: null,
            name: null,
            inputType: null,
            selector: '#btn-pay',
          },
        },
        {
          id: 'e2',
          type: 'fill',
          timestamp: Date.now(),
          value: 'test@example.com',
          target: {
            tagName: 'INPUT',
            id: 'inp-email',
            className: null,
            role: 'textbox',
            ariaLabel: 'Địa chỉ Email',
            textContent: null,
            placeholder: 'Email',
            name: 'email',
            inputType: 'text',
            selector: '#inp-email',
          },
        },
      ];

      const res = extractResourceNodesFromEvents(events);
      expect(res.nodes.length).toBe(2);
      expect(res.summary.clicks).toBe(1);
      expect(res.summary.fills).toBe(1);

      const btnNode = res.nodes.find(n => n.id.startsWith('btn_'));
      expect(btnNode).toBeDefined();
      expect(btnNode?.variants.length).toBe(2);

      // Variant 1: Tier 1 Accessibility (role:button[name="..."])
      expect(btnNode?.variants[0].value_formula).toContain('role:button[name="Thanh toán ngay"]');
      expect(btnNode?.variants[0].confidence).toBe(0.90);

      // Variant 2: Tier 2 CSS selector (#btn-pay)
      expect(btnNode?.variants[1].value_formula).toBe('#btn-pay');
      expect(btnNode?.variants[1].confidence).toBe(0.85);
    });

    it('deduplicate cùng 1 phần tử khi click nhiều lần', () => {
      const snap: DomElementSnapshot = {
        tagName: 'BUTTON',
        id: 'like',
        className: 'like-btn',
        role: 'button',
        ariaLabel: 'Thích',
        textContent: 'Like',
        placeholder: null,
        name: null,
        inputType: null,
        selector: '#like',
      };

      const events: RecordedEvent[] = [
        { id: '1', type: 'click', timestamp: 1, target: snap },
        { id: '2', type: 'click', timestamp: 2, target: snap },
        { id: '3', type: 'click', timestamp: 3, target: snap },
      ];

      const res = extractResourceNodesFromEvents(events);
      expect(res.nodes.length).toBe(1);
      expect(res.summary.clicks).toBe(3);
    });
  });

  describe('DemoRecorder on Real Browser', () => {
    let browser: Browser;
    let page: Page;
    let adapter: PlaywrightBrowserAdapter;
    let recorder: DemoRecorder;

    beforeAll(async () => {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      page = await browser.newPage();
      adapter = new PlaywrightBrowserAdapter(page);
      recorder = new DemoRecorder(adapter);
    });

    afterAll(async () => {
      await browser?.close();
    });

    it('quản lý toàn bộ phiên ghi demo: start → thao tác → lock → unlock → stop → extract', async () => {
      await page.setContent(TEST_PAGE_HTML);

      // 1. Bắt đầu phiên ghi
      const session = await recorder.startRecording('example.com');
      expect(session.status).toBe('recording');

      // Xác nhận có visual indicator và outline đỏ (Mục 3.2)
      const indicatorText = await adapter.evaluate<string>(
        'document.getElementById("__dbt_recording_indicator__")?.innerText || ""'
      );
      expect(indicatorText).toContain('Chế độ Ghi Demo');

      const outline = await adapter.evaluate<string>('document.documentElement.style.outline');
      expect(outline).toContain('rgb(255, 71, 87)'); // #ff4757

      // 2. Người dùng thao tác trên trang (click nút + nhập text)
      await page.click('#login-btn');
      await page.click('#details-link');
      await page.fill('#email-input', 'agent@devbrowser.tool');
      await page.dispatchEvent('#email-input', 'change');

      // 3. Khoá tab (Mục 3.2)
      await recorder.lockTab();
      expect(recorder.getCurrentSession()?.status).toBe('locked');
      const hasLockOverlay = await adapter.evaluate<boolean>(
        'document.getElementById("__dbt_tab_lock__") !== null'
      );
      expect(hasLockOverlay).toBe(true);

      // 4. Mở khoá tab
      await recorder.unlockTab();
      expect(recorder.getCurrentSession()?.status).toBe('recording');
      const lockRemoved = await adapter.evaluate<boolean>(
        'document.getElementById("__dbt_tab_lock__") === null'
      );
      expect(lockRemoved).toBe(true);

      // 5. Dừng ghi demo
      const finishedSession = await recorder.stopRecording();
      expect(finishedSession.status).toBe('stopped');
      expect(finishedSession.events.length).toBeGreaterThanOrEqual(2);

      // Visual indicator và viền đã được gỡ bỏ
      const indicatorRemoved = await adapter.evaluate<boolean>(
        'document.getElementById("__dbt_recording_indicator__") === null'
      );
      expect(indicatorRemoved).toBe(true);

      // 6. Trích xuất ResourceNode và nạp vào MapStore
      const extracted = recorder.extractMapNodes(finishedSession);
      expect(extracted.nodes.length).toBeGreaterThanOrEqual(2);

      const store = new MapStore(join(tmpdir(), 'dbt-rec-maps-' + Date.now()));
      let map = store.createMap('example.com');
      for (const node of extracted.nodes) {
        map = store.addNode(map, node);
      }

      expect(map.base_nodes.length).toBeGreaterThanOrEqual(2);
      expect(map.base_nodes.some(n => n.id.includes('dang_nhap'))).toBe(true);
    });

    it('xác nhận hành động phi-UI qua confirm modal (Mục 3.2)', async () => {
      await page.setContent(TEST_PAGE_HTML);

      // Giả lập người dùng bấm "OK" trên browser confirm dialog
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('call_api');
        await dialog.accept();
      });

      const approved = await recorder.requestNonUiActionApproval('call_api', {
        url: 'https://api.example.com/v1/auth',
        method: 'POST',
      });

      expect(approved).toBe(true);
    });

    it('ghi nhận luồng sự kiện rrweb và xuất file SessionReplay chuẩn (Mục 1.8)', async () => {
      await page.setContent(TEST_PAGE_HTML);

      // 1. Bắt đầu phiên ghi có bật rrweb
      const session = await recorder.startRecording('example.com', { enableRrweb: true });
      expect(session.status).toBe('recording');

      // 2. Thao tác người dùng kích hoạt DOM mutation & click
      await page.click('#login-btn');
      await page.fill('#email-input', 'test@example.com');

      // 3. Dừng phiên ghi và kiểm tra rrweb events
      const finishedSession = await recorder.stopRecording();
      expect(finishedSession.rrwebEvents).toBeDefined();
      expect(finishedSession.rrwebEvents?.length).toBeGreaterThan(0);

      // Meta event (Type 4) và Snapshot event (Type 2) phải có mặt
      const types = finishedSession.rrwebEvents?.map((e) => e.type) || [];
      expect(types).toContain(4); // Meta
      expect(types).toContain(2); // FullSnapshot

      // 4. Xuất SessionReplay
      const replayExport = recorder.exportSessionReplay(finishedSession);
      expect(replayExport.sessionId).toBe(finishedSession.sessionId);
      expect(replayExport.domain).toBe('example.com');
      expect(replayExport.rrwebEventsCount).toBeGreaterThan(0);
      expect(replayExport.eventsCount).toBeGreaterThan(0);
      expect(replayExport.rrwebEvents.length).toBe(replayExport.rrwebEventsCount);
    });
  });
});

