/**
 * Tests for Map Store — Atomic write, CRUD, variant management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MapStore } from '../src/map/store.js';
import { MAP_CONSTANTS, type MapFile, type ResourceNode } from '../src/map/schema.js';

const TEST_MAPS_DIR = join(import.meta.dirname ?? __dirname, '__test_maps__');

describe('MapStore', () => {
  let store: MapStore;

  beforeEach(() => {
    // Clean up trước mỗi test
    if (existsSync(TEST_MAPS_DIR)) {
      rmSync(TEST_MAPS_DIR, { recursive: true });
    }
    store = new MapStore(TEST_MAPS_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_MAPS_DIR)) {
      rmSync(TEST_MAPS_DIR, { recursive: true });
    }
  });

  // --------------------------------------------------------------------------
  // CREATE & LOAD
  // --------------------------------------------------------------------------

  describe('createMap', () => {
    it('should create a new map with correct defaults', () => {
      const map = store.createMap('example.com');

      expect(map.domain).toBe('example.com');
      expect(map.schema_version).toBe('1.0.0');
      expect(map.content_revision).toBe(0);
      expect(map.base_nodes).toEqual([]);
      expect(map.state_graph).toEqual([]);
      expect(map.importance_score).toBe(0.5);
      expect(map.importance_source).toBe('auto');
      expect(map.bundle_id).toBeNull();
    });

    it('should persist to disk', () => {
      store.createMap('example.com');
      const loaded = store.loadMap('example.com');

      expect(loaded).not.toBeNull();
      expect(loaded!.domain).toBe('example.com');
    });

    it('should throw if map already exists', () => {
      store.createMap('example.com');
      expect(() => store.createMap('example.com')).toThrow('Map already exists');
    });

    it('should accept custom importance score and bundle_id', () => {
      const map = store.createMap('important.com', {
        importance_score: 0.9,
        bundle_id: 'auth-bundle-001',
      });

      expect(map.importance_score).toBe(0.9);
      expect(map.bundle_id).toBe('auth-bundle-001');
    });
  });

  describe('loadOrCreateMap', () => {
    it('should create if not exists', () => {
      const map = store.loadOrCreateMap('new-site.com');
      expect(map.domain).toBe('new-site.com');
    });

    it('should load if exists', () => {
      store.createMap('existing.com');
      const map = store.loadOrCreateMap('existing.com');
      expect(map.domain).toBe('existing.com');
    });
  });

  // --------------------------------------------------------------------------
  // SAVE — Atomic write + content_revision
  // --------------------------------------------------------------------------

  describe('saveMap', () => {
    it('should increment content_revision on save', () => {
      let map = store.createMap('example.com');
      expect(map.content_revision).toBe(0);

      map = store.saveMap(map);
      expect(map.content_revision).toBe(1);

      map = store.saveMap(map);
      expect(map.content_revision).toBe(2);
    });

    it('should use atomic write (no temp files left)', () => {
      let map = store.createMap('example.com');
      map = store.saveMap(map);

      // Kiểm tra không có .tmp file sót lại
      const dir = join(TEST_MAPS_DIR, 'example.com');
      const files = require('node:fs').readdirSync(dir);
      expect(files.length).toBe(1);
      expect(files[0]).toBe('map.json');
    });

    it('should validate with Zod before writing', () => {
      const map = store.createMap('example.com');
      // Tạo map với importance_score ngoài phạm vi [0, 1]
      const invalid = { ...map, importance_score: 999 };
      expect(() => store.saveMap(invalid as MapFile)).toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // NODE OPERATIONS
  // --------------------------------------------------------------------------

  describe('addNode', () => {
    it('should add a resource node', () => {
      let map = store.createMap('example.com');
      map = store.addNode(map, {
        id: 'login-btn',
        type: 'dom_element',
        intent: 'Nút đăng nhập chính',
        variants: [{
          id: 'v1',
          value_formula: "document.querySelector('#login-btn')",
          confidence: 0.9,
          last_verified: Date.now(),
          fail_count_recent: 0,
          locale: null,
          created_at: Date.now(),
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
        }],
        discovered_via: 'normal',
        requires_elevation: false,
      });

      expect(map.base_nodes.length).toBe(1);
      expect(map.base_nodes[0].intent).toBe('Nút đăng nhập chính');
      expect(map.base_nodes[0].variants.length).toBe(1);
    });

    it('should reject duplicate node IDs', () => {
      let map = store.createMap('example.com');
      map = store.addNode(map, {
        id: 'node-1',
        type: 'endpoint',
        intent: 'API endpoint',
        variants: [],
      });

      expect(() => store.addNode(map, {
        id: 'node-1',
        type: 'endpoint',
        intent: 'Duplicate',
        variants: [],
      })).toThrow('already exists');
    });
  });

  describe('findNode', () => {
    it('should find node by id in base_nodes', () => {
      let map = store.createMap('example.com');
      map = store.addNode(map, {
        id: 'search-input',
        type: 'dom_element',
        intent: 'Ô tìm kiếm',
        variants: [],
      });

      const found = store.findNode(map, 'search-input');
      expect(found).not.toBeNull();
      expect(found!.intent).toBe('Ô tìm kiếm');
    });

    it('should return null for non-existent node', () => {
      const map = store.createMap('example.com');
      expect(store.findNode(map, 'nonexistent')).toBeNull();
    });
  });

  describe('findNodesByIntent', () => {
    it('should find nodes by intent keyword (case-insensitive)', () => {
      let map = store.createMap('example.com');
      map = store.addNode(map, {
        id: 'n1',
        type: 'dom_element',
        intent: 'Nút Đăng nhập',
        variants: [],
      });
      map = store.addNode(map, {
        id: 'n2',
        type: 'endpoint',
        intent: 'API đăng nhập',
        variants: [],
      });
      map = store.addNode(map, {
        id: 'n3',
        type: 'dom_element',
        intent: 'Nút Like bài viết',
        variants: [],
      });

      const results = store.findNodesByIntent(map, 'đăng nhập');
      expect(results.length).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // VARIANT MANAGEMENT (Mục 3.11)
  // --------------------------------------------------------------------------

  describe('variant management', () => {
    it('should add variant to node', () => {
      let map = store.createMap('example.com');
      map = store.addNode(map, {
        id: 'btn',
        type: 'dom_element',
        intent: 'Button',
        variants: [],
      });

      map = store.addVariant(map, 'btn', {
        value_formula: "document.querySelector('.btn')",
        confidence: 0.9,
        last_verified: Date.now(),
        ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
      });

      expect(map.base_nodes[0].variants.length).toBe(1);
    });

    it('should replace weakest variant when max reached', () => {
      let map = store.createMap('example.com');
      map = store.addNode(map, {
        id: 'btn',
        type: 'dom_element',
        intent: 'Button',
        variants: [],
      });

      // Thêm MAX_VARIANTS_PER_NODE variants
      for (let i = 0; i < MAP_CONSTANTS.MAX_VARIANTS_PER_NODE; i++) {
        map = store.addVariant(map, 'btn', {
          value_formula: `selector_${i}`,
          confidence: 0.5 + i * 0.1,
          last_verified: Date.now(),
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
        });
      }

      expect(map.base_nodes[0].variants.length).toBe(MAP_CONSTANTS.MAX_VARIANTS_PER_NODE);

      // Thêm 1 variant nữa — phải thay thế variant yếu nhất
      map = store.addVariant(map, 'btn', {
        value_formula: 'new_selector',
        confidence: 0.95,
        last_verified: Date.now(),
        ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
      });

      expect(map.base_nodes[0].variants.length).toBe(MAP_CONSTANTS.MAX_VARIANTS_PER_NODE);
      expect(map.base_nodes[0].variants.some(v => v.value_formula === 'new_selector')).toBe(true);
    });

    it('should sort variants by priority (confidence * decay)', () => {
      let map = store.createMap('example.com');
      const now = Date.now();
      map = store.addNode(map, {
        id: 'btn',
        type: 'dom_element',
        intent: 'Button',
        variants: [
          {
            id: 'old-high-conf',
            value_formula: 'old_selector',
            confidence: 0.95,
            last_verified: now - 25 * 24 * 60 * 60 * 1000, // 25 ngày trước (gần hết TTL)
            fail_count_recent: 0,
            locale: null,
            created_at: now - 30 * 24 * 60 * 60 * 1000,
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
          },
          {
            id: 'recent-mid-conf',
            value_formula: 'recent_selector',
            confidence: 0.7,
            last_verified: now - 1000, // Vừa verify
            fail_count_recent: 0,
            locale: null,
            created_at: now,
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
          },
        ],
      });

      const sorted = store.getVariantsByPriority(map.base_nodes[0]);
      // Recent variant nên được ưu tiên hơn dù confidence thấp hơn
      // vì nó được verify gần đây (decay factor cao hơn)
      expect(sorted[0].id).toBe('recent-mid-conf');
    });
  });

  // --------------------------------------------------------------------------
  // STATE GRAPH
  // --------------------------------------------------------------------------

  describe('state graph', () => {
    it('should add state and transition', () => {
      let map = store.createMap('example.com');

      map = store.addState(map, {
        id: 'login-page',
        match_key: { url_pattern: '/login', dom_fingerprint: null, virtual_route: null },
        preconditions: [],
        transitions: [],
      });

      map = store.addState(map, {
        id: 'dashboard',
        match_key: { url_pattern: '/dashboard', dom_fingerprint: null, virtual_route: null },
        preconditions: ['login-success'],
        transitions: [],
      });

      map = store.addTransition(map, 'login-page', 'submit-login', 'dashboard');

      expect(map.state_graph.length).toBe(2);
      expect(map.state_graph[0].transitions.length).toBe(1);
      expect(map.state_graph[0].transitions[0].target_state_id).toBe('dashboard');
    });
  });

  // --------------------------------------------------------------------------
  // ACCOUNT SLOTS (Mục 3.9)
  // --------------------------------------------------------------------------

  describe('account slots', () => {
    it('should add, get and remove account slot', () => {
      let map = store.createMap('example.com');
      const hash = 'acc_hash_123';

      map = store.addAccountSlot(map, hash);
      expect(store.getAccountSlot(map, hash)).toBeDefined();
      expect(store.getAccountSlot(map, hash)?.account_hash).toBe(hash);

      map = store.removeAccountSlot(map, hash);
      expect(store.getAccountSlot(map, hash)).toBeUndefined();
    });

    it('should add delta node to account slot and get effective nodes', () => {
      let map = store.createMap('example.com');
      const hash = 'acc_hash_xyz';

      // Base node: Default profile button
      map = store.addNode(map, {
        id: 'profile-btn',
        type: 'dom_element',
        intent: 'Open Profile',
        variants: [
          {
            id: 'var_profile_base',
            value_formula: '#default-profile',
            confidence: 0.8,
            last_verified: Date.now(),
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            created_at: Date.now(),
          },
        ],
      });

      // Add account slot
      map = store.addAccountSlot(map, hash);

      // Delta node: Custom profile button for this account slot
      map = store.addDeltaNode(map, hash, {
        id: 'profile-btn',
        type: 'dom_element',
        intent: 'Open Profile',
        created_at: Date.now(),
        updated_at: Date.now(),
        variants: [
          {
            id: 'var_profile_delta',
            value_formula: '#custom-profile-avatar',
            confidence: 0.95,
            last_verified: Date.now(),
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            created_at: Date.now(),
          },
        ],
      });

      // Without account hash -> returns base node
      const baseEffective = store.getEffectiveNodes(map);
      expect(baseEffective.length).toBe(1);
      expect(baseEffective[0].variants[0].value_formula).toBe('#default-profile');

      // With account hash -> returns delta node overriding base node
      const slotEffective = store.getEffectiveNodes(map, hash);
      expect(slotEffective.length).toBe(1);
      expect(slotEffective[0].variants[0].value_formula).toBe('#custom-profile-avatar');
    });
  });

  // --------------------------------------------------------------------------
  // EXPORT / IMPORT (Mục 4)
  // --------------------------------------------------------------------------

  describe('export and import', () => {
    it('should export map to valid JSON and import it back', () => {
      let map = store.createMap('export-test.com');
      map = store.addNode(map, {
        id: 'test-node',
        type: 'dom_element',
        intent: 'Test Intent',
        variants: [
          {
            id: 'var_export_test',
            value_formula: '.test-class',
            confidence: 0.9,
            last_verified: Date.now(),
            ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
            created_at: Date.now(),
          },
        ],
      });
      store.saveMap(map);

      const exportedJson = store.exportMapJson('export-test.com');
      expect(typeof exportedJson).toBe('string');
      expect(exportedJson).toContain('export-test.com');
      expect(exportedJson).toContain('test-node');

      // Tạo một store mới độc lập để import vào
      const newTempDir = join(TEST_MAPS_DIR, 'new_store');
      const newStore = new MapStore(newTempDir);

      const importedMap = newStore.importMapJson(exportedJson);
      expect(importedMap.domain).toBe('export-test.com');
      expect(importedMap.base_nodes.length).toBe(1);
      expect(importedMap.base_nodes[0].id).toBe('test-node');
      expect(newStore.hasMap('export-test.com')).toBe(true);
    });
  });
});

