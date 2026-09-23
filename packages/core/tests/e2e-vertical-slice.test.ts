/**
 * E2E Vertical Slice Integration Test (Bước 4 trong Kế hoạch)
 *
 * Kiểm tra toàn bộ lát cắt dọc trên Browser thật:
 * 1. Đọc MapFile viết tay cho domain
 * 2. PlaywrightBrowserAdapter kết nối trình duyệt thật
 * 3. ExecutionEngine thực thi 5-step loop (Resolve → Verify → Act → Confirm → Fallback)
 * 4. Fill text thật vào input (xử lý prototype setter)
 * 5. Cố tình làm hỏng variant v1 để kiểm tra Fallback sang v2 trên DOM thật
 * 6. Element locator tìm phần tử bằng Tier 1 (Accessibility Tree) và Tier 2 (CSS query)
 * 7. Gây lỗi liên tiếp để kiểm tra CircuitBreaker ngắt thật trên browser thật
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import { ActionRegistry } from '../src/actions/primitives.js';
import { ExecutionEngine } from '../src/engine/executor.js';
import { MapStore } from '../src/map/store.js';
import { MAP_CONSTANTS, type MapFile, type Action } from '../src/map/schema.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>DevBrowserTool Real Browser Testbed</title>
</head>
<body>
  <h1 class="main-title">Example Domain</h1>
  <p>This is a testbed for the vertical slice of DevBrowserTool.</p>
  
  <form id="test-form" onsubmit="event.preventDefault(); document.getElementById('status').innerText = 'Submitted: ' + document.getElementById('query-input').value;">
    <label for="query-input">Search Query</label>
    <input id="query-input" name="q" placeholder="Type here..." />
    <button type="submit" id="submit-btn" role="button">Search</button>
  </form>

  <p id="status">Ready</p>
  <a id="info-link" href="https://example.com/more" role="link" aria-label="Learn more">Learn more</a>
</body>
</html>
`;

describe('Vertical Slice — Real Browser E2E', () => {
  let browser: Browser;
  let page: Page;
  let adapter: PlaywrightBrowserAdapter;
  let registry: ActionRegistry;
  let engine: ExecutionEngine;
  let store: MapStore;

  beforeAll(async () => {
    // Khởi chạy trình duyệt thật (Chrome/Chromium headless)
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    adapter = new PlaywrightBrowserAdapter(page);
    registry = ActionRegistry.createDefault();
    store = new MapStore(join(tmpdir(), 'dbt-e2e-maps-' + Date.now()));
    engine = new ExecutionEngine(registry, store);
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('thực thi lát cắt dọc: MapFile → Fallback v1→v2 → Tier 1 Accessibility → Fill & Click', async () => {
    // 1. Tải trang testbed
    await page.setContent(HTML_CONTENT);
    expect(await adapter.currentTitle()).toBe('DevBrowserTool Real Browser Testbed');

    // 2. Tạo MapFile viết tay chuẩn Mục 4
    const now = Date.now();
    const mapFile: MapFile = {
      schema_version: '1.0.0',
      content_revision: 1,
      domain: 'example.com',
      bundle_id: null,
      importance_score: 0.8,
      importance_source: 'user',
      created_at: now,
      updated_at: now,
      account_slots: {},
      state_graph: [],
      base_nodes: [
        // Node 1: Tiêu đề — v1 CỐ TÌNH SAI, v2 ĐÚNG
        {
          id: 'heading_title',
          type: 'dom_element',
          intent: 'Tiêu đề chính của trang',
          discovered_via: 'normal',
          requires_elevation: false,
          created_at: now,
          updated_at: now,
          variants: [
            {
              id: 'v1-broken-selector',
              value_formula: 'h1.non-existent-class-that-fails',
              confidence: 0.95,
              last_verified: now,
              fail_count_recent: 0,
              locale: null,
              created_at: now,
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            },
            {
              id: 'v2-correct-css',
              value_formula: 'h1.main-title',
              confidence: 0.90,
              last_verified: now,
              fail_count_recent: 0,
              locale: null,
              created_at: now,
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            },
          ],
        },
        // Node 2: Ô tìm kiếm
        {
          id: 'search_input',
          type: 'dom_element',
          intent: 'Ô nhập từ khoá tìm kiếm',
          discovered_via: 'normal',
          requires_elevation: false,
          created_at: now,
          updated_at: now,
          variants: [
            {
              id: 'v1-input-css',
              value_formula: 'input#query-input',
              confidence: 0.95,
              last_verified: now,
              fail_count_recent: 0,
              locale: null,
              created_at: now,
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            },
          ],
        },
        // Node 3: Nút submit
        {
          id: 'submit_btn',
          type: 'dom_element',
          intent: 'Nút submit tìm kiếm',
          discovered_via: 'normal',
          requires_elevation: false,
          created_at: now,
          updated_at: now,
          variants: [
            {
              id: 'v1-submit-css',
              value_formula: 'button#submit-btn',
              confidence: 0.95,
              last_verified: now,
              fail_count_recent: 0,
              locale: null,
              created_at: now,
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            },
          ],
        },
        // Node 4: Link — dùng Tier 1 (Accessibility Tree: role + aria-label)
        {
          id: 'learn_more_link',
          type: 'dom_element',
          intent: 'Liên kết tìm hiểu thêm',
          discovered_via: 'normal',
          requires_elevation: false,
          created_at: now,
          updated_at: now,
          variants: [
            {
              id: 'v1-accessibility-role',
              value_formula: 'role:link[name="Learn more"]',
              confidence: 0.92,
              last_verified: now,
              fail_count_recent: 0,
              locale: null,
              created_at: now,
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            },
          ],
        },
      ],
    };

    // 3. Định nghĩa chuỗi hành động Action[]:
    // a. Extract text tiêu đề (sẽ kích hoạt fallback từ v1 hỏng sang v2)
    // b. Fill input từ khoá
    // c. Click submit
    const actions: Action[] = [
      {
        id: 'act-1',
        type: 'extract',
        node_ref: 'heading_title',
        params: {},
        preferred_variant_ids: [],
        description: 'Trích xuất tiêu đề (test fallback)',
        on_failure: 'stop',
      },
      {
        id: 'act-2',
        type: 'fill',
        node_ref: 'search_input',
        params: { value: 'Antigravity AI Agent' },
        preferred_variant_ids: [],
        description: 'Điền từ khoá vào ô tìm kiếm',
        on_failure: 'stop',
      },
      {
        id: 'act-3',
        type: 'click',
        node_ref: 'submit_btn',
        params: {},
        preferred_variant_ids: [],
        description: 'Bấm nút submit',
        on_failure: 'stop',
      },
    ];

    // 4. Chạy chuỗi actions qua ExecutionEngine
    const result = await engine.execute(actions, mapFile, adapter);

    // Xác nhận toàn bộ tool chạy thành công
    expect(result.success).toBe(true);
    expect(result.steps.length).toBe(3);

    // Xác nhận Bước a (Extract): v1 hỏng → fallback sang v2 thành công
    const extractStep = result.steps[0];
    expect(extractStep.success).toBe(true);
    expect(extractStep.actionResult?.used_fallback).toBe(true); // Fallback đã được kích hoạt!
    const extractData = extractStep.actionResult?.data as { raw: string; sanitized: string };
    expect(extractData.raw).toBe('Example Domain');

    // Xác nhận có cảnh báo sớm (Mục 7 bước 5) trong logs cho heading_title
    const headingWarnLog = result.logs.find(
      (l) => l.node_id === 'heading_title' && l.level === 'warn'
    );
    expect(headingWarnLog).toBeDefined();
    expect(headingWarnLog?.message).toContain('non-primary variant');
    expect(headingWarnLog?.context['used_fallback_variant']).toBe(true);

    // Xác nhận Bước b & c (Fill & Click) thành công trên DOM thật
    const statusText = await adapter.evaluate<string>('document.getElementById("status").innerText');
    expect(statusText).toBe('Submitted: Antigravity AI Agent');

    // 5. Test Tier 1 Accessibility Tree click
    const clickAction = registry.get('click')!;
    const linkNode = mapFile.base_nodes.find((n) => n.id === 'learn_more_link')!;
    const clickRes = await clickAction.execute({
      browser: adapter,
      node: linkNode,
      currentVariant: linkNode.variants[0],
      params: {},
    });
    expect(clickRes.success).toBe(true);
  });

  it('kích hoạt Circuit Breaker ngắt thật khi fail liên tiếp trên browser thật', async () => {
    const now = Date.now();
    const mapFile: MapFile = {
      schema_version: '1.0.0',
      content_revision: 1,
      domain: 'example.com',
      bundle_id: null,
      importance_score: 0.5,
      importance_source: 'auto',
      created_at: now,
      updated_at: now,
      account_slots: {},
      state_graph: [],
      base_nodes: [
        {
          id: 'ghost_element',
          type: 'dom_element',
          intent: 'Phần tử ma không tồn tại',
          discovered_via: 'normal',
          requires_elevation: false,
          created_at: now,
          updated_at: now,
          variants: [
            {
              id: 'v1-broken',
              value_formula: '.completely-non-existent-selector-1',
              confidence: 0.9,
              last_verified: now,
              fail_count_recent: 0,
              locale: null,
              created_at: now,
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            },
            {
              id: 'v2-broken',
              value_formula: '.completely-non-existent-selector-2',
              confidence: 0.8,
              last_verified: now,
              fail_count_recent: 0,
              locale: null,
              created_at: now,
              ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            },
          ],
        },
      ],
    };

    // Tạo 6 action thất bại liên tiếp với on_failure: 'skip_and_continue'
    const actions: Action[] = Array.from({ length: 6 }, (_, i) => ({
      id: `act-fail-${i + 1}`,
      type: 'click' as const,
      node_ref: 'ghost_element',
      params: {},
      preferred_variant_ids: [],
      description: `Thao tác lỗi lần ${i + 1}`,
      on_failure: 'skip_and_continue' as const,
    }));

    // Chạy tool với engine mới để reset circuit breaker
    const freshEngine = new ExecutionEngine(registry, store);
    const result = await freshEngine.execute(actions, mapFile, adapter);

    // Kiểm tra Circuit Breaker:
    // - 5 lần đầu thử fallback cả 2 variants rồi thất bại
    // - Lần thứ 6: Circuit Breaker đã tripped và từ chối ngay trước khi chạy!
    const cbErrorLogs = result.logs.filter((l) => l.message.includes('Circuit breaker tripped'));
    expect(cbErrorLogs.length).toBeGreaterThan(0);
    expect(freshEngine.getCircuitBreaker().isTripped()).toBe(true);
  });
});
