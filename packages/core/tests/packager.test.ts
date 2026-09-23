/**
 * Extension Packager Tests (Mục 5.3, 5.6, 7.1, 0.8)
 *
 * Kiểm tra:
 * 1. Tính toán permission tối thiểu (Mục 5.6)
 * 2. Sinh manifest.json chuẩn MV3
 * 3. Đóng gói đầy đủ các files (manifest, background, circuit-breaker, content, readme)
 * 4. Trích xuất Map snapshot gọn nhẹ
 * 5. Script MAIN-world tại document_start khi có patch_runtime
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  calculatePermissions,
  generateManifest,
  ExtensionPackager,
} from '../src/packager/index.js';
import { MAP_CONSTANTS, type Action, type MapFile, type ToolConfig } from '../src/map/schema.js';

describe('Chrome Extension Packager (MV3)', () => {
  const DOMAIN = 'shop.example.com';
  let tempOutputDir: string;

  beforeEach(() => {
    tempOutputDir = join(tmpdir(), 'dbt-test-ext-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  });

  afterEach(() => {
    if (existsSync(tempOutputDir)) {
      rmSync(tempOutputDir, { recursive: true, force: true });
    }
  });

  const sampleMapFile: MapFile = {
    schema_version: '1.0.0',
    content_revision: 2,
    domain: DOMAIN,
    bundle_id: null,
    importance_score: 0.7,
    importance_source: 'auto',
    created_at: Date.now(),
    updated_at: Date.now(),
    account_slots: {},
    state_graph: [],
    base_nodes: [
      {
        id: 'cart_btn',
        type: 'dom_element',
        intent: 'Nút giỏ hàng',
        discovered_via: 'normal',
        requires_elevation: false,
        created_at: Date.now(),
        updated_at: Date.now(),
        variants: [
          {
            id: 'v1',
            value_formula: "document.querySelector('#cart')",
            confidence: 0.9,
            last_verified: Date.now(),
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
          },
        ],
      },
      {
        id: 'checkout_btn',
        type: 'dom_element',
        intent: 'Nút thanh toán',
        discovered_via: 'normal',
        requires_elevation: false,
        created_at: Date.now(),
        updated_at: Date.now(),
        variants: [
          {
            id: 'v2',
            value_formula: "document.querySelector('#checkout')",
            confidence: 0.95,
            last_verified: Date.now(),
            fail_count_recent: 0,
            locale: null,
            created_at: Date.now(),
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
          },
        ],
      },
      {
        id: 'unrelated_node',
        type: 'dom_element',
        intent: 'Nút không liên quan đến tool này',
        discovered_via: 'normal',
        requires_elevation: false,
        created_at: Date.now(),
        updated_at: Date.now(),
        variants: [],
      },
    ],
  };

  const sampleActions: Action[] = [
    {
      id: 'act-1',
      type: 'click',
      node_ref: 'cart_btn',
      params: {},
      preferred_variant_ids: ['v1'],
      on_failure: 'stop',
      description: 'Mở giỏ hàng',
    },
    {
      id: 'act-2',
      type: 'click',
      node_ref: 'checkout_btn',
      params: {},
      preferred_variant_ids: ['v2'],
      on_failure: 'stop',
      description: 'Bấm thanh toán',
    },
  ];

  const sampleToolConfig: ToolConfig = {
    name: 'Quick Checkout Bot',
    description: 'Tự động mở giỏ hàng và thanh toán nhanh',
    target_domain: DOMAIN,
    map_schema_version: '1.0.0',
    map_content_revision: 2,
    actions: sampleActions,
    map_snapshot: {
      nodes: [],
      states: [],
    },
    built_at: Date.now(),
    package_type: 'chrome_extension',
    input_params: [],
  };

  describe('calculatePermissions (Mục 5.6)', () => {
    it('chỉ xin quyền storage cho tool thông thường (tối thiểu)', () => {
      const perms = calculatePermissions(DOMAIN, sampleActions);
      expect(perms.permissions).toEqual(['storage']);
      expect(perms.hasPatchRuntime).toBe(false);
      expect(perms.host_permissions).toContain(`https://${DOMAIN}/*`);
      expect(perms.host_permissions).toContain(`https://*.${DOMAIN}/*`);
      expect(perms.permissions).not.toContain('cookies');
    });

    it('xin quyền cookies CHỈ khi có action deep_scan_local loại cookies', () => {
      const actionsWithCookies: Action[] = [
        ...sampleActions,
        {
          id: 'act-scan',
          type: 'deep_scan_local',
          node_ref: null,
          params: { scan_type: 'cookies' },
          preferred_variant_ids: [],
          on_failure: 'skip_and_continue',
        },
      ];

      const perms = calculatePermissions(DOMAIN, actionsWithCookies);
      expect(perms.permissions).toContain('cookies');
      expect(perms.permissions).toContain('storage');
    });

    it('phát hiện hasPatchRuntime = true khi có action patch_runtime', () => {
      const actionsWithPatch: Action[] = [
        ...sampleActions,
        {
          id: 'act-patch',
          type: 'patch_runtime',
          node_ref: null,
          params: { target: 'fetch' },
          preferred_variant_ids: [],
          on_failure: 'stop',
        },
      ];

      const perms = calculatePermissions(DOMAIN, actionsWithPatch);
      expect(perms.hasPatchRuntime).toBe(true);
    });
  });

  describe('generateManifest (Mục 5.3)', () => {
    it('tạo manifest chuẩn MV3 không có MAIN-world script nếu không cần', () => {
      const manifest = generateManifest(sampleToolConfig, sampleActions);

      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBe('Quick Checkout Bot');
      expect(manifest.background.service_worker).toBe('background.js');
      expect(manifest.background.type).toBe('module');
      expect(manifest.content_scripts.length).toBe(1);

      const isolated = manifest.content_scripts[0];
      expect(isolated.js).toEqual(['circuit-breaker.js', 'content.js']);
      expect(isolated.run_at).toBe('document_idle');
    });

    it('thêm content-main.js tại document_start với world: MAIN khi có patch_runtime', () => {
      const actionsWithPatch: Action[] = [
        ...sampleActions,
        {
          id: 'act-patch',
          type: 'patch_runtime',
          node_ref: null,
          params: { target: 'fetch' },
          preferred_variant_ids: [],
          on_failure: 'stop',
        },
      ];

      const manifest = generateManifest(sampleToolConfig, actionsWithPatch);
      expect(manifest.content_scripts.length).toBe(2);

      const mainWorldScript = manifest.content_scripts.find((s) => s.world === 'MAIN');
      expect(mainWorldScript).toBeDefined();
      expect(mainWorldScript?.js).toContain('content-main.js');
      expect(mainWorldScript?.run_at).toBe('document_start');
    });
  });

  describe('ExtensionPackager.package (Mục 0.8 & 5.3)', () => {
    it('đóng gói hoàn chỉnh ra filesystem với đầy đủ các file', () => {
      const result = ExtensionPackager.package({
        toolConfig: sampleToolConfig,
        actions: sampleActions,
        mapFile: sampleMapFile,
        outputDir: tempOutputDir,
      });

      expect(result.success).toBe(true);
      expect(result.outputDir).toBe(tempOutputDir);
      expect(result.hasPatchRuntime).toBe(false);

      // Kiểm tra file manifest.json
      const manifestPath = join(tempOutputDir, 'manifest.json');
      expect(existsSync(manifestPath)).toBe(true);
      const manifestJson = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifestJson.name).toBe('Quick Checkout Bot');

      // Kiểm tra file circuit-breaker.js (Mục 7.1)
      const cbPath = join(tempOutputDir, 'circuit-breaker.js');
      expect(existsSync(cbPath)).toBe(true);
      const cbContent = readFileSync(cbPath, 'utf-8');
      expect(cbContent).toContain('ToolCircuitBreaker');
      expect(cbContent).toContain(String(MAP_CONSTANTS.CIRCUIT_BREAKER_MAX_FAILS));

      // Kiểm tra file background.js
      const bgPath = join(tempOutputDir, 'background.js');
      expect(existsSync(bgPath)).toBe(true);

      // Kiểm tra file content.js
      const contentPath = join(tempOutputDir, 'content.js');
      expect(existsSync(contentPath)).toBe(true);
      const contentCode = readFileSync(contentPath, 'utf-8');
      expect(contentCode).toContain('cart_btn');
      expect(contentCode).toContain('checkout_btn');
      // Node không liên quan KHÔNG được nhúng vào snapshot
      expect(contentCode).not.toContain('unrelated_node');

      // Kiểm tra file README.md
      const readmePath = join(tempOutputDir, 'README.md');
      expect(existsSync(readmePath)).toBe(true);
      const readmeText = readFileSync(readmePath, 'utf-8');
      expect(readmeText).toContain('chrome://extensions/');
    });

    it('sinh thêm content-main.js khi có action patch_runtime', () => {
      const actionsWithPatch: Action[] = [
        ...sampleActions,
        {
          id: 'act-patch',
          type: 'patch_runtime',
          node_ref: null,
          params: { target: 'fetch' },
          preferred_variant_ids: [],
          on_failure: 'stop',
        },
      ];

      const result = ExtensionPackager.package({
        toolConfig: sampleToolConfig,
        actions: actionsWithPatch,
        mapFile: sampleMapFile,
        outputDir: tempOutputDir,
      });

      expect(result.hasPatchRuntime).toBe(true);
      const mainPath = join(tempOutputDir, 'content-main.js');
      expect(existsSync(mainPath)).toBe(true);
      const mainCode = readFileSync(mainPath, 'utf-8');
      expect(mainCode).toContain('MAIN world hook initialized');
    });
  });
});
