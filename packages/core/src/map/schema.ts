/**
 * Map Schema — Đặc tả Mục 4
 *
 * Định nghĩa cấu trúc dữ liệu cho Map (tri thức tích luỹ về website).
 * Map CHỈ mô tả cấu trúc/cách thao tác với website, KHÔNG chứa dữ liệu nghiệp vụ.
 *
 * Gồm 2 lớp:
 * - Resource Graph: endpoint, DOM, schema, persistence, websocket, hardware_bound
 * - State-Transition Graph: trạng thái + hành động chuyển trạng thái + precondition
 */

import { z } from 'zod';

// ============================================================================
// CONSTANTS — Ngưỡng đã chốt (Mục 3.11, 3.8, 7.1)
// ============================================================================

export const MAP_CONSTANTS = {
  /** Ngưỡng confidence được coi là "cao" (Mục 15.1) */
  CONFIDENCE_HIGH: 0.85,
  /** Ngưỡng tin cậy tối thiểu cho Fuzzy local-heal (Mục 15.1, Mục 6.1 tier 4) */
  FUZZY_HEAL_MIN_CONFIDENCE: 0.85,
  /** TTL mặc định cho node thường (milliseconds) — 30 ngày */
  TTL_NORMAL_MS: 30 * 24 * 60 * 60 * 1000,
  /** TTL cho node discovered via escape_hatch (milliseconds) — 7 ngày */
  TTL_ESCAPE_HATCH_MS: 7 * 24 * 60 * 60 * 1000,
  /** Số lượng Variant tối đa mỗi node */
  MAX_VARIANTS_PER_NODE: 5,
  /** Circuit breaker: số fail tối đa trong khung thời gian */
  CIRCUIT_BREAKER_MAX_FAILS: 5,
  /** Circuit breaker: khung thời gian (milliseconds) — 10 phút */
  CIRCUIT_BREAKER_WINDOW_MS: 10 * 60 * 1000,
  /** Số lần thử tối đa cho 1 mục tiêu con trước khi xin demo */
  MAX_DISCOVERY_ATTEMPTS: 3,
  /** Ngân sách khám phá bổ sung: tối đa tool calls (Mục 15.4) */
  DISCOVERY_BUDGET_MAX_TOOL_CALLS: 10,
  /** Ngân sách khám phá bổ sung: tối đa tokens (Mục 15.4) */
  DISCOVERY_BUDGET_MAX_TOKENS: 5000,
  /** Số lần quan sát tối thiểu để node được coi là "ổn định" */
  MIN_OBSERVATIONS_FOR_STABLE: 2,
  /** Confidence gán cho variant khi bị degrade (Mục 3.11 bước 1) */
  CONFIDENCE_DEGRADED: 0.1,
  /** Confidence gán cho variant khi rescue thành công (Mục 3.11) */
  CONFIDENCE_RESCUED: 0.5,
  /** Tỷ lệ TTL chờ trước khi cull variant đã degrade (Mục 3.11 bước 2: TTL * ratio) */
  DEGRADE_CULL_TTL_RATIO: 0.5,
  /** CRDT multi-read: số lần đọc liên tiếp giá trị phải giống nhau để coi là hội tụ (Mục 7 step 4, 15.6) */
  CRDT_REQUIRED_CONSECUTIVE_READS: 3,
  /** CRDT multi-read: khoảng cách giữa 2 lần đọc liên tiếp (ms) (Mục 7 step 4, 15.6) */
  CRDT_READ_INTERVAL_MS: 50,
  /** CRDT multi-read: thời gian chờ tối đa trước khi timeout (ms) (Mục 7 step 4, 15.6) */
  CRDT_MAX_WAIT_MS: 1000,
  /** Anti-debug check: tỷ lệ chênh lệch thời gian so với baseline hiệu chuẩn (Mục 3.5, 15.7). Giá trị khởi điểm, sẽ tinh chỉnh theo thực nghiệm. */
  ANTI_DEBUG_TIMING_RATIO_THRESHOLD: 5.0,
  /** Anti-debug check: số vòng lặp warm-up để thiết lập baseline phiên chạy (Mục 3.5, 15.7) */
  ANTI_DEBUG_WARMUP_ITERATIONS: 3,
  /** Anti-debug check: số lần phát hiện bất thường lặp lại tối thiểu trước khi kết luận (Mục 3.5, 15.7) */
  ANTI_DEBUG_MIN_REPEATED_SIGNALS: 2,
  /** Anti-debug check: số lần phát hiện debugger statement lặp trước khi gắn cờ (Mục 3.5, 15.7) */
  ANTI_DEBUG_LOOP_COUNT_THRESHOLD: 3,
  /** Source-first discovery: dung lượng tối đa cho file source-map (10MB) (Mục 3.1, 15.7) */
  SOURCE_MAP_MAX_SIZE_BYTES: 10 * 1024 * 1024,
  /** Site bundle: số bước điều hướng tối đa cho chuỗi khứ hồi OAuth/SSO (Mục 3.13, 15.7) */
  SITE_BUNDLE_MAX_RETURN_STEPS: 5,
  /** Ngưỡng điểm quan trọng để coi là site critical, kích hoạt stealth driver (Mục 8.3, 15.8) */
  CRITICAL_SITE_IMPORTANCE_THRESHOLD: 0.8,
  /** Nhịp gõ phím: thời gian gõ tối thiểu giữa 2 phím (ms) (Mục 8.1, 15.8) */
  STEALTH_TYPING_MIN_DELAY_MS: 50,
  /** Nhịp gõ phím: thời gian gõ tối đa thông thường giữa 2 phím (ms) (Mục 8.1, 15.8) */
  STEALTH_TYPING_MAX_DELAY_MS: 240,
  /** Độ trễ phụ trợ ngẫu nhiên cơ sở (Gaussian jitter base ms) (Mục 8.1, 15.8) */
  STEALTH_JITTER_BASE_MS: 150,
  /** Số điểm nội suy tối thiểu cho quỹ đạo chuột cong Bezier (Mục 8.1, 15.8) */
  STEALTH_MOUSE_BEZIER_STEPS: 20,
  /** Ngưỡng khoảng lệch giữa Heuristic và User override để coi là bất đồng (Mục 3.7, 15.8) */
  IMPORTANCE_ADAPTIVE_DEVIATION_THRESHOLD: 0.25,
  /** Số lần bất đồng liên tiếp tối thiểu để kích hoạt tự học trọng số heuristic (Mục 3.7, 15.8) */
  IMPORTANCE_ADAPTIVE_MIN_DISCREPANCIES: 3,
  /** Cổng mặc định cho Web App UI độc lập (Mục 16, 15.8) */
  WEB_UI_DEFAULT_PORT: 3456,
} as const;

