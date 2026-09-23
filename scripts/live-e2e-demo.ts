/**
 * Live Real-World End-to-End Verification Script
 *
 * 1. Probes https://openfront.io/ using real Google Chrome to test enterprise anti-bot detection.
 * 2. Runs the full 5-step lifecycle on a live interactive web form (httpbin.org/forms/post):
 *    - Step 1: Live Discovery with StaticAnalyzer
 *    - Step 2: Map construction & storage in MapStore
 *    - Step 3: Tool Factory build (Chrome Extension MV3 + Advisor Bundle)
 *    - Step 4: Real execution on live page via ExecutionEngine + Playwright adapter
 *    - Step 5: Verification of live submission response & ToolRegistry health check
 */

import { chromium } from 'playwright';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  MapStore,
  ToolRegistry,
  ToolFactory,
  StaticAnalyzer,
  SitePolicyResolver,
  AdvisorPackager,
  ExecutionEngine,
  ActionRegistry,
  PlaywrightBrowserAdapter,
  type MapFile,
} from '@devbrowsertool/core';

async function runLiveVerification(): Promise<void> {
  console.log('================================================================');
  console.log('🚀 BẮT ĐẦU CHẠY THỰC TẾ A-Z TRÊN WEB THẬT BẰNG GOOGLE CHROME');
  console.log('================================================================\n');

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  try {
    // ------------------------------------------------------------------------
    // PHẦN 1: Thử nghiệm trên https://openfront.io/ (Site ngoài đời có Anti-Bot)
    // ------------------------------------------------------------------------
    console.log('🌐 [PHẦN 1] Kiểm tra thực tế trên: https://openfront.io/');
    const page1 = await browser.newPage();

    let responseStatus = 0;
    let responseHeaders: Record<string, string> = {};
    try {
      const response = await page1.goto('https://openfront.io/', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      responseStatus = response?.status() ?? 0;
      responseHeaders = response?.headers() ?? {};
    } catch (e: any) {
      console.log(`  ⚠️ Lỗi kết nối hoặc timeout: ${e.message}`);
    }

    const currentUrl = page1.url();
    const pageTitle = await page1.title().catch(() => '');
    const pageCookies = await page1.context().cookies('https://openfront.io/').catch(() => []);
    const cookieStr = pageCookies.map(c => `${c.name}=${c.value}`).join('; ');
    const pageContent = await page1.content().catch(() => '');

    console.log(`  - HTTP Status: ${responseStatus}`);
    console.log(`  - Page Title: "${pageTitle}"`);
    console.log(`  - Final URL: ${currentUrl}`);

    // Đưa vào SitePolicyResolver kiểm tra nhận diện Anti-Bot
    const antiBotCheck = SitePolicyResolver.detectThirdPartyAntiBot(
      cookieStr,
      pageContent,
      responseHeaders
    );

    console.log(`  - Kết quả Anti-Bot Detection:`);
    console.log(`    • Detected: ${antiBotCheck.detected ? '🚨 CÓ PHÁT HIỆN' : 'Không'}`);
    console.log(`    • Vendor: ${antiBotCheck.vendor || 'N/A'}`);
    console.log(`    • Signatures: [${antiBotCheck.signatures.join(', ')}]`);

    if (antiBotCheck.detected || pageTitle.includes('Just a moment') || responseStatus === 403) {
      console.log(`  💡 [KẾT QUẢ PHÂN TÍCH THEO SPEC MỤC 3.1 & 3.2]:`);
      console.log(`     Trang web được bảo vệ bởi Cloudflare Turnstile / Managed Challenge.`);
      console.log(`     Đúng theo quy định của Tháp: Khi gặp rào cản interactive bot challenge ngoài đời,`);
      console.log(`     hệ thống KHÔNG tấn công mù quáng mà kích hoạt "Chế độ xin Demo người dùng"`);
      console.log(`     hoặc kết nối qua profile đã đăng nhập của người dùng.`);
    }

    await page1.close();

    // ------------------------------------------------------------------------
    // PHẦN 2: Chạy toàn bộ chu trình Discovery -> Map -> Build -> Execute
    // trên Live Form (https://httpbin.org/forms/post)
    // ------------------------------------------------------------------------
    console.log('\n----------------------------------------------------------------');
    console.log('📝 [PHẦN 2] Chu trình hoàn chỉnh A-Z trên Live Form (httpbin.org)');
    console.log('----------------------------------------------------------------');

    const page2 = await browser.newPage();
    const adapter = new PlaywrightBrowserAdapter(page2);

    console.log('  1. Điều hướng tới https://httpbin.org/forms/post ...');
    await adapter.navigate('https://httpbin.org/forms/post');
    const formTitle = await adapter.evaluate<string>('document.title');
    console.log(`     ✅ Đã tải trang thành công. Tiêu đề: "${formTitle}"`);

    // BƯỚC 1: Discovery tự động từ live DOM bằng StaticAnalyzer
    console.log('\n  2. Chạy StaticAnalyzer bóc tách DOM tự động...');
    const staticResult = await StaticAnalyzer.analyzePage(adapter, 'https://httpbin.org/forms/post');
    console.log(`     - Số components tìm thấy: ${staticResult.candidate_nodes.length}`);

    // BƯỚC 2: Xây dựng MapFile chuẩn
    console.log('\n  3. Xây dựng MapFile và lưu vào MapStore...');
    const testMap: MapFile = {
      schema_version: '1.0.0',
      content_revision: 1,
      domain: 'httpbin.org',
      importance_score: 0.5,
      importance_source: 'auto',
      base_nodes: [
        {
          id: 'node-custname',
          type: 'dom_element',
          intent: 'Customer Name Input',
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: 'var-custname-name',
              value_formula: 'input[name="custname"]',
              confidence: 0.95,
              last_verified: Date.now(),
              ttl_ms: 86400000,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
            {
              id: 'var-custname-fallback',
              value_formula: 'form p:first-child input',
              confidence: 0.7,
              last_verified: Date.now(),
              ttl_ms: 86400000,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
          ],
        },
        {
          id: 'node-telephone',
          type: 'dom_element',
          intent: 'Telephone Input',
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: 'var-telephone',
              value_formula: 'input[name="custtel"]',
              confidence: 0.95,
              last_verified: Date.now(),
              ttl_ms: 86400000,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
          ],
        },
        {
          id: 'node-comments',
          type: 'dom_element',
          intent: 'Comments Area',
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: 'var-comments',
              value_formula: 'textarea[name="comments"]',
              confidence: 0.95,
              last_verified: Date.now(),
              ttl_ms: 86400000,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
          ],
        },
        {
          id: 'node-submit-btn',
          type: 'dom_element',
          intent: 'Submit Order Button',
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: 'var-submit-btn',
              value_formula: 'button, input[type="submit"]',
              confidence: 0.95,
              last_verified: Date.now(),
              ttl_ms: 86400000,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
          ],
        },
      ],
      state_graph: [
        {
          id: 'state-form-ready',
          match_key: {
            url_pattern: 'https://httpbin.org/forms/post',
            dom_fingerprint: 'form-ready',
            virtual_route: null,
          },
          preconditions: [],
          transitions: [
            {
              action_ref: 'act-submit',
              target_state_id: 'state-form-submitted',
            },
          ],
        },
        {
          id: 'state-form-submitted',
          match_key: {
            url_pattern: 'https://httpbin.org/post',
            dom_fingerprint: 'post-response',
            virtual_route: null,
          },
          preconditions: [],
          transitions: [],
        },
      ],
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    const mapsDir = join(homedir(), '.devbrowsertool', 'maps');
    const mapStore = new MapStore(mapsDir);
    mapStore.saveMap(testMap);
    console.log(`     ✅ Đã lưu Map cho domain "${testMap.domain}" vào MapStore (${mapsDir})`);

    // BƯỚC 3: Xây dựng và Đóng gói Tool (Chrome Extension MV3 + Advisor Bundle)
    console.log('\n  4. Đóng gói Tool bằng ToolFactory...');
    const factory = new ToolFactory();
    const outputDir = join(homedir(), '.devbrowsertool', 'tools', 'httpbin_order_tool');

    const buildResult = await factory.build(testMap, {
      tool_name: 'HttpBin_Order_Tool',
      output_dir: outputDir,
      package_type: 'chrome_extension',
      action_specs: [
        { intent: 'Customer Name Input', action_type: 'fill', on_failure: 'stop' },
        { intent: 'Telephone Input', action_type: 'fill', on_failure: 'stop' },
        { intent: 'Comments Area', action_type: 'fill', on_failure: 'stop' },
        { intent: 'Submit Order Button', action_type: 'click', on_failure: 'stop' },
      ],
      skip_dry_run: true,
    });

    if (!buildResult.success || !buildResult.tool_config) {
      throw new Error(`Build Tool thất bại: ${buildResult.error}`);
    }

    console.log(`     ✅ Đóng gói Extension MV3 thành công tại: ${outputDir}`);

    // Kiểm tra các files được sinh ra trong Extension
    const generatedFiles = readdirSync(outputDir);
    console.log(`     📦 Các file trong Extension: [${generatedFiles.join(', ')}]`);
    const manifestContent = JSON.parse(readFileSync(join(outputDir, 'manifest.json'), 'utf-8'));
    console.log(`     📄 Manifest V3 Version: ${manifestContent.manifest_version}, Name: "${manifestContent.name}"`);

    // Sinh thêm Advisor Overlay HUD script
    const advisorBundle = AdvisorPackager.buildAdvisorBundle(buildResult.tool_config);
    console.log(`     💡 Đã tạo Advisor Overlay: ${advisorBundle.filename} (${advisorBundle.steps.length} bước spotlight)`);

    // Đăng ký vào ToolRegistry
    const toolRegistry = new ToolRegistry(join(homedir(), '.devbrowsertool'));
    const registeredTool = toolRegistry.registerTool(buildResult.tool_config);
    console.log(`     📋 Đã ghi nhận Tool vào Registry: id=${registeredTool.id}, rev=${registeredTool.map_content_revision}`);

    // BƯỚC 4: Thực thi Tool trên Live Web bằng ExecutionEngine & PlaywrightBrowserAdapter
    console.log('\n  5. Thực thi tự động trên Live Browser qua ExecutionEngine (5-step loop)...');
    const registry = ActionRegistry.createDefault();
    const engine = new ExecutionEngine(registry, mapStore);

    const actionsToExecute: Action[] = [
      {
        id: 'act-fill-cust',
        type: 'fill',
        node_ref: 'node-custname',
        params: { value: 'Alice Walker' },
        on_failure: 'stop',
        preferred_variant_ids: ['var-custname-name'],
      },
      {
        id: 'act-fill-tele',
        type: 'fill',
        node_ref: 'node-telephone',
        params: { value: '+1-202-555-0143' },
        on_failure: 'stop',
        preferred_variant_ids: ['var-telephone'],
      },
      {
        id: 'act-fill-comments',
        type: 'fill',
        node_ref: 'node-comments',
        params: { value: 'Automated real order test via DevBrowserTool' },
        on_failure: 'stop',
        preferred_variant_ids: ['var-comments'],
      },
      {
        id: 'act-submit',
        type: 'click',
        node_ref: 'node-submit-btn',
        params: {},
        on_failure: 'stop',
        preferred_variant_ids: ['var-submit-btn'],
      },
    ];

    const execRes = await engine.execute(actionsToExecute, testMap, adapter);
    console.log(`     - Kết quả tổng thể: ${execRes.success ? '✅ THÀNH CÔNG' : '❌ THẤT BÀI'}`);
    console.log(`     - Số bước hoàn thành: ${execRes.steps.length}/${actionsToExecute.length}`);
    for (const step of execRes.steps) {
      console.log(`       • [${step.action.type}] ${step.action.id} -> ${step.success ? 'OK' : 'FAIL: ' + step.actionResult?.error}`);
    }

    // Chờ trang đích phản hồi
    await page2.waitForLoadState('networkidle');
    const postUrl = page2.url();
    const postBody = await adapter.evaluate<string>('document.body.innerText');
    console.log(`\n  6. Kết quả phản hồi từ máy chủ web thật:`);
    console.log(`     - Đích đến: ${postUrl}`);

    // Phân tích JSON phản hồi từ httpbin.org
    try {
      const parsed = JSON.parse(postBody);
      console.log(`     - Dữ liệu form nhận được trên máy chủ:`);
      console.log(`       • custname: "${parsed.form?.custname}"`);
      console.log(`       • tele: "${parsed.form?.tele}"`);
      console.log(`       • comments: "${parsed.form?.comments}"`);

      if (parsed.form?.custname === 'Alice Walker') {
        console.log('\n  🎉 [XÁC NHẬN]: DỮ LIỆU ĐÃ ĐƯỢC GỬI VÀ NHẬN CHÍNH XÁC TRÊN MÁY CHỦ THẬT!');
      }
    } catch {
      console.log(`     - Nội dung phản hồi: ${postBody.slice(0, 200)}...`);
    }

    // BƯỚC 5: Kiểm tra Tool Health & Drift Status trong ToolRegistry
    console.log('\n  7. Kiểm tra trạng thái sức khoẻ Tool trong Registry...');
    const health = toolRegistry.checkToolHealth(registeredTool.id, testMap);
    console.log(`     - Status: ${health.status}`);
    console.log(`     - Has Drift: ${health.has_drift}`);
    console.log(`     - Built Rev: ${health.built_revision} == Current Rev: ${health.current_map_revision}`);
    console.log(`     - Circuit Breaker Active: ${health.circuit_breaker_active}`);

    await page2.close();
  } finally {
    await browser.close();
  }

  console.log('\n================================================================');
  console.log('✅ HOÀN THÀNH BÀI TEST THỰC TẾ TRÊN WEB THẬT VÀ TRÌNH DUYỆT THẬT');
  console.log('================================================================');
}

runLiveVerification().catch(err => {
  console.error('❌ Lỗi trong quá trình chạy test thực tế:', err);
  process.exit(1);
});
