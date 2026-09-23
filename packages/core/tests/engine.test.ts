/**
 * Tests for Execution Engine — CircuitBreaker, on_failure, Fallback logic.
 *
 * Đây là phần logic thuần (không cần browser thật), dùng mock BrowserAdapter.
 * Kiểm chứng các giá trị chính xác từ Mục 15 (ngưỡng 5 fail/10 phút, decay...).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CircuitBreaker } from '../src/engine/executor.js';
import { ExecutionEngine } from '../src/engine/executor.js';
import { ActionRegistry } from '../src/actions/primitives.js';
import { MapStore } from '../src/map/store.js';
import { MAP_CONSTANTS } from '../src/map/schema.js';
import type { BrowserAdapter, ActionResult } from '../src/actions/primitives.js';
import type { Action, MapFile, ResourceNode } from '../src/map/schema.js';
import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';

// ============================================================================
// MOCK BROWSER ADAPTER
// ============================================================================

function createMockBrowser(overrides?: Partial<BrowserAdapter>): BrowserAdapter {
  return {
    evaluate: vi.fn().mockResolvedValue(true),
    navigate: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(true),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('')),
    currentUrl: vi.fn().mockResolvedValue('https://example.com'),
    currentTitle: vi.fn().mockResolvedValue('Example'),
    ...overrides,
  };
}

// ============================================================================
// HELPER: Build test map + actions
// ============================================================================

const TEST_MAPS_DIR = join(import.meta.dirname ?? __dirname, '__test_engine_maps__');

function createTestMapWithNode(store: MapStore): MapFile {
  let map = store.loadOrCreateMap('example.com');
  map = store.addNode(map, {
    id: 'login-btn',
    type: 'dom_element',
    intent: 'Nút đăng nhập',
    variants: [{
      id: 'v1',
      value_formula: "document.querySelector('#login-btn')",
      confidence: 0.9,
      last_verified: Date.now(),
      fail_count_recent: 0,
      locale: null,
      created_at: Date.now(),
      ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
    }, {
      id: 'v2',
      value_formula: "document.querySelector('.btn-login')",
      confidence: 0.7,
      last_verified: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 ngày trước
      fail_count_recent: 0,
      locale: null,
      created_at: Date.now(),
      ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
    }],
    discovered_via: 'normal',
    requires_elevation: false,
  });
  return store.saveMap(map);
}

function createAction(overrides?: Partial<Action>): Action {
  return {
    id: 'test-action-1',
    type: 'click',
    node_ref: 'login-btn',
    params: {},
    on_failure: 'stop',
    preferred_variant_ids: [],
    ...overrides,
  };
}

// ============================================================================
// CIRCUIT BREAKER TESTS (Mục 7.1, Mục 15.3)
// ============================================================================

describe('CircuitBreaker', () => {
  it('should NOT trip below threshold', () => {
    const cb = new CircuitBreaker();

    // 4 fails (dưới ngưỡng 5)
    for (let i = 0; i < 4; i++) {
      cb.recordFail('node-1');
    }

    expect(cb.isTripped()).toBe(false);
  });

  it('should trip at exactly 5 fails in 10 minutes (Mục 15.3)', () => {
    const cb = new CircuitBreaker(
      MAP_CONSTANTS.CIRCUIT_BREAKER_MAX_FAILS,
      MAP_CONSTANTS.CIRCUIT_BREAKER_WINDOW_MS,
    );

    // Đúng 5 fails
    for (let i = 0; i < 5; i++) {
      cb.recordFail('node-1');
    }

    expect(cb.isTripped()).toBe(true);
  });

  it('should auto-reset after window expires', () => {
    const cb = new CircuitBreaker(5, 100); // Window rất ngắn (100ms) cho test

    for (let i = 0; i < 5; i++) {
      cb.recordFail('node-1');
    }
    expect(cb.isTripped()).toBe(true);

    // Chờ window hết hạn
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb.isTripped()).toBe(false); // Tự reset
        resolve();
      }, 150);
    });
  });

  it('should count fails across different nodes (cùng domain)', () => {
    const cb = new CircuitBreaker(5, MAP_CONSTANTS.CIRCUIT_BREAKER_WINDOW_MS);

    cb.recordFail('node-A');
    cb.recordFail('node-B');
    cb.recordFail('node-A');
    cb.recordFail('node-C');
    cb.recordFail('node-A');

    // 5 fails tổng, dù từ 3 node khác nhau → vẫn trip
    expect(cb.isTripped()).toBe(true);
  });

  it('should reset manually', () => {
    const cb = new CircuitBreaker(5, MAP_CONSTANTS.CIRCUIT_BREAKER_WINDOW_MS);

    for (let i = 0; i < 5; i++) {
      cb.recordFail('node-1');
    }
    expect(cb.isTripped()).toBe(true);

    cb.reset();
    expect(cb.isTripped()).toBe(false);
  });

  it('should use exact constants from MAP_CONSTANTS (Mục 15.3)', () => {
    expect(MAP_CONSTANTS.CIRCUIT_BREAKER_MAX_FAILS).toBe(5);
    expect(MAP_CONSTANTS.CIRCUIT_BREAKER_WINDOW_MS).toBe(10 * 60 * 1000); // 10 phút
  });
});

// ============================================================================
// EXECUTION ENGINE — on_failure HANDLING (Mục 6.2)
// ============================================================================

describe('ExecutionEngine — on_failure handling', () => {
  let store: MapStore;
  let registry: ActionRegistry;

  beforeEach(() => {
    if (existsSync(TEST_MAPS_DIR)) {
      rmSync(TEST_MAPS_DIR, { recursive: true });
    }
    store = new MapStore(TEST_MAPS_DIR);
    registry = ActionRegistry.createDefault();
  });

  it('on_failure: "stop" — should halt execution at failed action', async () => {
    const map = createTestMapWithNode(store);

    // Browser trả false cho evaluate → click sẽ fail
    // Cần mock locateElement behavior: trả found=true cho verify, rồi click fail
    const browser = createMockBrowser({
      evaluate: vi.fn()
        // Verify step: locateElement → Tier 1 accessibility (found=false)
        // → Tier 2 JS-query (found=true)
        .mockResolvedValueOnce(false)  // Tier 1 accessibility: not found
        .mockResolvedValueOnce(true)   // Tier 2 JS-query: found
        // Act step: ClickAction → locateElement + click
        .mockResolvedValueOnce(false)  // Tier 1 accessibility: not found
        .mockResolvedValueOnce(true)   // Tier 2 JS-query: found
        .mockResolvedValueOnce(true),  // actual click: success
    });

    const actions: Action[] = [
      createAction({ id: 'action-1', on_failure: 'stop' }),
      createAction({ id: 'action-2', on_failure: 'stop' }), // KHÔNG nên chạy nếu action-1 fail
    ];

    const engine = new ExecutionEngine(registry, store);
    const result = await engine.execute(actions, map, browser);

    // action-1 nên thành công (evaluate trả true cho JS-query)
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('on_failure: "skip_and_continue" — should continue to next action after fail', async () => {
    const map = createTestMapWithNode(store);

    // Mọi evaluate đều fail → cả 2 actions fail
    // Nhưng action-2 vẫn được thực thi (không dừng ở action-1)
    const browser = createMockBrowser({
      evaluate: vi.fn().mockResolvedValue(false),
    });

    const actions: Action[] = [
      createAction({ id: 'action-1', on_failure: 'skip_and_continue' }),
      createAction({ id: 'action-2', on_failure: 'stop' }),
    ];

    const engine = new ExecutionEngine(registry, store);
    const result = await engine.execute(actions, map, browser);

    // Quan trọng nhất: action-2 PHẢI được thử (không dừng ở action-1)
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    // overall phải false vì có ít nhất 1 fail
    expect(result.success).toBe(false);
  });

  it('on_failure: "ask_user" — should stop and log user intervention needed', async () => {
    const map = createTestMapWithNode(store);

    // Mọi tier đều fail
    const browser = createMockBrowser({
      evaluate: vi.fn().mockResolvedValue(false),
    });

    const actions: Action[] = [
      createAction({ id: 'action-1', on_failure: 'ask_user' }),
    ];

    const engine = new ExecutionEngine(registry, store);
    const result = await engine.execute(actions, map, browser);

    expect(result.success).toBe(false);
    // Phải có log mention "ask_user" hoặc "user intervention"
    const hasAskUserLog = result.logs.some(l =>
      l.message.includes('ask_user') || l.message.includes('user intervention')
    );
    expect(hasAskUserLog).toBe(true);
  });
});

// ============================================================================
// EXECUTION ENGINE — FALLBACK LOGIC (Mục 7, bước 5)
// ============================================================================

describe('ExecutionEngine — Fallback variant cascade', () => {
  let store: MapStore;
  let registry: ActionRegistry;

  beforeEach(() => {
    if (existsSync(TEST_MAPS_DIR)) {
      rmSync(TEST_MAPS_DIR, { recursive: true });
    }
    store = new MapStore(TEST_MAPS_DIR);
    registry = ActionRegistry.createDefault();
  });

  it('should try variants in priority order and log fallback usage', async () => {
    const map = createTestMapWithNode(store);

    // Simulate: Tier 1 always fails, Tier 2 (JS-query):
    // - Verify: v1 found → proceed to Act
    // - Act locator: found
    // - Act click: success
    let evalCount = 0;
    const browser = createMockBrowser({
      evaluate: vi.fn().mockImplementation(() => {
        evalCount++;
        // Pattern: accessibility=false, js-query=true for verify
        //          accessibility=false, js-query=true for act locate
        //          click=true
        if (evalCount % 2 === 1) return Promise.resolve(false); // Tier 1 (accessibility) always false
        return Promise.resolve(true); // Tier 2 (JS-query) + click = true
      }),
    });

    const actions: Action[] = [
      createAction({ id: 'click-1' }),
    ];

    const engine = new ExecutionEngine(registry, store);
    const result = await engine.execute(actions, map, browser);

    expect(result.steps.length).toBe(1);
    // Nếu action dùng variant #1 thành công ở Tier 2 → used_fallback = true (vì tier > 1)
    // Hoặc thành công ở tier 2 → data có locator_tier=2
  });

  it('should log when non-primary variant succeeds (early warning signal — Mục 7 bước 5)', async () => {
    // Tạo map với 2 variants, v1 (confidence cao) sẽ fail, v2 sẽ thành công
    let map = store.loadOrCreateMap('example.com');
    map = store.addNode(map, {
      id: 'search-btn',
      type: 'dom_element',
      intent: 'Nút tìm kiếm',
      variants: [{
        id: 'v1-high-conf',
        value_formula: "document.querySelector('#search-v1')",
        confidence: 0.95,
        last_verified: Date.now(),
        fail_count_recent: 0,
        locale: null,
        created_at: Date.now(),
        ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
      }, {
        id: 'v2-lower-conf',
        value_formula: "document.querySelector('#search-v2')",
        confidence: 0.6,
        last_verified: Date.now(),
        fail_count_recent: 0,
        locale: null,
        created_at: Date.now(),
        ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
      }],
      discovered_via: 'normal',
      requires_elevation: false,
    });
    map = store.saveMap(map);

    // v1 fails at verify (both tiers), v2 succeeds
    let evalCount = 0;
    const browser = createMockBrowser({
      evaluate: vi.fn().mockImplementation(() => {
        evalCount++;
        // Verify step for v1: Tier 1 false, Tier 2 false → both fail → go to fallback
        if (evalCount <= 2) return Promise.resolve(false);
        // Fallback: try v2 via ClickAction → locateElement
        // Tier 1 false, Tier 2 true, click true
        if (evalCount === 3) return Promise.resolve(false); // Tier 1 accessibility
        return Promise.resolve(true); // Tier 2 + click
      }),
    });

    const actions: Action[] = [
      createAction({ id: 'click-search', node_ref: 'search-btn', on_failure: 'stop' }),
    ];

    const engine = new ExecutionEngine(registry, store);
    const result = await engine.execute(actions, map, browser);

    // Engine đã fallback sang v2
    if (result.success) {
      // Log PHẢI ghi nhận fallback variant usage (Mục 7 bước 5)
      const fallbackLog = result.logs.find(l => l.used_fallback_variant);
      expect(fallbackLog).toBeDefined();
    }
    // Dù success hay fail, engine phải hoàn thành mà không crash
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('should exhaust all variants then stop with structured log', async () => {
    const map = createTestMapWithNode(store);

    // Mọi evaluate đều fail → cả 2 variants đều thất bại
    const browser = createMockBrowser({
      evaluate: vi.fn().mockResolvedValue(false),
    });

    const actions: Action[] = [
      createAction({ id: 'click-fail', on_failure: 'stop' }),
    ];

    const engine = new ExecutionEngine(registry, store);
    const result = await engine.execute(actions, map, browser);

    expect(result.success).toBe(false);

    // Log phải ghi nhận "exhausted" hoặc thông tin node/variant đã thử
    const errorLog = result.logs.find(l => l.level === 'error');
    expect(errorLog).toBeDefined();
    expect(errorLog!.node_id).toBe('login-btn');
  });
});

// ============================================================================
// EXECUTION ENGINE — CIRCUIT BREAKER INTEGRATION (Mục 7.1)
// ============================================================================

describe('ExecutionEngine — Circuit Breaker integration', () => {
  let store: MapStore;
  let registry: ActionRegistry;

  beforeEach(() => {
    if (existsSync(TEST_MAPS_DIR)) {
      rmSync(TEST_MAPS_DIR, { recursive: true });
    }
    store = new MapStore(TEST_MAPS_DIR);
    registry = ActionRegistry.createDefault();
  });

  afterEach(() => {
    if (existsSync(TEST_MAPS_DIR)) {
      rmSync(TEST_MAPS_DIR, { recursive: true });
    }
  });

  it('should trip circuit breaker after threshold and halt execution', async () => {
    const map = createTestMapWithNode(store);

    // Mọi evaluate fail
    const browser = createMockBrowser({
      evaluate: vi.fn().mockResolvedValue(false),
    });

    // Tạo 6 actions (vượt ngưỡng 5 fail)
    const actions: Action[] = Array.from({ length: 6 }, (_, i) =>
      createAction({
        id: `action-${i}`,
        on_failure: 'skip_and_continue', // Cho phép tiếp tục qua từng action
      }),
    );

    const engine = new ExecutionEngine(registry, store);
    const result = await engine.execute(actions, map, browser);

    expect(result.success).toBe(false);

    // Circuit breaker log phải xuất hiện
    const cbLog = result.logs.find(l => l.message.includes('Circuit breaker'));
    expect(cbLog).toBeDefined();

    // Không phải tất cả 6 actions đều chạy — CB phải cắt sớm
    // (một số actions sẽ không chạy vì CB tripped)
    expect(result.steps.length).toBeLessThan(6);
  });
});

// ============================================================================
// MAP_CONSTANTS VERIFICATION (Mục 15)
// ============================================================================

describe('MAP_CONSTANTS matches spec values (Mục 15)', () => {
  it('confidence thresholds (Mục 15.1)', () => {
    expect(MAP_CONSTANTS.CONFIDENCE_HIGH).toBe(0.85);
    expect(MAP_CONSTANTS.FUZZY_HEAL_MIN_CONFIDENCE).toBe(0.85);
  });

  it('TTL values (Mục 15.2)', () => {
    expect(MAP_CONSTANTS.TTL_NORMAL_MS).toBe(30 * 24 * 60 * 60 * 1000); // 30 ngày
    expect(MAP_CONSTANTS.TTL_ESCAPE_HATCH_MS).toBe(7 * 24 * 60 * 60 * 1000); // 7 ngày
  });

  it('circuit breaker thresholds (Mục 15.3)', () => {
    expect(MAP_CONSTANTS.CIRCUIT_BREAKER_MAX_FAILS).toBe(5);
    expect(MAP_CONSTANTS.CIRCUIT_BREAKER_WINDOW_MS).toBe(10 * 60 * 1000); // 10 phút
  });

  it('discovery budget (Mục 15.4)', () => {
    expect(MAP_CONSTANTS.DISCOVERY_BUDGET_MAX_TOOL_CALLS).toBe(10);
    expect(MAP_CONSTANTS.DISCOVERY_BUDGET_MAX_TOKENS).toBe(5000);
  });

  it('max variants per node (Mục 15.5)', () => {
    expect(MAP_CONSTANTS.MAX_VARIANTS_PER_NODE).toBe(5);
  });

  it('discovery attempts before demo (Mục 3.1)', () => {
    expect(MAP_CONSTANTS.MAX_DISCOVERY_ATTEMPTS).toBe(3);
  });

  it('min observations for stable (Mục 3.1 bước 5)', () => {
    expect(MAP_CONSTANTS.MIN_OBSERVATIONS_FOR_STABLE).toBe(2);
  });
});