// ============================================================================
// ENUMS & LITERAL TYPES
// ============================================================================

/** Loại ResourceNode (Mục 4) */
export const ResourceNodeType = z.enum([
  'endpoint',
  'dom_element',
  'header_signature',
  'binary_schema',
  'local_persistence',
  'websocket_channel',
  'hardware_bound',
]);
export type ResourceNodeType = z.infer<typeof ResourceNodeType>;

/** Nguồn khám phá (Mục 3.6) */
export const DiscoverySource = z.enum(['normal', 'escape_hatch']);
export type DiscoverySource = z.infer<typeof DiscoverySource>;

/** Nguồn điểm importance (Mục 3.7) */
export const ImportanceSource = z.enum(['auto', 'user', 'hybrid']);
export type ImportanceSource = z.infer<typeof ImportanceSource>;

/** Hành vi khi action thất bại (Mục 6.2 — BẮT BUỘC tường minh) */
export const OnFailure = z.enum(['stop', 'skip_and_continue', 'ask_user']);
export type OnFailure = z.infer<typeof OnFailure>;

/** Loại action primitive (Mục 6.2) */
export const ActionType = z.enum([
  'navigate',
  'fill',
  'click',
  'call_api',
  'extract',
  'call_llm',
  'deep_scan_local',
  'patch_runtime',
  'wait_for',
  'branch',
  'loop',
]);
export type ActionType = z.infer<typeof ActionType>;

// ============================================================================
// VARIANT — Biến thể của 1 node (Mục 3.11)
// ============================================================================

