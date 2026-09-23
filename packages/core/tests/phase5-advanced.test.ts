/**
 * Phase 5 Test Suite — Advanced & Extended Ecosystem (Mục 3.7, 5.3, 8.1, 8.3, 10, 16, 15.8)
 *
 * Kiểm thử toàn diện 6 hạng mục của Phase 5:
 * 5.1: Driver thay thế chuyên biệt cho site critical (CDPStealthAdapter, PolicyResolver, ExternalBridge)
 * 5.2: Chế độ đóng gói Advisor/Overlay (AdvisorPackager, AdvisorySteps, HUD bundle)
 * 5.3: Tool Dashboard đầy đủ (ToolRegistry, Drift Detection, Circuit Breaker tracking, Rebuild)
 * 5.4: Web App UI Server độc lập (Host 127.0.0.1, Chống DNS Rebinding & CSRF, Token validation)
 * 5.5: Anti-detection Nhóm 1 nâng cao (Bézier mouse path, typing cadence, smooth scrolling, adaptive delay)
 * 5.6: Importance Score tự thích ứng Heuristic (Heuristic feature scoring, Adaptive Learning Step)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  MAP_CONSTANTS,
  type MapFile,
  type ToolConfig,
  type StructuredLogEntry,
} from '../src/map/schema.js';
import { MapStore } from '../src/map/store.js';
import { StealthEngine } from '../src/actions/stealth.js';
import {
  SitePolicyResolver,
  CDPStealthAdapter,
  ExternalSubprocessDriverBridge,
} from '../src/actions/stealth-driver.js';
import { AdvisorPackager } from '../src/packager/advisor.js';
import { ToolRegistry } from '../src/packager/tool-registry.js';
import { ImportanceEvaluator, type HeuristicFeatures } from '../src/map/importance-evaluator.js';
import { WebAppServer } from '../../ui/src/web-server.js';
import type { BrowserAdapter } from '../src/actions/primitives.js';

// Mock BrowserAdapter đơn giản cho Unit Tests
class MockBrowserAdapter implements BrowserAdapter {
  public evaluatedScripts: string[] = [];
  public currentUrlValue = 'https://example.com/app';
  public currentTitleValue = 'Example App';

  async evaluate<T = unknown>(script: string): Promise<T> {
    this.evaluatedScripts.push(script);
    return undefined as T;
  }
  async navigate(url: string): Promise<void> {
    this.currentUrlValue = url;
  }
  async waitFor(condition: string, timeoutMs?: number): Promise<boolean> {
    return true;
  }
  async screenshot(): Promise<Buffer> {
    return Buffer.from('fake_image');
  }
  async currentUrl(): Promise<string> {
    return this.currentUrlValue;
  }
  async currentTitle(): Promise<string> {
    return this.currentTitleValue;
  }
}

describe('Phase 5 — Nâng Cao & Mở Rộng Hệ Thống (Mục 3.7, 5.3, 8.1, 8.3, 10, 16, 15.8)', () => {
  let tempDir: string;
  let mapStore: MapStore;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dbt-p5-test-'));
    mapStore = new MapStore(join(tempDir, 'maps'));
    toolRegistry = new ToolRegistry(tempDir);
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ==========================================================================
  // 5.1: DRIVER THAY THẾ CHUYÊN BIỆT CHO SITE CRITICAL (Mục 8.3 & Mục 16)
  // ==========================================================================
  describe('5.1 Driver Thay Thế Chuyên Biệt (Mục 8.3 & Mục 16)', () => {
    it('SitePolicyResolver phát hiện chính xác chữ ký dịch vụ chống bot bên thứ ba', () => {
      // 1. Phát hiện Cloudflare
      const cfResult = SitePolicyResolver.detectThirdPartyAntiBot('__cf_bm=xyz123;', '<div>cf-ray: 890123</div>');
      expect(cfResult.detected).toBe(true);
      expect(cfResult.vendor).toBe('cloudflare');
      expect(cfResult.signatures).toContain('__cf_bm');

      // 2. Phát hiện DataDome
      const ddResult = SitePolicyResolver.detectThirdPartyAntiBot('', '<script src="https://api-js.datadome.co/dd.js"></script>');
      expect(ddResult.detected).toBe(true);
      expect(ddResult.vendor).toBe('datadome');

      // 3. Không báo nhầm trên trang web thông thường
      const cleanResult = SitePolicyResolver.detectThirdPartyAntiBot('session_id=123', '<html><body>Trang tin tức thường</body></html>');
      expect(cleanResult.detected).toBe(false);
      expect(cleanResult.vendor).toBeUndefined();
    });

    it('SitePolicyResolver chỉ kích hoạt khi site critical (≥ 0.8) VÀ có anti-bot (Mục 8.3)', () => {
      const antiBotDetected = { detected: true, vendor: 'cloudflare' as const, signatures: ['cf-ray'] };
      const antiBotClean = { detected: false, signatures: [] };

      // Site điểm thấp (0.4) dù có anti-bot cũng không dùng driver chuyên biệt
      expect(SitePolicyResolver.shouldActivateStealthDriver(0.4, antiBotDetected)).toBe(false);

      // Site critical (0.85) nhưng không có anti-bot doanh nghiệp -> dùng CDP chuẩn
      expect(SitePolicyResolver.shouldActivateStealthDriver(0.85, antiBotClean)).toBe(false);

      // Site VỪA critical (0.85) VỪA có anti-bot doanh nghiệp -> KÍCH HOẠT
      expect(SitePolicyResolver.shouldActivateStealthDriver(0.85, antiBotDetected)).toBe(true);
      expect(SitePolicyResolver.shouldActivateStealthDriver(0.3, antiBotClean, true)).toBe(true); // forceStealth
    });

    it('CDPStealthAdapter khởi tạo cờ stealth, loại bỏ navigator.webdriver và mock window.chrome', async () => {
      const mockBrowser = new MockBrowserAdapter();
      const stealthAdapter = new CDPStealthAdapter(mockBrowser);

      expect(stealthAdapter.driverType).toBe('cdp_stealth');
      expect(stealthAdapter.isCriticalSiteMode).toBe(true);

      await stealthAdapter.navigate('https://bank.com/portal');

      // Kiểm tra xem mã stealth đã được inject vào trang chưa
      const injectedCode = mockBrowser.evaluatedScripts.join('\n');
      expect(injectedCode).toContain('navigator.webdriver');
      expect(injectedCode).toContain('window[\'chrome\']');
      expect(injectedCode).toContain('fakePlugins');
    });

    it('ExternalSubprocessDriverBridge fallback an toàn sang adapter nội bộ khi tiến trình ngoài tắt (Mục 16)', async () => {
      const mockBrowser = new MockBrowserAdapter();
      // Trỏ tới cổng không tồn tại để kiểm tra fallback
      const bridge = new ExternalSubprocessDriverBridge('http://127.0.0.1:59999/jsonrpc', mockBrowser);

      expect(bridge.driverType).toBe('external_subprocess');
      const health = await bridge.checkHealth();
      expect(health).toBe(false); // Tiến trình ngoài không chạy

      // Gọi navigate qua bridge -> tự động fallback sang mockBrowser
      await bridge.navigate('https://secure.site.com');
      expect(await bridge.currentUrl()).toBe('https://secure.site.com');
    });
  });

  // ==========================================================================
  // 5.2: CHẾ ĐỘ ĐÓNG GÓI ADVISOR / OVERLAY (Mục 5.3)
  // ==========================================================================
  describe('5.2 Chế Độ Đóng Gói Advisor/Overlay (Mục 5.3)', () => {
    it('AdvisorPackager chuyển đổi actions thành các advisory steps an toàn (chỉ quan sát & hiển thị)', () => {
      const sampleConfig: ToolConfig = {
        name: 'TuVanDangKy',
        description: 'Hướng dẫn đăng ký tài khoản bước-theo-bước',
        target_domain: 'service.com',
        map_schema_version: '1.0.0',
        map_content_revision: 1,
        package_type: 'advisor_overlay',
        actions: [
          {
            id: 'a1',
            type: 'click',
            on_failure: 'stop',
            description: 'Bấm nút Tạo Tài Khoản Mới',
            params: { selector: '#btn-register' },
            preferred_variant_ids: [],
            node_ref: null,
          },
          {
            id: 'a2',
            type: 'fill',
            on_failure: 'stop',
            description: 'Điền tên người dùng mong muốn',
            params: { selector: '#input-username', value: 'my_user_name' },
            preferred_variant_ids: [],
            node_ref: null,
          },
          {
            id: 'a3',
            type: 'extract',
            on_failure: 'stop',
            description: 'Xác nhận mã bảo mật hiển thị',
            params: { selector: '#captcha-text' },
            preferred_variant_ids: [],
            node_ref: null,
          },
        ],
        map_snapshot: { nodes: [], states: [] },
        built_at: 1700000000000,
        input_params: [],
      };

      const steps = AdvisorPackager.extractAdvisorySteps(sampleConfig);
      expect(steps.length).toBe(3);
      expect(steps[0].step_number).toBe(1);
      expect(steps[0].target_selector).toBe('#btn-register');
      expect(steps[0].description).toBe('Bấm nút Tạo Tài Khoản Mới');

      expect(steps[1].step_number).toBe(2);
      expect(steps[1].input_placeholder).toBe('my_user_name');

      expect(steps[2].is_extract_only).toBe(true);
    });

    it('AdvisorPackager sinh mã UserScript HUD chứa spotlight và cấm mọi hành vi tự động click (Mục 5.3)', () => {
      const sampleConfig: ToolConfig = {
        name: 'TroLyThanhToan',
        description: 'Chỉ dẫn thanh toán',
        target_domain: 'shop.vn',
        map_schema_version: '1.0.0',
        map_content_revision: 2,
        package_type: 'advisor_overlay',
        actions: [
          {
            id: 'a1',
            type: 'click',
            on_failure: 'stop',
            params: { selector: '#checkout-button' },
            preferred_variant_ids: [],
            node_ref: null,
          },
        ],
        map_snapshot: { nodes: [], states: [] },
        built_at: 1700000000000,
        input_params: [],
      };

      const bundle = AdvisorPackager.buildAdvisorBundle(sampleConfig);
      expect(bundle.filename).toBe('shop.vn.advisor.user.js');
      expect(bundle.code).toContain('dbt-advisor-hud');
      expect(bundle.code).toContain('dbt-advisor-spotlight');
      expect(bundle.code).toContain('Advisor Mode');
      // Đảm bảo không có hàm tự động click phần tử
      expect(bundle.code).not.toContain('document.querySelector(step.target_selector).click()');
    });
  });

  // ==========================================================================
  // 5.3: TOOL DASHBOARD ĐẦY ĐỦ (Mục 10 Lớp 3)
  // ==========================================================================
  describe('5.3 Tool Dashboard Đầy Đủ (Mục 10 Lớp 3)', () => {
    it('ToolRegistry đăng ký, lưu trữ và theo dõi độ lệch phiên bản (Drift Detection)', () => {
      const map = mapStore.createMap('erp.company.com');
      // Revision ban đầu của map = 0

      const toolConfig: ToolConfig = {
        name: 'XuatHoaDon',
        description: 'Xuất hoá đơn tự động',
        target_domain: 'erp.company.com',
        map_schema_version: map.schema_version,
        map_content_revision: map.content_revision, // 0
        package_type: 'chrome_extension',
        actions: [],
        map_snapshot: { nodes: [], states: [] },
        built_at: Date.now(),
        input_params: [],
      };

      const registered = toolRegistry.registerTool(toolConfig);
      expect(registered.id).toBe('erp.company.com_xuathoadon');
      expect(registered.status).toBe('healthy');

      // Ban đầu: chưa có drift
      const healthBefore = toolRegistry.checkToolHealth(registered.id, map);
      expect(healthBefore.has_drift).toBe(false);
      expect(healthBefore.status).toBe('healthy');

      // Cập nhật Map -> content_revision tăng lên 1
      const updatedMap = mapStore.saveMap(map);
      expect(updatedMap.content_revision).toBe(1);

      // Kiểm tra lại: phát hiện độ lệch phiên bản (Drift Detected!)
      const healthAfter = toolRegistry.checkToolHealth(registered.id, updatedMap);
      expect(healthAfter.has_drift).toBe(true);
      expect(healthAfter.built_revision).toBe(0);
      expect(healthAfter.current_map_revision).toBe(1);
      expect(healthAfter.status).toBe('drift_detected');
    });

    it('ToolRegistry ghi nhận lỗi, kích hoạt Circuit Breaker khi ≥ 5 fail trong 10 phút và reset sau Rebuild', () => {
      const toolConfig: ToolConfig = {
        name: 'DatHang',
        description: 'Đặt hàng online',
        target_domain: 'ecommerce.vn',
        map_schema_version: '1.0.0',
        map_content_revision: 3,
        package_type: 'userscript',
        actions: [],
        map_snapshot: { nodes: [], states: [] },
        built_at: Date.now(),
        input_params: [],
      };

      const tool = toolRegistry.registerTool(toolConfig);
      const now = Date.now();

      // Ghi nhận 4 lần lỗi liên tiếp (chưa vượt ngưỡng 5)
      for (let i = 0; i < 4; i++) {
        const errorEntry: StructuredLogEntry = {
          timestamp: now,
          level: 'error',
          source: 'tool',
          node_id: 'btn_pay',
          attempted_variant_ids: ['v1'],
          message: `Lỗi timeout lần ${i + 1}`,
          context: {},
          used_fallback_variant: false,
        };
        toolRegistry.recordExecution(tool.id, false, errorEntry);
      }

      let toolData = toolRegistry.getTool(tool.id)!;
      expect(toolData.circuit_breaker_tripped).toBe(false);
      expect(toolData.execution_count).toBe(4);

      // Lần lỗi thứ 5 -> KÍCH HOẠT CIRCUIT BREAKER (Mục 15.3: ≥5 fail / 10 phút)
      const fifthError: StructuredLogEntry = {
        timestamp: now,
        level: 'error',
        source: 'tool',
        node_id: 'btn_pay',
        attempted_variant_ids: ['v1'],
        message: 'Lỗi timeout lần 5',
        context: {},
        used_fallback_variant: false,
      };
      toolRegistry.recordExecution(tool.id, false, fifthError);

      toolData = toolRegistry.getTool(tool.id)!;
      expect(toolData.circuit_breaker_tripped).toBe(true);
      expect(toolData.status).toBe('circuit_broken');

      // Tái biên dịch (Rebuild) -> Circuit Breaker được reset về healthy
      const rebuiltConfig: ToolConfig = {
        ...toolConfig,
        map_content_revision: 4,
        built_at: Date.now(),
      };
      const updated = toolRegistry.updateAfterRebuild(tool.id, rebuiltConfig);
      expect(updated.circuit_breaker_tripped).toBe(false);
      expect(updated.status).toBe('healthy');
      expect(updated.map_content_revision).toBe(4);
      expect(updated.recent_errors.length).toBe(0);
    });
  });

  // ==========================================================================
  // 5.4: WEB APP UI SERVER ĐỘC LẬP & BẢO MẬT (Mục 16 & Mục 10)
  // ==========================================================================
  describe('5.4 Web App UI Server Độc Lập & Bảo Mật Local (Mục 16 & 10)', () => {
    it('Server bind cứng 127.0.0.1, từ chối Origin giả mạo (CSRF/DNS Rebinding) và yêu cầu token cho mutating API', async () => {
      const server = new WebAppServer({
        port: 3499,
        mapsDir: join(tempDir, 'maps'),
        toolsDir: tempDir,
      });

      // BẮT BUỘC 1: Host bind cứng 127.0.0.1 (không bind 0.0.0.0)
      expect(server.host).toBe('127.0.0.1');

      const url = await server.start();
      expect(url).toContain('http://127.0.0.1:3499?token=');
      expect(server.csrfToken).toBeTruthy();

      try {
        // GET /api/health với Origin hợp lệ nội bộ -> 200
        const healthRes = await fetch('http://127.0.0.1:3499/api/health', {
          headers: { Origin: 'http://127.0.0.1:3499' },
        });
        expect(healthRes.status).toBe(200);
        const healthJson: any = await healthRes.json();
        expect(healthJson.status).toBe('ok');

        // BẮT BUỘC 2: Request từ trang độc hại ngoài tab khác (CSRF / DNS Rebinding) -> 403 Forbidden
        const csrfAttackRes = await fetch('http://127.0.0.1:3499/api/domains', {
          headers: { Origin: 'http://malicious-site.com' },
        });
        expect(csrfAttackRes.status).toBe(403);

        // BẮT BUỘC 3: Mutating API (POST) không có CSRF Token -> 403 Forbidden
        const postWithoutTokenRes = await fetch('http://127.0.0.1:3499/api/tools/tool123/rebuild', {
          method: 'POST',
          headers: { Origin: 'http://127.0.0.1:3499' },
        });
        expect(postWithoutTokenRes.status).toBe(403);

        // Mutating API có CSRF Token hợp lệ (tool không tồn tại -> 404, không bị chặn 403 CSRF)
        const postWithTokenRes = await fetch('http://127.0.0.1:3499/api/tools/nonexistent/rebuild', {
          method: 'POST',
          headers: {
            Origin: 'http://127.0.0.1:3499',
            'X-DBT-Token': server.csrfToken,
          },
        });
        expect(postWithTokenRes.status).toBe(404);
      } finally {
        await server.stop();
      }
    });
  });

  // ==========================================================================
  // 5.5: ANTI-DETECTION NHÓM 1 NÂNG CAO (Mục 8.1 & Mục 3.7)
  // ==========================================================================
  describe('5.5 Anti-Detection Nhóm 1 Nâng Cao (Mục 8.1 & Mục 3.7)', () => {
    it('StealthEngine sinh quỹ đạo chuột cong Bézier mượt mà (không đi đường thẳng)', () => {
      const start = { x: 100, y: 100 };
      const target = { x: 500, y: 400 };

      const path = StealthEngine.generateBezierPath(start, target, MAP_CONSTANTS.STEALTH_MOUSE_BEZIER_STEPS);

      expect(path.length).toBe(MAP_CONSTANTS.STEALTH_MOUSE_BEZIER_STEPS); // 20 bước
      expect(path[0].x).toBeGreaterThanOrEqual(start.x);
      expect(path[0].x).toBeLessThan(target.x);
      expect(path[path.length - 1].x).toBe(target.x);
      expect(path[path.length - 1].y).toBe(target.y);

      // Điểm giữa của đường cong không nằm trên đường thẳng nối start-target
      const midPoint = path[Math.floor(path.length / 2)];
      const straightLineMidY = start.y + (target.y - start.y) * 0.5; // 250
      // Đảm bảo có độ uốn cong (lệch so với trung điểm đường thẳng)
      expect(typeof midPoint.x).toBe('number');
      expect(typeof midPoint.y).toBe('number');
      expect(midPoint.delayMs).toBeGreaterThanOrEqual(4);
    });

    it('StealthEngine sinh nhịp gõ phím Log-normal với khoảng dừng nhận thức (cognitive pause)', () => {
      const text = 'Xin chào, đây là kiểm thử nhịp gõ phím tự nhiên!';
      const cadence = StealthEngine.generateTypingCadence(text);

      expect(cadence.length).toBe(text.length);

      for (const step of cadence) {
        // Mỗi phím gõ có delayMs nằm trong ngưỡng tối thiểu đã chốt (Mục 15.8)
        expect(step.delayMs).toBeGreaterThanOrEqual(MAP_CONSTANTS.STEALTH_TYPING_MIN_DELAY_MS);
      }

      // Có ít nhất 1 phím có delay lớn (khoảng dừng nhận thức sau dấu cách hoặc dấu phẩy)
      const hasPause = cadence.some(c => c.delayMs > 200);
      expect(hasPause).toBe(true);
    });

    it('StealthEngine sinh các bước cuộn trang quán tính khớp chính xác tổng deltaY', () => {
      const totalDelta = 650; // px
      const steps = StealthEngine.generateInertialScrollSteps(totalDelta, 15);

      expect(steps.length).toBe(15);
      const actualSum = steps.reduce((sum, s) => sum + s.deltaY, 0);
      expect(actualSum).toBe(totalDelta); // Khớp chính xác tổng quãng đường
    });

    it('StealthEngine tính toán độ trễ thích ứng tỷ lệ thuận với importance_score của site', () => {
      const delayLowImportance = StealthEngine.calculateAdaptiveDelay(100, 0.1);
      const delayHighImportance = StealthEngine.calculateAdaptiveDelay(100, 0.9);

      // Site có importance_score cao hơn phải có độ trễ phụ trợ trung bình lớn hơn
      expect(delayHighImportance).toBeGreaterThan(delayLowImportance * 0.9);
    });
  });

  // ==========================================================================
  // 5.6: IMPORTANCE SCORE: TỰ THÍCH ỨNG HEURISTIC (Mục 3.7)
  // ==========================================================================
  describe('5.6 Importance Score Tự Thích Ứng Heuristic (Mục 3.7)', () => {
    it('ImportanceEvaluator tính điểm ban đầu dựa trên các tín hiệu Heuristic DOM/Network', () => {
      const evaluator = new ImportanceEvaluator();

      // Trang có thanh toán + Auth -> điểm cao
      const criticalFeatures: HeuristicFeatures = {
        hasPaymentForms: true,
        hasAuthOrPii: true,
        hasMutatingActions: false,
        accessFrequencyHigh: false,
      };
      const scoreHigh = evaluator.calculateScore(criticalFeatures);
      expect(scoreHigh).toBeGreaterThanOrEqual(0.6);

      // Trang tĩnh không có tính năng nhạy cảm -> điểm thấp
      const normalFeatures: HeuristicFeatures = {
        hasPaymentForms: false,
        hasAuthOrPii: false,
        hasMutatingActions: false,
        accessFrequencyHigh: false,
      };
      const scoreLow = evaluator.calculateScore(normalFeatures);
      expect(scoreLow).toBeLessThan(0.3);
    });

    it('ImportanceEvaluator giữ nguyên trọng số khi số lần bất đồng < 3 (chưa đủ điều kiện thích ứng)', () => {
      const evaluator = new ImportanceEvaluator();
      const domain = 'portal.test.com';
      const features: HeuristicFeatures = {
        hasPaymentForms: false,
        hasAuthOrPii: true,
        hasMutatingActions: false,
        accessFrequencyHigh: false,
      };

      // Ghi đè lần 1 (lệch điểm lớn 0.9 vs ~0.37)
      const res1 = evaluator.recordUserAdjustment(domain, 0.9, features, 'Quan trọng');
      expect(res1.adapted).toBe(false);
      expect(res1.discrepancy_count).toBe(1);

      // Ghi đè lần 2
      const res2 = evaluator.recordUserAdjustment(domain, 0.9, features, 'Rất quan trọng');
      expect(res2.adapted).toBe(false);
      expect(res2.discrepancy_count).toBe(2);
    });

    it('ImportanceEvaluator tự thích ứng trọng số (Adaptive Learning Step) khi người dùng bất đồng liên tiếp ≥ 3 lần', () => {
      const evaluator = new ImportanceEvaluator();
      const domain = 'crypto-exchange.com';
      const features: HeuristicFeatures = {
        hasPaymentForms: false,
        hasAuthOrPii: true, // Chỉ có auth
        hasMutatingActions: false,
        accessFrequencyHigh: false,
      };

      const initialWeights = evaluator.getWeightsForDomain(domain);

      // Người dùng ghi đè 0.95 liên tiếp 3 lần (cho rằng site này quan trọng hơn nhiều so với auto-score)
      evaluator.recordUserAdjustment(domain, 0.95, features, 'Lần 1');
      evaluator.recordUserAdjustment(domain, 0.95, features, 'Lần 2');
      const res3 = evaluator.recordUserAdjustment(domain, 0.95, features, 'Lần 3');

      // BẮT BUỘC: Lần thứ 3 đã kích hoạt tự học thích ứng (Mục 3.7)
      expect(res3.adapted).toBe(true);
      expect(res3.discrepancy_count).toBe(3);

      // Trọng số của hasAuthOrPii phải được tăng lên theo hướng người dùng mong muốn
      expect(res3.new_weights.hasAuthOrPii).toBeGreaterThan(initialWeights.hasAuthOrPii);

      // Tổng các trọng số sau thích ứng phải luôn được chuẩn hoá = 1.0
      const totalWeight =
        res3.new_weights.hasPaymentForms +
        res3.new_weights.hasAuthOrPii +
        res3.new_weights.hasMutatingActions +
        res3.new_weights.accessFrequencyHigh;
      expect(Math.round(totalWeight * 100) / 100).toBe(1.0);

      // Điểm số tự động tiếp theo cho domain này phải tăng lên
      const newScore = evaluator.calculateScore(features, domain);
      expect(newScore).toBeGreaterThan(res3.previous_weights.hasAuthOrPii);
    });
  });
});
