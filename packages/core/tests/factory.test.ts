/**
 * Tests for Factory Build Flow (Mục 5)
 *
 * Tests:
 * 1. StateGraphPlanner: BFS path finding & preconditions
 * 2. ActionCompiler: Action generation, preserves ALL variants, map snapshot
 * 3. Parameterizer: Placeholder extraction & interpolation
 * 4. DryRunRunner: Structured table output, execution report
 * 5. ToolFactory: Full 5-step pipeline & budget enforcement
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  StateGraphPlanner,
  ActionCompiler,
  Parameterizer,
  DryRunRunner,
  ToolFactory,
} from '../src/factory/index.js';
import { MapStore } from '../src/map/store.js';
import { MAP_CONSTANTS, type MapFile } from '../src/map/schema.js';
import type { BrowserAdapter, ActionResult } from '../src/actions/primitives.js';

const TEST_OUT_DIR = join(import.meta.dirname ?? __dirname, '__test_factory_out__');

// Mock BrowserAdapter for Dry-Run testing
class MockBrowserAdapter implements BrowserAdapter {
  navigateCalls: string[] = [];
  evaluateCalls: string[] = [];
  failNextEvaluate = false;

  async navigate(url: string): Promise<void> {
    this.navigateCalls.push(url);
  }

  async waitFor(condition: string, timeoutMs?: number): Promise<boolean> {
    return true;
  }

  async currentUrl(): Promise<string> {
    return 'https://factory-test.com/home';
  }

  async currentTitle(): Promise<string> {
    return 'Factory Test Page';
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    this.evaluateCalls.push(script);
    if (this.failNextEvaluate) {
      throw new Error('Simulated DOM evaluation failure');
    }
    // Return object compatible with both locator (found: true) and actions (success: true)
    return {
      found: true,
      success: true,
      used_fallback: false,
      method: 'direct_value',
      role: 'textbox',
      name: 'search',
    } as T;
  }

  async click(selector: string): Promise<ActionResult> {
    return { success: true, duration_ms: 20, used_fallback: false };
  }

  async fill(selector: string, value: string): Promise<ActionResult> {
    return { success: true, duration_ms: 25, used_fallback: false };
  }

  async screenshot(): Promise<Buffer> {
    return Buffer.from('fake-screenshot');
  }

  async getUrl(): Promise<string> {
    return 'https://factory-test.com/home';
  }
}

describe('Factory Build Flow', () => {
  let sampleMap: MapFile;

  beforeEach(() => {
    if (existsSync(TEST_OUT_DIR)) {
      rmSync(TEST_OUT_DIR, { recursive: true });
    }

    const store = new MapStore(join(TEST_OUT_DIR, 'maps'));
    let map = store.createMap('factory-test.com');

    // Add nodes with multiple variants (testing variant preservation)
    map = store.addNode(map, {
      id: 'search-input',
      type: 'dom_element',
      intent: 'Search Box',
      variants: [
        {
          id: 'var_search_1',
          value_formula: "document.querySelector('input#search')",
          confidence: 0.95,
          last_verified: Date.now(),
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
          created_at: Date.now(),
        },
        {
          id: 'var_search_2',
          value_formula: "document.querySelector('input[type=search]')",
          confidence: 0.85,
          last_verified: Date.now(),
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
          created_at: Date.now(),
        },
      ],
    });

    map = store.addNode(map, {
      id: 'search-btn',
      type: 'dom_element',
      intent: 'Search Button',
      variants: [
        {
          id: 'var_btn_1',
          value_formula: "document.querySelector('button#submit-search')",
          confidence: 0.9,
          last_verified: Date.now(),
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
          created_at: Date.now(),
        },
      ],
    });

    // Add state graph nodes and transitions
    map = store.addState(map, {
      id: 'home-state',
      match_key: { url_pattern: '/home', dom_fingerprint: null, virtual_route: null },
      preconditions: [],
      transitions: [
        { action_ref: 'Search Box', target_state_id: 'typing-state' },
      ],
    });

    map = store.addState(map, {
      id: 'typing-state',
      match_key: { url_pattern: '/home', dom_fingerprint: null, virtual_route: null },
      preconditions: [],
      transitions: [
        { action_ref: 'Search Button', target_state_id: 'results-state' },
      ],
    });

    map = store.addState(map, {
      id: 'results-state',
      match_key: { url_pattern: '/results', dom_fingerprint: null, virtual_route: null },
      preconditions: ['search_performed'],
      transitions: [],
    });

    sampleMap = map;
  });

  afterEach(() => {
    if (existsSync(TEST_OUT_DIR)) {
      rmSync(TEST_OUT_DIR, { recursive: true });
    }
  });

  // --------------------------------------------------------------------------
  // 1. STATE GRAPH PLANNER (0.10.1)
  // --------------------------------------------------------------------------

  describe('StateGraphPlanner', () => {
    it('should find optimal path on state graph', () => {
      const plan = StateGraphPlanner.findPath(
        sampleMap,
        'home-state',
        'results-state',
        { satisfied_conditions: ['search_performed'] }
      );

      expect(plan.success).toBe(true);
      expect(plan.path.length).toBe(2);
      expect(plan.path[0].action_ref).toBe('Search Box');
      expect(plan.path[1].action_ref).toBe('Search Button');
      expect(plan.path[1].target_state_id).toBe('results-state');
    });

    it('should fail if precondition is not satisfied', () => {
      const plan = StateGraphPlanner.findPath(
        sampleMap,
        'home-state',
        'results-state',
        { satisfied_conditions: [] } // Chưa thoả search_performed
      );

      expect(plan.success).toBe(false);
      expect(plan.unmet_preconditions).toContain('search_performed');
    });

    it('should return error for invalid state IDs', () => {
      const plan = StateGraphPlanner.findPath(sampleMap, 'non-existent', 'results-state');
      expect(plan.success).toBe(false);
      expect(plan.error).toContain('non-existent');
    });
  });

  // --------------------------------------------------------------------------
  // 2. ACTION COMPILER (0.10.2)
  // --------------------------------------------------------------------------

  describe('ActionCompiler', () => {
    it('should compile actions while preserving ALL variants', () => {
      const result = ActionCompiler.compileFromSpecs(sampleMap, [
        { intent: 'Search Box', type: 'fill', params: { value: 'test query' } },
        { intent: 'Search Button', type: 'click' },
      ]);

      expect(result.actions.length).toBe(2);
      expect(result.missing_intents.length).toBe(0);
      expect(result.map_snapshot.length).toBe(2);

      // Verify node preserves all 2 variants (Mục 5.2 bước 2)
      const searchNode = result.map_snapshot.find(n => n.id === 'search-input');
      expect(searchNode).toBeDefined();
      expect(searchNode!.variants.length).toBe(2);
      expect(searchNode!.variants[0].value_formula).toContain('input#search');
      expect(searchNode!.variants[1].value_formula).toContain('input[type=search]');
    });

    it('should detect missing intents', () => {
      const result = ActionCompiler.compileFromSpecs(sampleMap, [
        { intent: 'Non Existent Intent', type: 'click' },
      ]);

      expect(result.missing_intents).toContain('Non Existent Intent');
    });
  });

  // --------------------------------------------------------------------------
  // 3. PARAMETERIZER (0.10.3)
  // --------------------------------------------------------------------------

  describe('Parameterizer', () => {
    it('should extract placeholders and interpolate values', () => {
      const compileResult = ActionCompiler.compileFromSpecs(sampleMap, [
        { intent: 'Search Box', type: 'fill', params: { value: '{{keyword}}' } },
      ]);

      const placeholders = Parameterizer.extractPlaceholders(compileResult.actions);
      expect(placeholders).toEqual(['keyword']);

      const inputParams = Parameterizer.buildInputParamsConfig(placeholders);
      expect(inputParams.keyword).toBeDefined();
      expect(inputParams.keyword.required).toBe(true);

      const interpolated = Parameterizer.interpolateActions(compileResult.actions, {
        keyword: 'antigravity agent',
      });
      expect(interpolated[0].params.value).toBe('antigravity agent');
    });
  });

  // --------------------------------------------------------------------------
  // 4. DRY-RUN RUNNER (0.10.4)
  // --------------------------------------------------------------------------

  describe('DryRunRunner', () => {
    it('should produce structured report with table rows', async () => {
      const compileResult = ActionCompiler.compileFromSpecs(sampleMap, [
        { intent: 'Search Box', type: 'fill', params: { value: 'query' } },
        { intent: 'Search Button', type: 'click' },
      ]);

      const browser = new MockBrowserAdapter();
      const report = await DryRunRunner.run(browser, sampleMap, compileResult.actions);

      expect(report.success).toBe(true);
      expect(report.total_steps).toBe(2);
      expect(report.passed_steps).toBe(2);
      expect(report.failed_steps).toBe(0);
      expect(report.rows.length).toBe(2);
      expect(report.rows[0].status).toBe('PASS');
      expect(report.rows[1].status).toBe('PASS');

      const markdown = DryRunRunner.formatMarkdownTable(report);
      expect(markdown).toContain('| # | Action | Target / Intent | Status | Variant | Duration | Error |');
      expect(markdown).toContain('PASS');
    });
  });

  // --------------------------------------------------------------------------
  // 5. TOOL FACTORY 5-STEP PIPELINE & BUDGET (0.10.5 & 0.10.6)
  // --------------------------------------------------------------------------

  describe('ToolFactory', () => {
    it('should enforce discovery budget limits', () => {
      const factory = new ToolFactory();

      // Within budget
      expect(factory.checkDiscoveryBudget(2, 1000).allowed).toBe(true);

      // Consume budget
      factory.consumeDiscoveryBudget(8, 4500);

      // Next call exceeds token budget (4500 + 1000 > 5000)
      const budgetCheck = factory.checkDiscoveryBudget(1, 1000);
      expect(budgetCheck.allowed).toBe(false);
      expect(budgetCheck.reason).toContain('ngân sách token');
    });

    it('should run full 5-step build and generate Chrome extension', async () => {
      const factory = new ToolFactory();
      const browser = new MockBrowserAdapter();

      const result = await factory.build(sampleMap, {
        tool_name: 'SearchHelperTool',
        output_dir: join(TEST_OUT_DIR, 'search_extension'),
        browser,
        action_specs: [
          { intent: 'Search Box', type: 'fill', params: { value: '{{query}}' } },
          { intent: 'Search Button', type: 'click' },
        ],
        param_values: { query: 'test automation' },
      });

      expect(result.success).toBe(true);
      expect(result.package_result).toBeDefined();
      expect(result.package_result!.success).toBe(true);

      // Verify generated extension files on disk
      const extDir = join(TEST_OUT_DIR, 'search_extension');
      expect(existsSync(join(extDir, 'manifest.json'))).toBe(true);
      expect(existsSync(join(extDir, 'background.js'))).toBe(true);
      expect(existsSync(join(extDir, 'content.js'))).toBe(true);
      expect(existsSync(join(extDir, 'circuit-breaker.js'))).toBe(true);

      // Verify manifest contents
      const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf-8'));
      expect(manifest.name).toBe('SearchHelperTool');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.manifest_version).toBe(3);
    });
  });
});