export const VariantSchema = z.object({
  /** ID duy nhất trong node */
  id: z.string().min(1),

  /**
   * Công thức lấy giá trị, KHÔNG phải giá trị thật (Mục 2, nguyên tắc 4).
   * Ví dụ: "document.querySelector('#login-btn')" hoặc "API: POST /api/v1/login"
   */
  value_formula: z.string().min(1),

  /**
   * Confidence — decay theo thời gian gần nhất (Mục 3.11).
   * Tính theo cửa sổ thời gian gần nhất, KHÔNG tích luỹ toàn thời gian.
   * Range: 0.0 — 1.0
   */
  confidence: z.number().min(0).max(1),

  /** Thời điểm xác minh thành công gần nhất */
  last_verified: z.number().nullable(), // timestamp ms

  /** Số lần fail gần đây (trong sliding window) */
  fail_count_recent: z.number().int().min(0).default(0),

  /** Locale quan sát được (Mục 3.12) — null nếu không phụ thuộc text */
  locale: z.string().nullable().default(null),

  /** Thời điểm tạo variant */
  created_at: z.number(),

  /** TTL — thời gian sống (ms). Sau TTL, variant bị hạ ưu tiên */
  ttl_ms: z.number().positive(),

  /** Thời điểm bị hạ ưu tiên (degraded) nếu có — Mục 3.11 */
  degraded_at: z.number().optional(),
});
export type Variant = z.infer<typeof VariantSchema>;
export type VariantInput = z.input<typeof VariantSchema>;

// ============================================================================
// RESOURCE NODE — Đơn vị tài nguyên trong Resource Graph (Mục 4)
// ============================================================================

export const ResourceNodeSchema = z.object({
  /** ID duy nhất, theo intent/vai trò ngữ nghĩa (Mục 3, 4) */
  id: z.string().min(1),

  /** Loại node */
  type: ResourceNodeType,

  /**
   * Vai trò ngữ nghĩa, KHÔNG phải selector thô (Mục 4).
   * Ví dụ: "nút Thích bài viết", "form đăng nhập", "API lấy danh sách sản phẩm"
   */
  intent: z.string().min(1),

  /** Mô tả chi tiết (optional) */
  description: z.string().optional(),

  /** Danh sách biến thể — tối đa MAX_VARIANTS_PER_NODE */
  variants: z.array(VariantSchema).max(MAP_CONSTANTS.MAX_VARIANTS_PER_NODE),

  /** Nguồn khám phá (Mục 3.6) */
  discovered_via: DiscoverySource.default('normal'),

  /**
   * Có yêu cầu elevated access không (Mục 6.3).
   * true nếu closed-shadow-root hoặc patch_runtime
   */
  requires_elevation: z.boolean().default(false),

  /** Thời điểm tạo node */
  created_at: z.number(),

  /** Thời điểm cập nhật gần nhất */
  updated_at: z.number(),
});
export type ResourceNode = z.infer<typeof ResourceNodeSchema>;
export type ResourceNodeInput = z.input<typeof ResourceNodeSchema>;

// ============================================================================
// STATE NODE — Trạng thái trong State-Transition Graph (Mục 4)
// ============================================================================

