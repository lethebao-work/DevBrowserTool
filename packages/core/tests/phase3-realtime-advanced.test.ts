/**
 * Phase 3 Tests — Real-time & Advanced Automation (Mục 3.6, 5.3, 6.1 tier 5, 6.2, 7 step 4)
 *
 * Kiểm tra:
 * 1. PatchRuntimeAction: Chặn elevated khi chưa xác nhận, chuỗi hoá trong window.__devBrowserTool_patches__
 * 2. DeepScanLocalAction: Lọc pattern client storage, cấm dump toàn bộ
 * 3. ClickCoordinateAction & Tier 5 findByCvCoordinate: Click canvas/WebGL theo toạ độ
 * 4. EscapeHatchEngine: Kích hoạt khi bế tắc, cờ discovered_via: escape_hatch, TTL 7 ngày
 * 5. UserscriptPackager: Sinh .user.js kèm @updateURL và runtime loop
 * 6. ExecutionEngine Step 4 Confirm: CRDT multi-read xác nhận hội tụ
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import {
  PatchRuntimeAction,
  DeepScanLocalAction,
  ClickCoordinateAction,
} from '../src/actions/phase3-primitives.js';
import { findByCvCoordinate, locateElement } from '../src/locator/index.js';
import { EscapeHatchEngine, type EscapeHatchPatternRegistry } from '../src/discovery/escape-hatch.js';
import { UserscriptPackager } from '../src/packager/userscript.js';
import { ExecutionEngine } from '../src/engine/executor.js';
import { ActionRegistry } from '../src/actions/primitives.js';
import { MapStore } from '../src/map/store.js';
import { MAP_CONSTANTS, type Action, type MapFile, type ResourceNode } from '../src/map/schema.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ADVANCED_TEST_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <title>Phase 3 Real-time & Canvas Test Page</title>
</head>
<body>
  <h1>Phase 3 Advanced Test Page</h1>

  <!-- Canvas WebGL/2D cho Tier 5 Coordinate test -->
  <canvas id="game-canvas" width="400" height="300" style="border:1px solid #333;"></canvas>

  <!-- Element tài liệu cộng tác CRDT -->
  <div id="collab-document" data-version="1">Đoạn văn bản cộng tác ban đầu</div>

  <script>
    // Vẽ canvas mẫu
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff5722';
    ctx.fillRect(50, 50, 80, 80);

    let canvasClicked = false;
    canvas.addEventListener('click', (e) => {
      canvasClicked = true;
      window.__lastCanvasClick__ = { x: e.clientX, y: e.clientY };
    });

    // Nạp dữ liệu vào localStorage an toàn
    try {
      localStorage.setItem('auth_token_jwt', 'eyJhbGciOiJIUzI1NiJ9.demo');
      localStorage.setItem('user_display_name', 'Alex Developer');
      localStorage.setItem('sensitive_internal_debug', 'secret_debug_dump');
    } catch {
      window.__localStorageMock__ = {
        'auth_token_jwt': 'eyJhbGciOiJIUzI1NiJ9.demo',
        'user_display_name': 'Alex Developer',
        'sensitive_internal_debug': 'secret_debug_dump',
      };
    }

    // Giả lập CRDT hội tụ sau 150ms
    setTimeout(() => {
      document.getElementById('collab-document').innerText = 'Đoạn văn bản đã hội tụ ổn định';
    }, 120);
  </script>
</body>
</html>
`;

describe('Phase 3 — Real-time & Advanced Automation (Mục 3.6, 5.3, 6.1, 6.2, 7)', () => {
  let browser: Browser;
  let page: Page;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    await page.setContent(ADVANCED_TEST_PAGE);
    adapter = new PlaywrightBrowserAdapter(page);
  });

  afterAll(async () => {
    await browser?.close();
  });

  describe('PatchRuntimeAction (Mục 6.2 & Mục 6.3 Elevated)', () => {
    it('CHẶN LẠI khi chưa có xác nhận elevated (allow_elevation = false)', async () => {
      const action = new PatchRuntimeAction();
      const result = await action.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          target: 'window.fetch',
          patch_id: 'test_patch_unauth',
          hook_code: '(orig) => (...args) => orig(...args)',
          allow_elevation: false, // Chưa được cấp quyền
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Blocked: Action "patch_runtime"');
      expect(result.error).toContain('ELEVATED');
    });

    it('từ chối khi phát hiện mã vi phạm Anti-detection Nhóm 2 (Mục 8.1)', async () => {
      const action = new PatchRuntimeAction();
      const result = await action.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          target: 'window.fetch',
          patch_id: 'test_bypass',
          hook_code: '(orig) => (...args) => { /* bypass_lock */ return orig(...args); }',
          allow_elevation: true,
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Anti-detection Policy');
    });

    it('thực thi thành công và chuỗi hoá vào namespace window.__devBrowserTool_patches__ khi có quyền', async () => {
      const action = new PatchRuntimeAction();
      const result = await action.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          target: 'window.fetch',
          patch_id: 'network_traffic_logger',
          hook_code: `(orig) => async function(...args) {
            window.__fetchCallCount__ = (window.__fetchCallCount__ || 0) + 1;
            return orig.apply(this, args);
          }`,
          allow_elevation: true,
        },
      });

      expect(result.success).toBe(true);

      // Kiểm tra namespace tồn tại trên browser
      const nsCheck = await page.evaluate(() => {
        return Boolean((window as any).__devBrowserTool_patches__?.registry['network_traffic_logger']);
      });
      expect(nsCheck).toBe(true);
    });
  });

  describe('DeepScanLocalAction (Mục 6.2)', () => {
    it('quét đúng dữ liệu theo filter_pattern và cấm dump toàn bộ', async () => {
      const action = new DeepScanLocalAction();

      // Chỉ lọc token auth
      const result = await action.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          source: 'localStorage',
          filter_pattern: '^auth_token',
        },
      });

      expect(result.success).toBe(true);
      const data = result.data as Record<string, string>;
      expect(data['auth_token_jwt']).toBeDefined();
      // Không lọt các key khác vào
      expect(data['sensitive_internal_debug']).toBeUndefined();
    });

    it('từ chối khi thiếu filter_pattern (chống dump toàn bộ storage)', async () => {
      const action = new DeepScanLocalAction();
      const result = await action.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          source: 'localStorage',
          filter_pattern: '', // Rỗng -> bị từ chối
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dump toàn bộ bị cấm');
    });
  });

  describe('ClickCoordinateAction & Tier 5 CV/Coordinate (Mục 6.1 tier 5)', () => {
    it('findByCvCoordinate định vị toạ độ trên canvas theo formula coord:x,y', async () => {
      const result = await findByCvCoordinate(adapter, {
        formula: 'coord:80,80[canvas="#game-canvas"]',
      });

      expect(result.found).toBe(true);
      expect(result.tier).toBe(5);
      expect(result.tierName).toBe('cv_coordinate');
      expect((result.value as any).canvasSelector).toBe('#game-canvas');
    });

    it('ClickCoordinateAction thực thi click chính xác trên Canvas', async () => {
      const action = new ClickCoordinateAction();
      const result = await action.execute({
        browser: adapter,
        node: null,
        currentVariant: null,
        params: {
          x: 60,
          y: 60,
          canvas_selector: '#game-canvas',
        },
      });

      expect(result.success).toBe(true);

      const clickedOnPage = await page.evaluate(() => (window as any).__lastCanvasClick__);
      expect(clickedOnPage).toBeDefined();
    });

    it('tích hợp vào locateElement() cascading ở Tier 5', async () => {
      const result = await locateElement(adapter, {
        formula: 'coordinate:100,100[canvas="#game-canvas"]',
        skipTiers: [1, 2, 3, 4],
      });

      expect(result.found).toBe(true);
      expect(result.tier).toBe(5);
    });
  });

  describe('EscapeHatchEngine (Mục 3.6)', () => {
    it('từ chối kích hoạt nếu thất bại do mất phiên đăng nhập (isSessionLost = true)', () => {
      const canAct = EscapeHatchEngine.canActivate({
        targetIntent: 'Lấy dữ liệu ví',
        domain: 'app.example.com',
        attemptCount: 3,
        lastKnownFailedTiers: [1, 2, 4],
        isSessionLost: true, // Mất session
        isTransientError: false,
      });

      expect(canAct.allowed).toBe(false);
      expect(canAct.reason).toContain('mất phiên đăng nhập');
    });

    it('từ chối kích hoạt nếu site đang lỗi tạm thời (isTransientError = true)', () => {
      const canAct = EscapeHatchEngine.canActivate({
        targetIntent: 'Xem báo cáo',
        domain: 'app.example.com',
        attemptCount: 3,
        lastKnownFailedTiers: [1, 2, 4],
        isSessionLost: false,
        isTransientError: true,
      });

      expect(canAct.allowed).toBe(false);
      expect(canAct.reason).toContain('lỗi tạm thời');
    });

    it('kích hoạt thành công khi bế tắc: tạo node với cờ discovered_via: escape_hatch và TTL 7 ngày (Mục 3.6 & 15.1)', async () => {
      const result = await EscapeHatchEngine.execute(
        adapter,
        {
          targetIntent: 'Nút tuỳ biến đặc thù',
          domain: 'game.example.com',
          attemptCount: 3,
          lastKnownFailedTiers: [1, 2, 4],
          isSessionLost: false,
          isTransientError: false,
        },
        async () => ({ success: true, formula: '#game-canvas' }),
      );

      expect(result.activated).toBe(true);
      expect(result.success).toBe(true);
      expect(result.createdNode).toBeDefined();

      const node = result.createdNode!;
      // BẮT BUỘC theo Mục 3.6
      expect(node.discovered_via).toBe('escape_hatch');
      expect(node.variants[0].ttl_ms).toBe(MAP_CONSTANTS.TTL_ESCAPE_HATCH_MS); // 7 ngày = 604,800,000 ms
    });

    it('bước 2 Codify: phân loại domain_specific khi pattern chỉ xuất hiện ở 1 domain', async () => {
      const registryMap = new Map<string, Set<string>>();
      const mockRegistry: EscapeHatchPatternRegistry = {
        getDomainsForPattern: (p) => Array.from(registryMap.get(p) || []),
        recordPatternOccurrence: (p, d) => {
          if (!registryMap.has(p)) registryMap.set(p, new Set());
          registryMap.get(p)!.add(d);
        },
      };

      const result = await EscapeHatchEngine.execute(
        adapter,
        {
          targetIntent: 'Widget tuỳ biến domain A',
          domain: 'alpha.example.com',
          attemptCount: 3,
          lastKnownFailedTiers: [1, 2, 4],
          isSessionLost: false,
          isTransientError: false,
        },
        async () => ({ success: true, formula: 'div.custom-widget[data-role="view"]' }),
        false,
        mockRegistry,
      );

      expect(result.success).toBe(true);
      expect(result.codifyDecision).toBe('domain_specific');
    });

    it('bước 2 Codify: nâng cấp thành new_node_type khi pattern xuất hiện ở ≥2 domain khác nhau (Mục 3.6)', async () => {
      const registryMap = new Map<string, Set<string>>();
      const mockRegistry: EscapeHatchPatternRegistry = {
        getDomainsForPattern: (p) => Array.from(registryMap.get(p) || []),
        recordPatternOccurrence: (p, d) => {
          if (!registryMap.has(p)) registryMap.set(p, new Set());
          registryMap.get(p)!.add(d);
        },
      };

      // Lần 1 tại domain site-a.com
      await EscapeHatchEngine.execute(
        adapter,
        {
          targetIntent: 'Virtual grid viewer',
          domain: 'site-a.com',
          attemptCount: 3,
          lastKnownFailedTiers: [1, 2, 4],
          isSessionLost: false,
          isTransientError: false,
        },
        async () => ({ success: true, formula: 'div.custom-grid#table-1' }),
        false,
        mockRegistry,
      );

      // Lần 2 tại domain site-b.org với cùng pattern cấu trúc (div.custom-grid)
      const resultB = await EscapeHatchEngine.execute(
        adapter,
        {
          targetIntent: 'Virtual grid viewer',
          domain: 'site-b.org',
          attemptCount: 3,
          lastKnownFailedTiers: [1, 2, 4],
          isSessionLost: false,
          isTransientError: false,
        },
        async () => ({ success: true, formula: 'div.custom-grid#table-2' }),
        false,
        mockRegistry,
      );

      expect(resultB.success).toBe(true);
      expect(resultB.codifyDecision).toBe('new_node_type');
    });
  });

  describe('UserscriptPackager (Mục 5.3)', () => {
    it('sinh mã nguồn .user.js hợp lệ với đầy đủ metadata, @updateURL và self-contained runtime', () => {
      const store = new MapStore(join(tmpdir(), `dbt-userscript-${Date.now()}`));
      const map = store.createMap('app.example.com');

      const action: Action = {
        id: 'act_click',
        type: 'click',
        node_ref: 'btn_1',
        on_failure: 'stop',
      };

      const userscriptCode = UserscriptPackager.build({
        name: 'AutoExportReport',
        version: '1.2.0',
        matchPatterns: ['https://app.example.com/*'],
        updateUrl: 'https://updates.example.com/auto-export.user.js',
        actions: [action],
        map,
      });

      expect(userscriptCode).toContain('// ==UserScript==');
      expect(userscriptCode).toContain('// @name         AutoExportReport');
      expect(userscriptCode).toContain('// @version      1.2.0');
      expect(userscriptCode).toContain('// @updateURL    https://updates.example.com/auto-export.user.js');
      expect(userscriptCode).toContain('// ==/UserScript==');
      expect(userscriptCode).toContain('Circuit Breaker cấp LocalStorage');
    });
  });

  describe('ExecutionEngine Step 4 Confirm: CRDT Multi-Read (Mục 7 step 4)', () => {
    it('xác nhận hội tụ ổn định qua N lần đọc liên tiếp đối với tài liệu cộng tác CRDT', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-crdt-${Date.now()}`));
      const registry = ActionRegistry.createDefault();
      const engine = new ExecutionEngine(registry, store);

      let map = store.createMap('collab.example.com');
      const crdtNode: ResourceNode = {
        id: 'collab_doc_node',
        intent: 'Tài liệu cộng tác CRDT',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'v_crdt',
            value_formula: '#collab-document',
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
        ],
      };
      map = store.addNode(map, crdtNode);

      const action: Action = {
        id: 'act_extract_crdt',
        type: 'extract',
        node_ref: 'collab_doc_node',
        on_failure: 'stop',
        params: {
          is_crdt: true, // Kích hoạt CRDT multi-read check Mục 7 step 4
        },
      };

      const result = await engine.execute([action], map, adapter);

      expect(result.success).toBe(true);
      expect(result.steps.length).toBe(1);
      expect(result.steps[0].engineStep).toBe('confirm');
    });
  });
});
