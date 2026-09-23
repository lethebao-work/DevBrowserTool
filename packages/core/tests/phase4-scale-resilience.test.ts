/**
 * Phase 4 Tests — Scale & Resilience (Mục 3.1, 3.5, 3.10, 3.13, 4, 15.7)
 *
 * Kiểm tra toàn diện 7 hạng mục Phase 4:
 * 1. Source-first discovery: sourcemap parsing, endpoint extraction, candidate node creation (Mục 3.1 bước 1)
 * 2. Anti-debug pre-check: baseline động hiệu chuẩn phiên, loại trừ observer effect, phát hiện bẫy lặp (Mục 3.5 & 15.7)
 * 3. Reverse-engineering adapter: giải mã escape sequence, nhận diện obfuscation nặng (RC4, rotation), call graph, hook (Mục 3.5)
 * 4. Deep discovery 6 bước: Observe → Hook → Breakpoint → Rebuild → Patch → Pure-extraction (Mục 3.5)
 * 5. Multi-agent merge: tính xác định (determinism) của account-hash, auto-merge, gộp multi-variant khi mâu thuẫn (Mục 3.10)
 * 6. Site Bundle: tiêu chí giới hạn chặt chẽ (OAuth, iframe, khứ hồi <= 5 bước), loại trừ link rác (Mục 3.13 & 15.7)
 * 7. Map Export/Import: kiểm tra toàn vẹn dữ liệu SHA-256, sanitize URL, CẤM TUYỆT ĐỐI Tool (Mục 4 & Mục 2 nguyên tắc 1)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import {
  AntiDebugChecker,
  SourceFirstDiscovery,
  CdpReverseEngineeringAdapter,
  DeepDiscoveryEngine,
  type RawSourceMap,
} from '../src/discovery/index.js';
import {
  AccountScopingEngine,
  MultiAgentMergeEngine,
  SiteBundleManager,
  MapExportImportEngine,
  MapStore,
  MAP_CONSTANTS,
  type MapFile,
  type ResourceNode,
} from '../src/map/index.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PHASE4_TEST_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <title>Phase 4 Scale and Resilience Test</title>
</head>
<body>
  <h1>Phase 4 Test Page</h1>

  <div id="app">
    <button id="auth-btn">Authenticate via OAuth</button>
  </div>

  <script>
    // Runtime functions for CallGraph and Hook testing
    window.UserAuthModule = {
      login: function(username, password) {
        return window.UserAuthModule.verifyToken('mock_token_123');
      },
      verifyToken: function(token) {
        return token === 'mock_token_123';
      },
      userState: {
        isAuthenticated: true,
        role: 'editor',
      }
    };
  </script>
</body>
</html>
`;

const ANTI_DEBUG_TRAP_PAGE = `
<!DOCTYPE html>
<html>
<head><title>Anti-debug Trap</title></head>
<body>
  <script>
    // Bẫy debugger lặp
    setInterval(function() {
      // debugger;
    }, 100);
    // Timing check
    const start = performance.now();
    const diff = performance.now() - start;
  </script>
</body>
</html>
`;

describe('Phase 4 — Scale & Resilience (Mục 3.1, 3.5, 3.10, 3.13, 4, 15.7)', () => {
  let browser: Browser;
  let page: Page;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    await page.setContent(PHASE4_TEST_PAGE);
    adapter = new PlaywrightBrowserAdapter(page);
  });

  afterAll(async () => {
    await browser?.close();
  });

  // ==========================================================================
  // 1. Source-First Discovery (Mục 3.1 bước 1 & 15.7)
  // ==========================================================================
  describe('SourceFirstDiscovery (Mục 3.1 bước 1)', () => {
    it('giải mã raw sourcemap và bóc tách các file nguồn ảo', () => {
      const mockSourceMap: RawSourceMap = {
        version: 3,
        file: 'bundle.js',
        sources: ['src/api/auth.ts', 'src/components/LoginButton.tsx'],
        sourcesContent: [
          `export const loginApi = (data) => fetch('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(data) });
           export const getUserProfile = () => fetch('/api/v1/user/profile');`,
          `export function LoginButton() { return <button onClick={loginApi}>Login</button>; }`,
        ],
      };

      const files = SourceFirstDiscovery.parseSourceMapContent(mockSourceMap);
      expect(files.length).toBe(2);
      expect(files[0].path).toBe('src/api/auth.ts');
      expect(files[0].content).toContain('/api/v1/auth/login');

      const endpoints = SourceFirstDiscovery.extractEndpointsFromFiles(files);
      expect(endpoints.length).toBe(2);
      expect(endpoints.some((e) => e.path === '/api/v1/auth/login')).toBe(true);
      expect(endpoints.some((e) => e.path === '/api/v1/user/profile')).toBe(true);

      const components = SourceFirstDiscovery.extractComponentsFromFiles(files);
      expect(components.length).toBe(1);
      expect(components[0].name).toBe('LoginButton');
      expect(components[0].roleHint).toBe('button');
    });

    it('tạo ResourceNodes chuẩn từ sourcemap lộ ra với confidence 0.95 và TTL 30 ngày (Mục 3.1 & 15.2)', () => {
      const endpoints = [
        { method: 'POST', path: '/api/v2/reports/export', sourceFile: 'src/reports.ts' },
      ];
      const components = [{ name: 'ExportBtn', roleHint: 'button', sourceFile: 'src/ui.tsx' }];

      const nodes = SourceFirstDiscovery.buildNodesFromExtracted(endpoints, components, 'app.example.com');
      expect(nodes.length).toBe(1);
      expect(nodes[0].type).toBe('endpoint');
      expect(nodes[0].discovered_via).toBe('normal');
      expect(nodes[0].variants[0].confidence).toBe(0.95);
      expect(nodes[0].variants[0].ttl_ms).toBe(MAP_CONSTANTS.TTL_NORMAL_MS); // 30 ngày
    });
  });

  // ==========================================================================
  // 2. Anti-Debug Pre-Check (Mục 3.5 & 15.7)
  // ==========================================================================
  describe('AntiDebugChecker (Mục 3.5 & 15.7)', () => {
    it('hiệu chuẩn baseline động và xác nhận proceed khi trang không có bẫy', async () => {
      const result = await AntiDebugChecker.check(adapter);
      expect(result.hasAntiDebug).toBe(false);
      expect(result.riskLevel).toBe('none');
      expect(result.recommendation).toBe('proceed');
      // Baseline động được đo lường thực tế trong cùng context
      expect(result.baselineTimingMs).toBeGreaterThan(0);
      expect(result.timingRatio).toBeLessThan(MAP_CONSTANTS.ANTI_DEBUG_TIMING_RATIO_THRESHOLD);
      expect(result.cdpObserverEffectDetected).toBe(true);
    });

    it('phát hiện và cảnh báo abort khi trang chứa bẫy debugger setInterval loop', async () => {
      const trapPage = await browser.newPage();
      await trapPage.setContent(ANTI_DEBUG_TRAP_PAGE);
      const trapAdapter = new PlaywrightBrowserAdapter(trapPage);

      const result = await AntiDebugChecker.check(trapAdapter);
      expect(result.hasAntiDebug).toBe(true);
      expect(result.riskLevel).toBe('high');
      expect(result.recommendation).toBe('abort');
      expect(result.details.reason).toContain('Tuyệt đối không can thiệp Breakpoint');

      await trapPage.close();
    });
  });

  // ==========================================================================
  // 3. Reverse-Engineering Adapter (Mục 3.5)
  // ==========================================================================
  describe('Reverse-Engineering Adapter (Mục 3.5)', () => {
    it('giải mã các ký tự escape hex và unicode literals thông thường', async () => {
      const reverser = new CdpReverseEngineeringAdapter();
      const codeWithEscapes = `var secret = "\\x68\\x65\\x6c\\x6c\\x6f\\x5f\\x77\\x6f\\x72\\x6c\\x64"; var title = "\\u0044\\u0065\\u0076";`;

      const result = await reverser.deobfuscate(codeWithEscapes);
      expect(result.decodedEscapeSequencesCount).toBe(2);
      expect(result.deobfuscatedCode).toContain('hello_world');
      expect(result.deobfuscatedCode).toContain('Dev');
      expect(result.detectedObfuscations).toContain('hex_escape_sequences');
      expect(result.detectedObfuscations).toContain('unicode_escape_sequences');
      expect(result.isHeavyObfuscationDetected).toBe(false);
      expect(result.requiresSpecializedMcp).toBe(false);
    });

    it('nhận diện obfuscation nặng (RC4, string rotation, control flow) và báo cờ requiresSpecializedMcp', async () => {
      const reverser = new CdpReverseEngineeringAdapter();
      const heavyCode = `
        var _0x1a2b = ['aW5wdXQ=', 'c3VibWl0'];
        (function(_0xarr, _0xnum) {
          var _0xrot = function(_0xn) { while(--_0xn) { _0xarr.push(_0xarr.shift()); } };
          _0xrot(++_0xnum);
        }(_0x1a2b, 0x1f4));
        function _0xrc4(key, str) { /* rc4 payload cipher */ return atob(str); }
        while(!![]) {
          switch(_0x1a2b[0]) {
            case '1': break;
          }
        }
      `;

      const result = await reverser.deobfuscate(heavyCode);
      expect(result.isHeavyObfuscationDetected).toBe(true);
      expect(result.requiresSpecializedMcp).toBe(true);
      expect(result.recommendation).toBe('delegate_to_mcp_or_halt');
      expect(result.unsupportedHeavyFeatures).toContain('string_array_rotation');
      expect(result.unsupportedHeavyFeatures).toContain('control_flow_flattening');
      expect(result.unsupportedHeavyFeatures).toContain('rc4_payload_cipher');
    });

    it('phân tích call graph từ hàm runtime', async () => {
      const reverser = new CdpReverseEngineeringAdapter();
      const graph = await reverser.analyzeCallGraph(adapter, 'UserAuthModule.login');

      expect(graph.found).toBe(true);
      expect(graph.isNative).toBe(false);
      expect(graph.callees.length).toBeGreaterThan(0);
    });

    it('inject hook vào hàm runtime và ghi nhận lời gọi hàm', async () => {
      const reverser = new CdpReverseEngineeringAdapter();
      const hookRes = await reverser.injectHook(adapter, 'UserAuthModule.verifyToken', 'hook_verify_token');

      expect(hookRes.success).toBe(true);

      // Kích hoạt hàm trên trang
      await page.evaluate(() => {
        (window as any).UserAuthModule.login('admin', 'secret');
      });

      // Kiểm tra hook đã ghi nhận lời gọi
      const calls = await page.evaluate(() => {
        return (window as any).__devBrowserTool_hooks_calls__['hook_verify_token'];
      });
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0].argsSummary[0]).toBe('mock_token_123');
    });

    it('kiểm tra trạng thái memory object an toàn', async () => {
      const reverser = new CdpReverseEngineeringAdapter();
      const mem = await reverser.inspectMemoryState(adapter, 'UserAuthModule.userState.role');

      expect(mem.exists).toBe(true);
      expect(mem.value).toBe('editor');
    });
  });

  // ==========================================================================
  // 4. Deep Discovery 6 Bước (Mục 3.5)
  // ==========================================================================
  describe('DeepDiscoveryEngine (Mục 3.5)', () => {
    it('thực thi quy trình 6 bước Observe → Hook → Breakpoint → Rebuild → Patch → Pure-extraction', async () => {
      const result = await DeepDiscoveryEngine.execute(adapter, {
        targetIntent: 'Trích xuất trạng thái phiên đăng nhập',
        targetObjectPath: 'UserAuthModule.userState',
        targetFunctionPath: 'UserAuthModule.verifyToken',
      });

      expect(result.success).toBe(true);
      expect(result.stepsCompleted.length).toBe(6);
      expect(result.discoveredNode).toBeDefined();
      expect(result.discoveredNode?.intent).toBe('Trích xuất trạng thái phiên đăng nhập');
      expect(result.discoveredVariant?.confidence).toBe(0.85);
      expect(result.pureExtractionFormula).toContain('UserAuthModule.userState');
    });

    it('từ chối chạy sâu và dừng an toàn khi gặp trang anti-debug nguy hiểm (Mục 3.5 & Mục 2 nguyên tắc 3)', async () => {
      const trapPage = await browser.newPage();
      await trapPage.setContent(ANTI_DEBUG_TRAP_PAGE);
      const trapAdapter = new PlaywrightBrowserAdapter(trapPage);

      const result = await DeepDiscoveryEngine.execute(trapAdapter, {
        targetIntent: 'Dò tìm dữ liệu nhạy cảm',
        targetFunctionPath: 'window.eval',
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain('DỪNG quy trình khám phá sâu');
      expect(result.reason).toContain('anti-debug');

      await trapPage.close();
    });
  });

  // ==========================================================================
  // 5. Multi-Agent Merge Engine (Mục 3.10)
  // ==========================================================================
  describe('MultiAgentMergeEngine (Mục 3.10)', () => {
    it('tính xác định (determinism) của account-hash giữa 2 agent độc lập trên cùng thông tin tài khoản', () => {
      const userIdentity = 'User_9921_Alpha@Example.com';
      const domain = 'saas.app.com';

      // Giả lập Agent 1 chạy ở tiến trình / session A
      const hashFromAgent1 = AccountScopingEngine.generateAccountHash(userIdentity, domain);

      // Giả lập Agent 2 chạy ở tiến trình / session B độc lập
      const hashFromAgent2 = AccountScopingEngine.generateAccountHash(userIdentity, domain);

      // BẮT BUỘC: Namespace tag phải là hằng số cố định, TUYỆT ĐỐI KHÔNG ngẫu nhiên
      expect(AccountScopingEngine.ACCOUNT_HASH_NAMESPACE_TAG).toBe('dbt_account_scope_v1');
      // BẮT BUỘC: 2 hash phải giống hệt nhau (tính xác định / determinism)
      expect(hashFromAgent1).toBe(hashFromAgent2);
      expect(hashFromAgent1).toMatch(/^acc_[a-f0-9]{16}$/);

      // Khi merge 2 map có cùng account slot hash, merge engine phải gộp đúng slot
      const map1 = {
        domain,
        base_nodes: [],
        account_slots: {
          [hashFromAgent1]: {
            account_hash: hashFromAgent1,
            delta_nodes: [
              {
                id: 'd1',
                intent: 'Menu cá nhân',
                type: 'dom_element',
                variants: [{ id: 'v1', value_formula: '#menu', confidence: 0.8, last_verified: 100, fail_count_recent: 0, locale: null, created_at: 100, ttl_ms: 1000 }],
                discovered_via: 'normal',
                requires_elevation: false,
                created_at: 100,
                updated_at: 100,
              },
            ],
          },
        },
        content_revision: 1,
        schema_version: '1.0.0',
        bundle_id: null,
        importance_score: 0.5,
        importance_source: 'auto',
        state_graph: [],
        created_at: 100,
        updated_at: 100,
      } as MapFile;

      const map2 = {
        domain,
        base_nodes: [],
        account_slots: {
          [hashFromAgent2]: {
            account_hash: hashFromAgent2,
            delta_nodes: [
              {
                id: 'd2',
                intent: 'Thanh toán riêng',
                type: 'dom_element',
                variants: [{ id: 'v2', value_formula: '#pay', confidence: 0.9, last_verified: 200, fail_count_recent: 0, locale: null, created_at: 200, ttl_ms: 1000 }],
                discovered_via: 'normal',
                requires_elevation: false,
                created_at: 200,
                updated_at: 200,
              },
            ],
          },
        },
        content_revision: 2,
        schema_version: '1.0.0',
        bundle_id: null,
        importance_score: 0.5,
        importance_source: 'auto',
        state_graph: [],
        created_at: 200,
        updated_at: 200,
      } as MapFile;

      const merged = MultiAgentMergeEngine.merge(map1, map2);
      expect(Object.keys(merged.mergedMap.account_slots).length).toBe(1);
      expect(merged.mergedMap.account_slots[hashFromAgent1].delta_nodes.length).toBe(2);
    });

    it('tự động merge các node không mâu thuẫn và gộp multi-variant khi có mâu thuẫn giữa 2 agent', () => {
      const targetMap: MapFile = {
        schema_version: '1.0.0',
        content_revision: 1,
        domain: 'app.example.com',
        bundle_id: null,
        importance_score: 0.5,
        importance_source: 'auto',
        base_nodes: [
          {
            id: 'node_submit_btn',
            type: 'dom_element',
            intent: 'Nút gửi dữ liệu',
            variants: [
              {
                id: 'v1_agent1',
                value_formula: 'button#submit',
                confidence: 0.8,
                last_verified: 1000,
                fail_count_recent: 0,
                locale: null,
                created_at: 1000,
                ttl_ms: 86400000,
              },
            ],
            discovered_via: 'normal',
            requires_elevation: false,
            created_at: 1000,
            updated_at: 1000,
          },
        ],
        account_slots: {},
        state_graph: [],
        created_at: 1000,
        updated_at: 1000,
      };

      const sourceMap: MapFile = {
        schema_version: '1.0.0',
        content_revision: 2,
        domain: 'app.example.com',
        bundle_id: null,
        importance_score: 0.5,
        importance_source: 'auto',
        base_nodes: [
          // Node 1: Mâu thuẫn công thức (Agent 2 tìm ra formula khác)
          {
            id: 'node_submit_btn',
            type: 'dom_element',
            intent: 'Nút gửi dữ liệu',
            variants: [
              {
                id: 'v2_agent2',
                value_formula: 'form button[type="submit"]', // Khác công thức!
                confidence: 0.9,
                last_verified: 2000,
                fail_count_recent: 0,
                locale: null,
                created_at: 2000,
                ttl_ms: 86400000,
              },
            ],
            discovered_via: 'normal',
            requires_elevation: false,
            created_at: 2000,
            updated_at: 2000,
          },
          // Node 2: Node mới hoàn toàn do Agent 2 phát hiện
          {
            id: 'node_cancel_btn',
            type: 'dom_element',
            intent: 'Nút huỷ bỏ',
            variants: [
              {
                id: 'v_cancel',
                value_formula: 'button#cancel',
                confidence: 0.85,
                last_verified: 2000,
                fail_count_recent: 0,
                locale: null,
                created_at: 2000,
                ttl_ms: 86400000,
              },
            ],
            discovered_via: 'normal',
            requires_elevation: false,
            created_at: 2000,
            updated_at: 2000,
          },
        ],
        account_slots: {},
        state_graph: [],
        created_at: 2000,
        updated_at: 2000,
      };

      const result = MultiAgentMergeEngine.merge(targetMap, sourceMap);

      expect(result.success).toBe(true);
      expect(result.stats.nodesAdded).toBe(1); // Thêm node_cancel_btn
      expect(result.stats.conflictsResolvedAsVariants).toBe(1); // Gộp multi-variant cho node_submit_btn

      const submitNode = result.mergedMap.base_nodes.find((n) => n.id === 'node_submit_btn');
      expect(submitNode?.variants.length).toBe(2);
      expect(submitNode?.variants.some((v) => v.value_formula === 'button#submit')).toBe(true);
      expect(submitNode?.variants.some((v) => v.value_formula === 'form button[type="submit"]')).toBe(true);
    });

    it('từ chối merge 2 MapFile khác domain', () => {
      const mapA = { domain: 'alpha.com' } as MapFile;
      const mapB = { domain: 'beta.com' } as MapFile;

      expect(() => MultiAgentMergeEngine.merge(mapA, mapB)).toThrow('Không thể merge 2 MapFile khác domain');
    });
  });

  // ==========================================================================
  // 6. Site Bundle Manager (Mục 3.13 & 15.7)
  // ==========================================================================
  describe('SiteBundleManager (Mục 3.13 & 15.7)', () => {
    it('kiểm tra tiêu chí giới hạn Site Bundle: chấp nhận OAuth/iframe/khứ hồi, từ chối link ngoài ngẫu nhiên', () => {
      // 1. Chấp nhận OAuth redirect URL
      const oauthCheck = SiteBundleManager.checkEligibility('store.com', 'auth.id.com', {
        targetUrl: 'https://auth.id.com/oauth/authorize?client_id=123&redirect_uri=https://store.com/callback&state=xyz',
      });
      expect(oauthCheck.eligible).toBe(true);
      expect(oauthCheck.reason).toBe('oauth_sso_parameters');

      // 2. Chấp nhận Iframe nhúng
      const iframeCheck = SiteBundleManager.checkEligibility('store.com', 'checkout.com', {
        isIframe: true,
      });
      expect(iframeCheck.eligible).toBe(true);
      expect(iframeCheck.reason).toBe('embedded_iframe');

      // 3. Chấp nhận chuỗi khứ hồi quay lại trong <= 5 bước
      const returnCheck = SiteBundleManager.checkEligibility('store.com', 'partner.com', {
        stepsAway: 3,
      });
      expect(returnCheck.eligible).toBe(true);
      expect(returnCheck.reason).toBe('round_trip_return');

      // 4. Từ chối click link ngoài ngẫu nhiên (quảng cáo, tin tức)
      const randomLinkCheck = SiteBundleManager.checkEligibility('store.com', 'news.portal.com', {
        targetUrl: 'https://news.portal.com/article/tech-today',
        stepsAway: 15, // Quá xa
      });
      expect(randomLinkCheck.eligible).toBe(false);
      expect(randomLinkCheck.reason).toBe('ineligible_external_link');

      const manager = new SiteBundleManager();
      expect(() => {
        manager.createOrLinkBundle('store.com', 'news.portal.com', undefined, randomLinkCheck);
      }).toThrow('Từ chối tạo Site Bundle');
    });

    it('tạo và liên kết nhiều domain trong một Site Bundle mà không sở hữu chéo dữ liệu', () => {
      const manager = new SiteBundleManager();
      const bundle = manager.createOrLinkBundle('store.example.com', 'auth.identity.com', 'E-commerce & SSO');

      expect(bundle.bundle_id).toBeDefined();
      expect(bundle.linked_domains).toContain('store.example.com');
      expect(bundle.linked_domains).toContain('auth.identity.com');

      // Đăng ký cross domain transition (OAuth flow)
      const transOk = manager.registerCrossDomainTransition(bundle.bundle_id, {
        source_domain: 'store.example.com',
        source_state_id: 'state_cart',
        target_domain: 'auth.identity.com',
        target_state_id: 'state_oauth_login',
        action_intent: 'Đăng nhập OAuth chuyển trang',
      });
      expect(transOk).toBe(true);

      // Đăng ký iframe pointer reference
      const iframeOk = manager.registerIframeReference(bundle.bundle_id, {
        host_domain: 'store.example.com',
        iframe_domain: 'payment.checkout.com',
        container_selector: 'iframe#secure-payment',
      });
      expect(iframeOk).toBe(true);

      const found = manager.findBundleForDomain('auth.identity.com');
      expect(found?.bundle_id).toBe(bundle.bundle_id);
      expect(found?.cross_domain_transitions.length).toBe(1);
      expect(found?.iframe_references.length).toBe(1);
    });
  });

  // ==========================================================================
  // 7. Map Export / Import (Mục 4 & Mục 2 nguyên tắc 1)
  // ==========================================================================
  describe('MapExportImportEngine (Mục 4)', () => {
    it('xuất MapFile sang Envelope JSON kèm SHA-256 checksum bảo vệ tính toàn vẹn và sanitize URL', () => {
      const map: MapFile = {
        schema_version: '1.0.0',
        content_revision: 5,
        domain: 'portal.example.com',
        bundle_id: 'bundle_123',
        importance_score: 0.8,
        importance_source: 'user',
        base_nodes: [],
        account_slots: {},
        state_graph: [
          {
            id: 'state_secret',
            match_key: {
              url_pattern: 'https://portal.example.com/callback?token=my_secret_token_123&code=456',
              dom_fingerprint: null,
              virtual_route: null,
            },
            preconditions: [],
            transitions: [],
          },
        ],
        created_at: Date.now(),
        updated_at: Date.now(),
      };

      const exported = MapExportImportEngine.exportMap(map);
      expect(exported.envelope.format).toBe('DevBrowserTool_MapFile_Export');
      expect(exported.envelope.checksum_sha256).toBeDefined();

      // Kiểm tra URL đã được tẩy rửa token
      expect(exported.jsonString).toContain('token=[REDACTED]');
      expect(exported.jsonString).not.toContain('my_secret_token_123');
    });

    it('nhập MapFile thành công vào MapStore khi checksum toàn vẹn hợp lệ', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-export-test-${Date.now()}`));
      const map = store.createMap('import.example.com');
      const exported = MapExportImportEngine.exportMap(map);

      const importResult = await MapExportImportEngine.importMap(exported.jsonString, store);
      expect(importResult.success).toBe(true);
      expect(importResult.importedDomain).toBe('import.example.com');
      expect(importResult.checksumVerified).toBe(true);
    });

    it('TUYỆT ĐỐI TỪ CHỐI khi phát hiện dữ liệu nhập là Tool / Userscript (Mục 4 & 5.4)', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-tool-reject-${Date.now()}`));
      const maliciousToolPayload = JSON.stringify({
        tool_name: 'HackTool',
        actions: [{ type: 'click', node_ref: 'btn_1' }],
      });

      await expect(MapExportImportEngine.importMap(maliciousToolPayload, store)).rejects.toThrow(
        'Từ chối nhập: Phát hiện dữ liệu chứa mã nguồn hoặc cấu trúc của Tool',
      );
    });

    it('từ chối khi file export bị hỏng dữ liệu hoặc sai lệch checksum (integrity error)', async () => {
      const store = new MapStore(join(tmpdir(), `dbt-tamper-${Date.now()}`));
      const map = store.createMap('tamper.example.com');
      const exported = MapExportImportEngine.exportMap(map);

      // Sửa đổi dữ liệu bên trong nhưng giữ checksum cũ
      const tamperedJson = exported.jsonString.replace('tamper.example.com', 'corrupted.example.com');

      await expect(MapExportImportEngine.importMap(tamperedJson, store)).rejects.toThrow(
        'Checksum SHA-256 không khớp',
      );
    });
  });
});
