/**
 * Phase 1 Discovery Engine Tests (Mục 1.1, 1.2, 1.3, 1.5, 1.6)
 *
 * Kiểm tra:
 * 1. StaticAnalyzer: quét sourcemaps và swagger/openapi
 * 2. ImportanceScorer: heuristic scoring + học điều chỉnh của user
 * 3. StateDiscoveryEngine: suy luận MatchKey, tiền điều kiện động, phân loại StateNode
 * 4. MapReverifier: tính toán decay theo thời gian/lỗi, kiểm chứng trên browser, culling
 * 5. DiscoveryLoop: kiểm soát ngân sách 10 calls / 5000 tokens, 3 lần thử, fallback Demo
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import { StaticAnalyzer } from '../src/discovery/static-analyzer.js';
import { ImportanceScorer } from '../src/discovery/importance-scorer.js';
import { StateDiscoveryEngine } from '../src/discovery/state-discovery.js';
import { MapReverifier } from '../src/discovery/reverifier.js';
import { DiscoveryLoop } from '../src/discovery/discovery-loop.js';
import { MapStore } from '../src/map/store.js';
import type { ResourceNode, Variant } from '../src/map/schema.js';
import { MAP_CONSTANTS } from '../src/map/schema.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const MOCK_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>E-Commerce Portal</title>
  <script src="/assets/app.js"></script>
</head>
<body>
  <header>
    <a href="/home" id="nav-home">Trang chủ</a>
    <a href="/products" id="nav-products">Sản phẩm</a>
    <button id="auth-login-btn" role="button">Đăng nhập tài khoản</button>
  </header>
  <main>
    <div class="product-item">
      <h3>Laptop Pro 2026</h3>
      <button id="add-to-cart-btn" class="btn-primary" role="button">Thêm vào giỏ</button>
      <button id="checkout-pay-btn" class="btn-danger" role="button">Thanh toán ngay</button>
    </div>
  </main>
  <footer>
    <a href="/terms" id="footer-terms">Điều khoản sử dụng</a>
    <a href="/privacy" id="footer-privacy">Chính sách bảo mật (PII)</a>
  </footer>
</body>
</html>
`;

describe('Phase 1 Discovery Engine', () => {
  let browser: Browser;
  let page: Page;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    await page.setContent(MOCK_HTML);
    adapter = new PlaywrightBrowserAdapter(page);
  });

  afterAll(async () => {
    await browser?.close();
  });

  describe('StaticAnalyzer (Mục 1.5)', () => {
    it('quét trang web và bóc tách các node ứng viên có sẵn từ DOM/scripts', async () => {
      const result = await StaticAnalyzer.analyzePage(adapter, 'https://shop.example.com');

      expect(result.has_source_maps).toBe(true);
      expect(result.source_map_urls.length).toBeGreaterThanOrEqual(1);
      expect(result.discovered_components).toContain('#auth-login-btn');
      expect(result.candidate_nodes.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('ImportanceScorer (Mục 1.6)', () => {
    it('đánh giá điểm quan trọng trang theo heuristic (thanh toán, auth, pii)', async () => {
      const scorer = new ImportanceScorer();
      const assessment = await scorer.assessPage(adapter);

      expect(assessment.score).toBeGreaterThan(0.5);
      expect(assessment.signals.has_payment).toBe(true);
      expect(assessment.signals.has_auth).toBe(true);
      expect(assessment.rationale.length).toBeGreaterThan(0);
    });

    it('học và tự cân chỉnh trọng số khi người dùng override nhiều lần (Mục 3.7)', () => {
      const scorer = new ImportanceScorer();
      const initialWeights = scorer.getWeights();

      // Giả lập 3 lần override liên tiếp cho cùng 1 domain với điểm người dùng cao hơn
      scorer.recordUserAdjustment('shop.example.com', 0.4, 0.9);
      scorer.recordUserAdjustment('shop.example.com', 0.4, 0.95);
      scorer.recordUserAdjustment('shop.example.com', 0.35, 0.85);

      const adjustedWeights = scorer.getWeights();
      expect(adjustedWeights.auth).toBeGreaterThanOrEqual(initialWeights.auth);
    });
  });

  describe('StateDiscoveryEngine (Mục 1.1)', () => {
    it('tổng hợp regex URL pattern từ dynamic path', () => {
      const pattern = StateDiscoveryEngine.synthesizeUrlPattern('/users/12345/orders/550e8400-e29b-41d4-a716-446655440000');
      expect(pattern).toBe('/users/:id/orders/:uuid');
    });

    it('sinh MatchKey ổn định từ quan sát trình duyệt', async () => {
      const matchKey = await StateDiscoveryEngine.captureMatchKey(adapter);

      expect(matchKey.dom_fingerprint).toBeDefined();
      expect(matchKey.dom_fingerprint?.length).toBeGreaterThan(6);
    });

    it('tự động phát hiện StateNode hiện tại', async () => {
      const stateNode = await StateDiscoveryEngine.discoverCurrentState(adapter, 'test_state');

      expect(stateNode.id).toContain('test_state');
      expect(stateNode.match_key).toBeDefined();
    });
  });

  describe('MapReverifier & Confidence Decay (Mục 1.3)', () => {
    it('tính toán điểm decay chính xác theo TTL và fail_count', () => {
      const now = Date.now();
      const freshVariant: Variant = {
        id: 'var_1',
        value_formula: '#btn',
        confidence: 0.95,
        last_verified: now - 1000,
        ttl_ms: 24 * 60 * 60 * 1000,
        fail_count_recent: 0,
        locale: null,
        created_at: now - 2000,
      };

      const freshScore = MapReverifier.computeDecayedScore(freshVariant, now);
      expect(freshScore).toBeCloseTo(0.95, 1);

      const staleVariant: Variant = {
        id: 'var_2',
        value_formula: '#btn',
        confidence: 0.95,
        last_verified: now - 20 * 24 * 60 * 60 * 1000,
        ttl_ms: 24 * 60 * 60 * 1000,
        fail_count_recent: 3,
        locale: null,
        created_at: now - 25 * 24 * 60 * 60 * 1000,
      };

      const staleScore = MapReverifier.computeDecayedScore(staleVariant, now);
      expect(staleScore).toBeLessThan(0.3);
    });

    it('kiểm chứng trên trình duyệt thật và loại bỏ variant hỏng (culling)', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-reverify-${Date.now()}`));
      let map = store.createMap('shop.example.com');

      const mockNode: ResourceNode = {
        id: 'btn_add_to_cart',
        intent: 'Thêm vào giỏ',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'var_valid',
            value_formula: "document.querySelector('#add-to-cart-btn')",
            confidence: 0.9,
            last_verified: Date.now(),
            ttl_ms: 86400000,
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
          },
          {
            id: 'var_culled',
            value_formula: "document.querySelector('#non-existent-999')",
            confidence: 0.1,
            last_verified: Date.now() - 10000000,
            ttl_ms: 1000,
            fail_count_recent: 4,
            locale: null,
            created_at: Date.now() - 20000000,
          },
        ],
      };

      map = store.addNode(map, mockNode);

      const report = await MapReverifier.reverifyMap(adapter, map, { forceAll: true });
      expect(report.nodes_checked).toBe(1);
      // Bước 1 Mục 3.11: Lần đầu, variant yếu bị DEGRADE (hạ ưu tiên), chưa bị xoá
      expect(report.variants_culled).toBe(0);
      expect(report.variants_decayed).toBe(1);
      expect(report.variants_verified).toBe(1);

      // Variant yếu đã bị đánh dấu degraded_at
      const degradedVariant = report.updated_map.base_nodes[0].variants.find(
        (v: any) => v.id === 'var_culled'
      );
      expect(degradedVariant).toBeDefined();
      expect((degradedVariant as any).degraded_at).toBeDefined();
      expect(degradedVariant!.confidence).toBe(MAP_CONSTANTS.CONFIDENCE_DEGRADED);

      // Bước 2 Mục 3.11: Reverify lần 2 sau khi degraded đủ lâu (>= TTL/2) → xoá hẳn
      // Giả lập variant đã degraded lâu hơn TTL/2 (TTL = 1000ms, degraded >= 500ms trước)
      const mapForCull = {
        ...report.updated_map,
        base_nodes: report.updated_map.base_nodes.map(n => ({
          ...n,
          variants: n.variants.map((v: any) =>
            v.id === 'var_culled'
              ? { ...v, degraded_at: Date.now() - 1000 } // Đã degraded 1s, vượt TTL/2=500ms
              : v
          ),
        })),
      };

      const report2 = await MapReverifier.reverifyMap(adapter, mapForCull, { forceAll: true });
      expect(report2.variants_culled).toBe(1); // Giờ mới thật sự bị xoá
    });

    it('rescue: variant degraded verify lại thành công → xoá degraded_at, confidence = RESCUED (Mục 3.11)', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-rescue-${Date.now()}`));
      let map = store.createMap('shop.example.com');

      // Variant đang trong trạng thái degraded nhưng selector thực ra vẫn hoạt động
      const rescuableNode: ResourceNode = {
        id: 'btn_rescue',
        intent: 'Nút có thể cứu',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants: [
          {
            id: 'var_rescuable',
            value_formula: "document.querySelector('#add-to-cart-btn')", // Selector hoạt động trên test DOM
            confidence: MAP_CONSTANTS.CONFIDENCE_DEGRADED,
            last_verified: Date.now() - 5000,
            ttl_ms: 86400000,
            fail_count_recent: 3,
            locale: null,
            created_at: Date.now() - 100000,
            degraded_at: Date.now() - 1000, // Đang degraded nhưng chưa qua TTL/2
          } as any,
        ],
      };

      map = store.addNode(map, rescuableNode);
      const report = await MapReverifier.reverifyMap(adapter, map, { forceAll: true });

      // Variant được "cứu" vì verify thành công trên browser
      expect(report.variants_verified).toBe(1);
      expect(report.variants_culled).toBe(0);

      const rescuedVariant = report.updated_map.base_nodes[0].variants[0];
      expect(rescuedVariant.confidence).toBe(MAP_CONSTANTS.CONFIDENCE_RESCUED); // 0.5, không phải 0.15
      expect(rescuedVariant.fail_count_recent).toBe(0);
      expect((rescuedVariant as any).degraded_at).toBeUndefined(); // Đã thoát degraded
    });

    it('variant degraded không tính vào giới hạn Max 5 variant/node (Mục 3.11)', () => {
      const store = new MapStore(join(tmpdir(), `dbt-limit-${Date.now()}`));
      let map = store.createMap('limit-test.com');

      // Tạo node với 4 variant active + 1 variant degraded = 5 tổng
      const variants: any[] = [];
      for (let i = 0; i < 4; i++) {
        variants.push({
          id: `var_active_${i}`,
          value_formula: `document.querySelector('#btn-${i}')`,
          confidence: 0.8,
          last_verified: Date.now(),
          ttl_ms: 86400000,
          fail_count_recent: 0,
          locale: null,
          created_at: Date.now(),
        });
      }
      variants.push({
        id: 'var_degraded',
        value_formula: "document.querySelector('#old-btn')",
        confidence: MAP_CONSTANTS.CONFIDENCE_DEGRADED,
        last_verified: Date.now() - 10000000,
        ttl_ms: 86400000,
        fail_count_recent: 4,
        locale: null,
        created_at: Date.now() - 20000000,
        degraded_at: Date.now() - 1000, // Đang degraded
      });

      const node: ResourceNode = {
        id: 'node_limit_test',
        intent: 'Test giới hạn variant',
        type: 'dom_element',
        created_at: Date.now(),
        updated_at: Date.now(),
        discovered_via: 'normal',
        requires_elevation: false,
        variants,
      };

      map = store.addNode(map, node);

      // Thêm variant mới — dù tổng đã = 5, nhưng active chỉ 4, nên ĐƯỢC thêm
      map = store.addVariant(map, 'node_limit_test', {
        value_formula: "document.querySelector('#new-btn')",
        confidence: 0.9,
        ttl_ms: 86400000,
      });

      const resultNode = map.base_nodes.find(n => n.id === 'node_limit_test')!;
      // Variant degraded bị thay thế bởi variant mới (ưu tiên thay degraded trước)
      const hasNewVariant = resultNode.variants.some(v => v.value_formula.includes('#new-btn'));
      const hasDegraded = resultNode.variants.some((v: any) => v.degraded_at);

      expect(hasNewVariant).toBe(true);
      expect(hasDegraded).toBe(false); // Variant degraded đã bị thay thế
    });
  });

  describe('DiscoveryLoop & Budget Controls (Mục 1.2)', () => {
    it('chặn ngay lập tức các hành động nhạy cảm và chuyển sang DemoRecorder', async () => {
      const loop = new DiscoveryLoop();
      const result = await loop.discoverAction(adapter, 'shop.example.com', {
        target_intent: 'Nhập mã thẻ tín dụng và thanh toán',
      });

      expect(result.success).toBe(false);
      expect(result.requires_user_demo).toBe(true);
      expect(result.reason).toContain('nhạy cảm');
    });

    it('khám phá thành công hành động thông thường và ghi nhận metrics ngân sách', async () => {
      const loop = new DiscoveryLoop();
      const result = await loop.discoverAction(adapter, 'shop.example.com', {
        target_intent: 'Thêm vào giỏ',
      });

      expect(result.tool_calls_used).toBeLessThanOrEqual(10);
      expect(result.tokens_used).toBeLessThanOrEqual(5000);
      expect(result.attempts_made).toBeLessThanOrEqual(3);
    });
  });
});
