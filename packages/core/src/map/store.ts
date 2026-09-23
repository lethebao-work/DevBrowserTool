/**
 * Map Store — CRUD + Atomic Write (Mục 4)
 *
 * Lưu trữ Map dạng JSON file-based, local-only.
 * Ghi file theo kiểu atomic: ghi ra file tạm → rename đè lên file chính.
 * Versioning: schema_version (hiếm đổi) + content_revision (tăng mỗi update).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MapFileSchema,
  ResourceNodeSchema,
  AccountSlotSchema,
  type MapFile,
  type ResourceNode,
  type ResourceNodeInput,
  type Variant,
  type VariantInput,
  type StateNode,
  type AccountSlot,
  MAP_CONSTANTS,
} from './schema.js';

// ============================================================================
// MAP STORE
// ============================================================================

export class MapStore {
  private readonly mapsDir: string;

  constructor(mapsDir: string) {
    this.mapsDir = mapsDir;
  }

  // --------------------------------------------------------------------------
  // PATH HELPERS
  // --------------------------------------------------------------------------

  /** Đường dẫn file map cho 1 domain */
  private getMapPath(domain: string): string {
    // Sanitize domain cho filesystem
    const safeDomain = domain.replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this.mapsDir, safeDomain, 'map.json');
  }

  /** Đường dẫn file tạm (cho atomic write) */
  private getTempPath(mapPath: string): string {
    return `${mapPath}.${randomUUID()}.tmp`;
  }

  // --------------------------------------------------------------------------
  // ATOMIC WRITE (Mục 4 — "ghi file theo kiểu atomic")
  // --------------------------------------------------------------------------

  /**
   * Ghi file atomic: write to temp → rename over main file.
   * Đảm bảo file chính luôn ở trạng thái hợp lệ, ngay cả khi crash giữa chừng.
   */
  private atomicWrite(filePath: string, data: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tempPath = this.getTempPath(filePath);
    try {
      // Bước 1: Ghi ra file tạm
      writeFileSync(tempPath, data, 'utf-8');
      // Bước 2: Rename đè lên file chính (atomic trên hầu hết OS)
      try {
        renameSync(tempPath, filePath);
      } catch (renameErr: any) {
        // Trên Windows, rename đè có thể gặp EPERM/EBUSY/EEXIST nếu file đang mở hoặc bị lock tạm
        if (['EPERM', 'EBUSY', 'EEXIST'].includes(renameErr?.code)) {
          if (existsSync(filePath)) {
            unlinkSync(filePath);
          }
          renameSync(tempPath, filePath);
        } else {
          throw renameErr;
        }
      }
    } catch (err) {
      // Dọn file tạm nếu còn sót
      try {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      } catch {
        // Bỏ qua lỗi dọn dẹp
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // CRUD OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Tạo Map mới cho 1 domain.
   * Nếu đã tồn tại, throw error (dùng loadMap để đọc, updateMap để sửa).
   */
  createMap(domain: string, options?: Partial<Pick<MapFile, 'importance_score' | 'bundle_id'>>): MapFile {
    const mapPath = this.getMapPath(domain);
    if (existsSync(mapPath)) {
      throw new Error(`Map already exists for domain: ${domain}. Use loadMap() to read.`);
    }

    const now = Date.now();
    const map: MapFile = MapFileSchema.parse({
      schema_version: '1.0.0',
      content_revision: 0,
      domain,
      bundle_id: options?.bundle_id ?? null,
      importance_score: options?.importance_score ?? 0.5,
      importance_source: 'auto',
      base_nodes: [],
      account_slots: {},
      state_graph: [],
      created_at: now,
      updated_at: now,
    });

    this.atomicWrite(mapPath, JSON.stringify(map, null, 2));
    return map;
  }

  /**
   * Đọc Map cho 1 domain. Trả về null nếu chưa có.
   */
  loadMap(domain: string): MapFile | null {
    const mapPath = this.getMapPath(domain);
    if (!existsSync(mapPath)) {
      return null;
    }

    const raw = readFileSync(mapPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return MapFileSchema.parse(parsed);
  }

  /**
   * Đọc Map hoặc tạo mới nếu chưa có.
   */
  loadOrCreateMap(domain: string, options?: Partial<Pick<MapFile, 'importance_score' | 'bundle_id'>>): MapFile {
    const existing = this.loadMap(domain);
    if (existing) return existing;
    return this.createMap(domain, options);
  }

  /**
   * Lưu Map đã chỉnh sửa — tự tăng content_revision.
   * Validate bằng Zod trước khi ghi.
   */
  saveMap(map: MapFile): MapFile {
    const updated: MapFile = {
      ...map,
      content_revision: map.content_revision + 1,
      updated_at: Date.now(),
    };

    // Validate trước khi ghi
    const validated = MapFileSchema.parse(updated);

    const mapPath = this.getMapPath(validated.domain);
    this.atomicWrite(mapPath, JSON.stringify(validated, null, 2));
    return validated;
  }

  /**
   * Kiểm tra Map có tồn tại cho domain không.
   */
  hasMap(domain: string): boolean {
    return existsSync(this.getMapPath(domain));
  }

  /**
   * Liệt kê tất cả domain đã có Map.
   */
  listDomains(): string[] {
    if (!existsSync(this.mapsDir)) return [];
    const entries = readdirSync(this.mapsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(this.getMapPath(name)));
  }

  /**
   * Xóa Map của một domain khỏi storage.
   */
  deleteMap(domain: string): boolean {
    const safeDomain = domain.replace(/[^a-zA-Z0-9._-]/g, '_');
    const domainDir = join(this.mapsDir, safeDomain);
    if (!existsSync(domainDir)) {
      return false;
    }
    rmSync(domainDir, { recursive: true, force: true });
    return true;
  }

  // --------------------------------------------------------------------------
  // NODE OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Xóa ResourceNode khỏi base_nodes và tự động tăng content_revision.
   */
  deleteNode(map: MapFile, nodeId: string): MapFile {
    const filteredNodes = map.base_nodes.filter(n => n.id !== nodeId);
    if (filteredNodes.length === map.base_nodes.length) {
      return map;
    }
    return this.saveMap({
      ...map,
      base_nodes: filteredNodes,
    });
  }

  /**
   * Thêm ResourceNode vào base_nodes.
   * Tự tạo ID nếu chưa có, validate schema.
   */
  addNode(map: MapFile, node: Omit<ResourceNodeInput, 'created_at' | 'updated_at'> & Partial<Pick<ResourceNodeInput, 'created_at' | 'updated_at'>>): MapFile {
    const now = Date.now();
    const normalizedVariants = (node.variants ?? []).map(v => ({
      fail_count_recent: 0,
      locale: null,
      ...v,
      id: (v as any).id ?? randomUUID(),
      created_at: (v as any).created_at ?? now,
    }));

    const fullNode = ResourceNodeSchema.parse({
      ...node,
      variants: normalizedVariants,
      created_at: node.created_at ?? now,
      updated_at: node.updated_at ?? now,
    });

    // Kiểm tra ID trùng
    if (map.base_nodes.some(n => n.id === fullNode.id)) {
      throw new Error(`Node with id "${fullNode.id}" already exists in base_nodes.`);
    }

    return {
      ...map,
      base_nodes: [...map.base_nodes, fullNode],
    };
  }

  /**
   * Cập nhật 1 node trong base_nodes.
   */
  updateNode(map: MapFile, nodeId: string, updates: Partial<Omit<ResourceNodeInput, 'id' | 'created_at'>>): MapFile {
    const index = map.base_nodes.findIndex(n => n.id === nodeId);
    if (index === -1) {
      throw new Error(`Node with id "${nodeId}" not found in base_nodes.`);
    }

    const updatedNode = ResourceNodeSchema.parse({
      ...map.base_nodes[index],
      ...updates,
      id: nodeId, // Giữ nguyên ID
      created_at: map.base_nodes[index].created_at, // Giữ nguyên created_at
      updated_at: Date.now(),
    });

    const newNodes = [...map.base_nodes];
    newNodes[index] = updatedNode;

    return { ...map, base_nodes: newNodes };
  }

  /**
   * Tìm node theo ID.
   */
  findNode(map: MapFile, nodeId: string, accountHash?: string): ResourceNode | null {
    // Tìm trong base_nodes trước
    const baseNode = map.base_nodes.find(n => n.id === nodeId);
    if (baseNode) return baseNode;

    // Nếu có account_hash, tìm trong delta_nodes
    if (accountHash && map.account_slots[accountHash]) {
      return map.account_slots[accountHash].delta_nodes.find(n => n.id === nodeId) ?? null;
    }

    return null;
  }

  /**
   * Tìm node theo intent (fuzzy search).
   */
  findNodesByIntent(map: MapFile, intentQuery: string): ResourceNode[] {
    const query = intentQuery.toLowerCase();
    return map.base_nodes.filter(n =>
      n.intent.toLowerCase().includes(query)
    );
  }

  // --------------------------------------------------------------------------
  // VARIANT OPERATIONS (Mục 3.11)
  // --------------------------------------------------------------------------

  /**
   * Thêm variant vào node.
   * Nếu đã đạt MAX_VARIANTS_PER_NODE, thay thế variant yếu nhất.
   */
  addVariant(map: MapFile, nodeId: string, variant: Omit<VariantInput, 'id' | 'created_at'> & Partial<Pick<VariantInput, 'id' | 'created_at'>>): MapFile {
    const nodeIndex = map.base_nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) {
      throw new Error(`Node "${nodeId}" not found.`);
    }

    const node = map.base_nodes[nodeIndex];
    const now = Date.now();
    const fullVariant: Variant = {
      id: variant.id ?? randomUUID(),
      value_formula: variant.value_formula,
      confidence: variant.confidence,
      last_verified: variant.last_verified ?? null,
      fail_count_recent: variant.fail_count_recent ?? 0,
      locale: variant.locale ?? null,
      created_at: variant.created_at ?? now,
      ttl_ms: variant.ttl_ms,
      degraded_at: variant.degraded_at,
    };

    let newVariants = [...node.variants];

    // Mục 3.11: Variant degraded KHÔNG tính vào slot bảo vệ — coi như "đang chờ xoá", nhường slot cho variant mới
    if (newVariants.length >= MAP_CONSTANTS.MAX_VARIANTS_PER_NODE) {
      // Ưu tiên thay thế variant degraded trước nếu có (nhường slot)
      const degradedIndex = newVariants.findIndex((v: any) => v.degraded_at);
      if (degradedIndex !== -1) {
        newVariants[degradedIndex] = fullVariant;
      } else {
        // Nếu không có variant degraded, thay thế variant yếu nhất (Mục 3.11)
        const weakestIndex = this.findWeakestVariantIndex(newVariants);
        newVariants[weakestIndex] = fullVariant;
      }
    } else {
      newVariants.push(fullVariant);
    }

    const updatedNode = { ...node, variants: newVariants, updated_at: now };
    const newNodes = [...map.base_nodes];
    newNodes[nodeIndex] = updatedNode;

    return { ...map, base_nodes: newNodes };
  }

  /**
   * Tìm variant yếu nhất trong danh sách.
   * Yếu nhất = confidence thấp nhất + tần suất quan sát gần nhất thấp nhất (Mục 3.11).
   */
  private findWeakestVariantIndex(variants: Variant[]): number {
    const now = Date.now();
    let weakestIndex = 0;
    let weakestScore = Infinity;

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      // Score = confidence hiện tại, điều chỉnh theo thời gian đã qua
      const timeSinceVerified = v.last_verified ? (now - v.last_verified) : Infinity;
      const isExpired = timeSinceVerified > v.ttl_ms;
      const score = isExpired
        ? v.confidence * 0.1 // Đã quá hạn TTL → giảm mạnh
        : v.confidence * (1 - timeSinceVerified / v.ttl_ms * 0.5);

      if (score < weakestScore) {
        weakestScore = score;
        weakestIndex = i;
      }
    }

    return weakestIndex;
  }

  /**
   * Lấy variant ưu tiên nhất cho 1 node (sắp xếp theo confidence decay-theo-thời-gian).
   */
  getVariantsByPriority(node: ResourceNode): Variant[] {
    const now = Date.now();
    return [...node.variants].sort((a, b) => {
      const scoreA = this.calcVariantScore(a, now);
      const scoreB = this.calcVariantScore(b, now);
      return scoreB - scoreA; // Cao → thấp
    });
  }

  /**
   * Tính điểm ưu tiên cho variant, có decay theo thời gian (Mục 3.11).
   */
  private calcVariantScore(variant: Variant, now: number): number {
    const timeSinceVerified = variant.last_verified
      ? (now - variant.last_verified)
      : variant.ttl_ms; // Chưa bao giờ verify → coi như đã qua hết TTL

    // Decay factor: giảm dần theo thời gian
    const decayFactor = Math.max(0, 1 - timeSinceVerified / variant.ttl_ms);

    // Phạt thêm cho fail_count_recent
    const failPenalty = Math.max(0, 1 - variant.fail_count_recent * 0.15);

    return variant.confidence * decayFactor * failPenalty;
  }

  // --------------------------------------------------------------------------
  // STATE GRAPH OPERATIONS (Phase 1+ nhưng schema sẵn từ Phase 0)
  // --------------------------------------------------------------------------

  /**
   * Thêm StateNode vào state_graph.
   */
  addState(map: MapFile, state: StateNode): MapFile {
    if (map.state_graph.some(s => s.id === state.id)) {
      throw new Error(`State "${state.id}" already exists.`);
    }
    const normalizedState: StateNode = {
      ...state,
      preconditions: state.preconditions ?? [],
      transitions: state.transitions ?? [],
    };
    return {
      ...map,
      state_graph: [...map.state_graph, normalizedState],
    };
  }

  /**
   * Thêm transition giữa 2 state.
   */
  addTransition(map: MapFile, fromStateId: string, actionRef: string, targetStateId: string): MapFile {
    const stateIndex = map.state_graph.findIndex(s => s.id === fromStateId);
    if (stateIndex === -1) {
      throw new Error(`State "${fromStateId}" not found.`);
    }

    // Kiểm tra target state tồn tại
    if (!map.state_graph.some(s => s.id === targetStateId)) {
      throw new Error(`Target state "${targetStateId}" not found.`);
    }

    const state = map.state_graph[stateIndex];
    const newStates = [...map.state_graph];
    newStates[stateIndex] = {
      ...state,
      transitions: [...(state.transitions ?? []), { action_ref: actionRef, target_state_id: targetStateId }],
    };

    return { ...map, state_graph: newStates };
  }

  // --------------------------------------------------------------------------
  // ACCOUNT SLOT OPERATIONS (Mục 3.9 — Phân tách dữ liệu theo tài khoản)
  // --------------------------------------------------------------------------

  /**
   * Thêm một account slot mới vào Map (dùng account_hash ẩn danh, không dùng email/PII).
   */
  addAccountSlot(map: MapFile, accountHash: string, initialNodes: ResourceNodeInput[] = []): MapFile {
    if (map.account_slots[accountHash]) {
      throw new Error(`Account slot "${accountHash}" already exists.`);
    }

    const now = Date.now();
    const parsedNodes = initialNodes.map(n => {
      const normalizedVariants = (n.variants ?? []).map(v => ({
        fail_count_recent: 0,
        locale: null,
        ...v,
        id: (v as any).id ?? randomUUID(),
        created_at: (v as any).created_at ?? now,
      }));
      return ResourceNodeSchema.parse({
        ...n,
        variants: normalizedVariants,
        created_at: n.created_at ?? now,
        updated_at: n.updated_at ?? now,
      });
    });

    const slot: AccountSlot = AccountSlotSchema.parse({
      account_hash: accountHash,
      delta_nodes: parsedNodes,
    });

    return {
      ...map,
      account_slots: {
        ...map.account_slots,
        [accountHash]: slot,
      },
      updated_at: now,
    };
  }

  /**
   * Lấy thông tin account slot theo hash.
   */
  getAccountSlot(map: MapFile, accountHash: string): AccountSlot | undefined {
    return map.account_slots[accountHash];
  }

  /**
   * Xóa một account slot khỏi Map.
   */
  removeAccountSlot(map: MapFile, accountHash: string): MapFile {
    if (!map.account_slots[accountHash]) {
      throw new Error(`Account slot "${accountHash}" not found.`);
    }

    const newSlots = { ...map.account_slots };
    delete newSlots[accountHash];

    return {
      ...map,
      account_slots: newSlots,
      updated_at: Date.now(),
    };
  }

  /**
   * Thêm hoặc cập nhật một delta node vào account slot.
   */
  addDeltaNode(map: MapFile, accountHash: string, nodeInput: ResourceNodeInput): MapFile {
    let slot = map.account_slots[accountHash];
    if (!slot) {
      // Tự động khởi tạo slot nếu chưa có
      slot = { account_hash: accountHash, delta_nodes: [] };
    }

    const now = Date.now();
    const normalizedVariants = (nodeInput.variants ?? []).map(v => ({
      fail_count_recent: 0,
      locale: null,
      ...v,
      id: (v as any).id ?? randomUUID(),
      created_at: (v as any).created_at ?? now,
    }));

    const node = ResourceNodeSchema.parse({
      ...nodeInput,
      variants: normalizedVariants,
      created_at: nodeInput.created_at ?? now,
      updated_at: nodeInput.updated_at ?? now,
    });

    const existingIndex = slot.delta_nodes.findIndex(n => n.id === node.id || n.intent === node.intent);
    let newDeltaNodes: ResourceNode[];

    if (existingIndex !== -1) {
      newDeltaNodes = [...slot.delta_nodes];
      newDeltaNodes[existingIndex] = node;
    } else {
      newDeltaNodes = [...slot.delta_nodes, node];
    }

    return {
      ...map,
      account_slots: {
        ...map.account_slots,
        [accountHash]: {
          ...slot,
          delta_nodes: newDeltaNodes,
        },
      },
      updated_at: now,
    };
  }

  /**
   * Lấy danh sách nodes hiệu dụng (Base nodes + Delta nodes của account tương ứng).
   * Delta node sẽ override Base node nếu trùng id hoặc trùng intent.
   */
  getEffectiveNodes(map: MapFile, accountHash?: string): ResourceNode[] {
    if (!accountHash || !map.account_slots[accountHash]) {
      return [...map.base_nodes];
    }

    const slot = map.account_slots[accountHash];
    const nodeMap = new Map<string, ResourceNode>();

    // 1. Nạp base nodes
    for (const node of map.base_nodes) {
      nodeMap.set(node.intent, node);
    }

    // 2. Nạp delta nodes (override nếu trùng intent hoặc id)
    for (const delta of slot.delta_nodes) {
      nodeMap.set(delta.intent, delta);
    }

    return Array.from(nodeMap.values());
  }

  // --------------------------------------------------------------------------
  // EXPORT / IMPORT FILE MAP (Mục 4 — JSON file-based, local-only)
  // --------------------------------------------------------------------------

  /**
   * Xuất toàn bộ nội dung Map của một domain ra chuỗi JSON.
   */
  exportMapJson(domain: string, indent: boolean = true): string {
    const map = this.loadMap(domain);
    return JSON.stringify(map, null, indent ? 2 : undefined);
  }

  /**
   * Nhập dữ liệu Map từ chuỗi JSON và lưu atomically.
   * Xác thực cấu trúc qua MapFileSchema trước khi ghi đĩa.
   */
  importMapJson(jsonString: string, overwrite: boolean = false): MapFile {
    const rawData = JSON.parse(jsonString);
    const parsedMap = MapFileSchema.parse(rawData);

    const mapPath = this.getMapPath(parsedMap.domain);
    if (existsSync(mapPath) && !overwrite) {
      throw new Error(`Map for domain "${parsedMap.domain}" already exists. Set overwrite=true to replace.`);
    }

    this.saveMap(parsedMap);
    return parsedMap;
  }
}