export const TransitionSchema = z.object({
  /** Tham chiếu tới action thực hiện chuyển trạng thái */
  action_ref: z.string().min(1),
  /** ID của state đích */
  target_state_id: z.string().min(1),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const MatchKeySchema = z.object({
  /**
   * URL pattern — KHÔNG dùng URL đơn lẻ làm khoá duy nhất (Mục 4).
   * Kết hợp với dom_fingerprint và virtual_route.
   */
  url_pattern: z.string().nullable().default(null),

  /** Fingerprint cấu trúc DOM chính */
  dom_fingerprint: z.string().nullable().default(null),

  /** Route ảo (pushState) nếu bắt được */
  virtual_route: z.string().nullable().default(null),
});
export type MatchKey = z.infer<typeof MatchKeySchema>;

export const StateNodeSchema = z.object({
  /** ID duy nhất */
  id: z.string().min(1),

  /** Khoá nhận dạng trạng thái — tổ hợp URL + DOM fingerprint + route ảo */
  match_key: MatchKeySchema,

  /** Các node phải thoả trước khi state này khả dụng */
  preconditions: z.array(z.string()).default([]),

  /** Danh sách chuyển trạng thái */
  transitions: z.array(TransitionSchema).default([]),
});
export type StateNode = z.infer<typeof StateNodeSchema>;

// ============================================================================
// ACCOUNT SLOT — Phân tách dữ liệu theo tài khoản (Mục 3.9)
// ============================================================================

export const AccountSlotSchema = z.object({
  /** Hash định danh nội bộ — KHÔNG dùng email/userId thật */
  account_hash: z.string().min(1),

  /** Nodes riêng cho account này (delta) */
  delta_nodes: z.array(ResourceNodeSchema).default([]),
});
export type AccountSlot = z.infer<typeof AccountSlotSchema>;

// ============================================================================
// MAP FILE — File Map chính (Mục 4)
// ============================================================================

export const MapFileSchema = z.object({
  /** Schema version — đổi khi CẤU TRÚC map thay đổi (hiếm) */
  schema_version: z.string().default('1.0.0'),

  /** Content revision — tăng liên tục theo MỌI cập nhật nội dung */
  content_revision: z.number().int().min(0).default(0),

  /** Domain */
  domain: z.string().min(1),

  /** Bundle ID — liên kết nhiều domain liên quan (Mục 3.13) */
  bundle_id: z.string().nullable().default(null),

  /** Điểm quan trọng của site (Mục 3.7) */
  importance_score: z.number().min(0).max(1).default(0.5),

  /** Nguồn điểm importance */
  importance_source: ImportanceSource.default('auto'),

  /** Resource nodes dùng chung mọi tài khoản */
  base_nodes: z.array(ResourceNodeSchema).default([]),

  /** Slots theo từng tài khoản */
  account_slots: z.record(z.string(), AccountSlotSchema).default({}),

  /** State-Transition Graph */
  state_graph: z.array(StateNodeSchema).default([]),

  /** Thời điểm tạo map */
  created_at: z.number(),

  /** Thời điểm cập nhật gần nhất */
  updated_at: z.number(),
});
export type MapFile = z.infer<typeof MapFileSchema>;

// ============================================================================
// ACTION — Định nghĩa 1 action trong chuỗi thực thi (Mục 6)
// ============================================================================

export const ActionSchema = z.object({
  /** ID duy nhất trong chuỗi */
  id: z.string().min(1),

  /** Loại action */
  type: ActionType,

  /** Tham chiếu tới node trong Map */
  node_ref: z.string().nullable().default(null),

  /** Tham số cho action */
  params: z.record(z.string(), z.unknown()).default({}),

  /**
   * Hành vi khi thất bại — BẮT BUỘC tường minh (Mục 6.2).
   * KHÔNG được có hành vi mặc định ẩn.
   */
  on_failure: OnFailure,

  /** Danh sách variant ID ưu tiên (theo confidence) */
  preferred_variant_ids: z.array(z.string()).default([]),

  /** Mô tả cho người dùng */
  description: z.string().optional(),
});
export type Action = z.infer<typeof ActionSchema>;

// ============================================================================
// TOOL CONFIG — Cấu hình Tool đã biên dịch (Mục 5)
// ============================================================================

export const ToolConfigSchema = z.object({
  /** Tên Tool */
  name: z.string().min(1),

  /** Mô tả Tool */
  description: z.string(),

  /** Domain mục tiêu */
  target_domain: z.string().min(1),

  /** Map version lúc build */
  map_schema_version: z.string(),
  map_content_revision: z.number().int(),

  /** Chuỗi actions đã biên dịch */
  actions: z.array(ActionSchema),

  /** Snapshot các node/variant liên quan từ Map */
  map_snapshot: z.object({
    nodes: z.array(ResourceNodeSchema),
    states: z.array(StateNodeSchema),
  }),

  /** Thời điểm build */
  built_at: z.number(),

  /** Hình thức đóng gói (Mục 5.3) */
  package_type: z.enum(['chrome_extension', 'userscript', 'agent_script', 'advisor_overlay']),

  /** Input parameters (Mục 5.2 bước 3) */
  input_params: z.array(z.object({
    name: z.string(),
    description: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'select']),
    required: z.boolean().default(true),
    default_value: z.unknown().optional(),
    options: z.array(z.string()).optional(), // cho type = 'select'
  })).default([]),
});
export type ToolConfig = z.infer<typeof ToolConfigSchema>;

// ============================================================================
// STRUCTURED LOG — Log có cấu trúc (Mục 7, bước 5)
// ============================================================================

export const StructuredLogEntrySchema = z.object({
  /** Thời điểm */
  timestamp: z.number(),

  /** Mức độ */
  level: z.enum(['info', 'warn', 'error', 'fatal']),

  /** Thành phần sinh log */
  source: z.enum(['tower', 'factory', 'tool', 'engine']),

  /** Node ID liên quan */
  node_id: z.string().nullable().default(null),

  /** Variant IDs đã thử */
  attempted_variant_ids: z.array(z.string()).default([]),

  /** Mô tả sự kiện */
  message: z.string(),

  /** Dữ liệu bổ sung (DOM state, response, etc.) */
  context: z.record(z.string(), z.unknown()).default({}),

  /** Đây có phải lần dùng variant không phải ưu tiên #1 nhưng vẫn thành công? (Mục 7) */
  used_fallback_variant: z.boolean().default(false),
});
export type StructuredLogEntry = z.infer<typeof StructuredLogEntrySchema>;
