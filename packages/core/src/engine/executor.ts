/**
 * Execution Engine — Vòng lặp 5 bước (Mục 7)
 *
 * Dùng trong cả Tool và bước Dry-run của Nhà máy.
 * PHẢI theo đúng thứ tự, không được bỏ bước:
 *
 * 1. Resolve: khớp trạng thái hiện tại với StateNode
 * 2. Verify-before-act: kiểm tra rẻ tiền trước khi thực thi
 * 3. Act: thực thi action qua primitive
 * 4. Confirm: kiểm tra kết quả đúng kỳ vọng
 * 5. Fallback: thử variant kế tiếp / fuzzy heal / dừng + log
 *
 * Tool KHÔNG BAO GIỜ gọi LLM ở bước Fallback (Mục 7, bước 5).
 */

import type {
  Action,
  ResourceNode,
  Variant,
  MapFile,
  StateNode,
  StructuredLogEntry,
} from '../map/schema.js';
import { MAP_CONSTANTS } from '../map/schema.js';
import { MapStore } from '../map/store.js';
import type { BrowserAdapter, ActionResult } from '../actions/primitives.js';
import { ActionRegistry } from '../actions/primitives.js';
import { locateElement, findByFuzzyHeal } from '../locator/index.js';

// ============================================================================
// ENGINE TYPES
// ============================================================================

export interface EngineConfig {
  /** Có phải đang chạy trong Tool (không có LLM) hay Dry-run (có LLM giám sát) */
  mode: 'tool' | 'dry_run';

  /** Timeout cho mỗi step (ms) */
  stepTimeoutMs: number;

  /** Có log chi tiết không */
  verbose: boolean;
}

export interface StepResult {
  /** Action đã thực thi */
  action: Action;

  /** Kết quả từ action primitive */
  actionResult: ActionResult | null;

  /** Bước nào trong engine loop */
  engineStep: 'resolve' | 'verify' | 'act' | 'confirm' | 'fallback';

  /** Tổng thể thành công hay thất bại */
  success: boolean;

  /** Log entry */
  log: StructuredLogEntry;
}

export interface ExecutionResult {
  /** Tổng thể thành công hay thất bại */
  success: boolean;

  /** Kết quả từng bước */
  steps: StepResult[];

  /** Log entries */
  logs: StructuredLogEntry[];

  /** Thời gian tổng (ms) */
  total_duration_ms: number;
}

// ============================================================================
// CIRCUIT BREAKER — Cấp Tool (Mục 7.1)
// ============================================================================

interface FailRecord {
  timestamp: number;
  nodeId: string;
}

export class CircuitBreaker {
  private failRecords: FailRecord[] = [];
  private readonly maxFails: number;
  private readonly windowMs: number;
  private tripped: boolean = false;

  constructor(
    maxFails: number = MAP_CONSTANTS.CIRCUIT_BREAKER_MAX_FAILS,
    windowMs: number = MAP_CONSTANTS.CIRCUIT_BREAKER_WINDOW_MS,
  ) {
    this.maxFails = maxFails;
    this.windowMs = windowMs;
  }

  /**
   * Ghi nhận 1 lần fail.
   * @returns true nếu circuit breaker đã kích hoạt (vượt ngưỡng)
   */
  recordFail(nodeId: string): boolean {
    const now = Date.now();
    this.failRecords.push({ timestamp: now, nodeId });

    // Cleanup records cũ ngoài window
    this.failRecords = this.failRecords.filter(r => now - r.timestamp < this.windowMs);

    if (this.failRecords.length >= this.maxFails) {
      this.tripped = true;
    }

    return this.tripped;
  }

  /** Circuit breaker đã kích hoạt? */
  isTripped(): boolean {
    // Re-check: nếu đã đủ lâu không có fail mới, tự reset
    if (this.tripped) {
      const now = Date.now();
      this.failRecords = this.failRecords.filter(r => now - r.timestamp < this.windowMs);
      if (this.failRecords.length < this.maxFails) {
        this.tripped = false;
      }
    }
    return this.tripped;
  }

  /** Reset thủ công */
  reset(): void {
    this.failRecords = [];
    this.tripped = false;
  }
}

// ============================================================================
// EXECUTION ENGINE
// ============================================================================

export class ExecutionEngine {
  private readonly registry: ActionRegistry;
  private readonly mapStore: MapStore;
  private readonly config: EngineConfig;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    registry: ActionRegistry,
    mapStore: MapStore,
    config: Partial<EngineConfig> = {},
  ) {
    this.registry = registry;
    this.mapStore = mapStore;
    this.config = {
      mode: config.mode ?? 'tool',
      stepTimeoutMs: config.stepTimeoutMs ?? 30000,
      verbose: config.verbose ?? false,
    };
    this.circuitBreaker = new CircuitBreaker();
  }

  /** Lấy instance CircuitBreaker của engine */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Thực thi chuỗi actions.
   */
  async execute(
    actions: Action[],
    map: MapFile,
    browser: BrowserAdapter,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const steps: StepResult[] = [];
    const logs: StructuredLogEntry[] = [];
    let overallSuccess = true;

    for (const action of actions) {
      // Kiểm tra circuit breaker trước mỗi action
      if (this.circuitBreaker.isTripped()) {
        const log = this.createLog('error', 'engine', action.node_ref,
          'Circuit breaker tripped — execution paused. Cần kiểm tra và xử lý.');
        logs.push(log);
        overallSuccess = false;
        break;
      }

      const stepResult = await this.executeStep(action, map, browser);
      steps.push(stepResult);
      logs.push(stepResult.log);

      if (!stepResult.success) {
        overallSuccess = false;

        // Ghi nhận fail vào circuit breaker
        if (action.node_ref) {
          this.circuitBreaker.recordFail(action.node_ref);
        }

        // Xử lý on_failure
        switch (action.on_failure) {
          case 'stop':
            return { success: false, steps, logs, total_duration_ms: Date.now() - startTime };

          case 'skip_and_continue':
            // Tiếp tục action kế tiếp
            overallSuccess = false; // Đánh dấu có ít nhất 1 fail
            continue;

          case 'ask_user':
            // Dừng và bàn giao — trong Phase 0, tương đương stop + log
            const userLog = this.createLog('warn', 'engine', action.node_ref,
              `Action "${action.id}" failed — requires user intervention (on_failure: ask_user).`);
            logs.push(userLog);
            return { success: false, steps, logs, total_duration_ms: Date.now() - startTime };
        }
      }
    }

    return {
      success: overallSuccess,
      steps,
      logs,
      total_duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Thực thi 1 action — vòng lặp 5 bước.
   */
  private async executeStep(
    action: Action,
    map: MapFile,
    browser: BrowserAdapter,
  ): Promise<StepResult> {
    const node = action.node_ref
      ? this.mapStore.findNode(map, action.node_ref)
      : null;

    // ---- Step 1: RESOLVE ----
    // Khớp trạng thái hiện tại với StateNode (simplified cho Phase 0)
    // Phase 0 chưa có State-Transition Graph đầy đủ, nên bước này chỉ resolve node
    if (action.node_ref && !node) {
      return {
        action,
        actionResult: null,
        engineStep: 'resolve',
        success: false,
        log: this.createLog('error', 'engine', action.node_ref,
          `Resolve failed: node "${action.node_ref}" not found in Map.`),
      };
    }

    // ---- Step 2: VERIFY-BEFORE-ACT ----
    // Kiểm tra rẻ tiền với variant confidence cao nhất
    const sortedVariants = node
      ? this.mapStore.getVariantsByPriority(node)
      : [];

    if (node && sortedVariants.length === 0) {
      return {
        action,
        actionResult: null,
        engineStep: 'verify',
        success: false,
        log: this.createLog('error', 'engine', action.node_ref,
          `Verify failed: no variants available for node "${action.node_ref}".`),
      };
    }

    // Verify: kiểm tra element tồn tại (cho click/fill/extract)
    // Dùng locateElement() — đi qua 5-tier đúng thứ tự (Mục 6.1)
    if (node && sortedVariants.length > 0 && ['click', 'fill', 'extract'].includes(action.type)) {
      const topVariant = sortedVariants[0];
      try {
        const locResult = await locateElement(browser, {
          intent: node.intent,
          formula: topVariant.value_formula,
          skipTiers: [3, 4, 5], // Mục 7 bước 2: kiểm tra rẻ tiền (Tier 1 & 2), chưa chạy Elevated hay Fuzzy heal
        });

        if (!locResult.found) {
          // Không tier nào tìm được → chuyển thẳng sang Fallback (bước 5)
          // KHÔNG lãng phí 1 lượt Act
          return await this.executeFallback(action, node, sortedVariants.slice(1), browser, 'verify');
        }
      } catch {
        // Verify thất bại → chuyển sang Fallback
        return await this.executeFallback(action, node, sortedVariants.slice(1), browser, 'verify');
      }
    }

    // ---- Step 3: ACT ----
    const primitive = this.registry.get(action.type);
    if (!primitive) {
      return {
        action,
        actionResult: null,
        engineStep: 'act',
        success: false,
        log: this.createLog('error', 'engine', action.node_ref,
          `Act failed: unknown action type "${action.type}".`),
      };
    }

    const currentVariant = sortedVariants.length > 0 ? sortedVariants[0] : null;
    const actionResult = await primitive.execute({
      browser,
      node,
      currentVariant,
      params: action.params,
    });

    // ---- Step 4: CONFIRM ----
    if (actionResult.success) {
      // Mục 7 step 4: Với tài liệu cộng tác / CRDT, confirm PHẢI đọc lại nhiều lần liên tiếp
      const isCrdt = Boolean(action.params?.['is_crdt'] || action.params?.['crdt_confirm']);
      if (isCrdt && ['fill', 'click', 'extract'].includes(action.type)) {
        const crdtCheck = await this.confirmCrdtStability(browser, node);
        if (!crdtCheck.stable) {
          return {
            action,
            actionResult: {
              ...actionResult,
              success: false,
              error: `CRDT multi-read confirm failed: Value did not converge across consecutive reads (${crdtCheck.readsCount} reads).`,
            },
            engineStep: 'confirm',
            success: false,
            log: this.createLog('warn', 'engine', action.node_ref,
              `CRDT stability check failed for action "${action.id}". Value is still mutating.`,
              { crdt_reads_count: crdtCheck.readsCount },
            ),
          };
        }
      }

      // Ghi nhận thành công
      const usedFallback = actionResult.used_fallback;
      const log = this.createLog(
        usedFallback ? 'warn' : 'info',
        'engine',
        action.node_ref,
        usedFallback
          ? `Action "${action.id}" succeeded using fallback variant — Map may need update.`
          : `Action "${action.id}" completed successfully.`,
        { used_fallback_variant: usedFallback },
      );

      return {
        action,
        actionResult,
        engineStep: 'confirm',
        success: true,
        log,
      };
    }

    // ---- Step 5: FALLBACK ----
    // Action chính thất bại → thử variants còn lại
    if (node && sortedVariants.length > 1) {
      return await this.executeFallback(action, node, sortedVariants.slice(1), browser, 'fallback');
    }

    // Hết mọi option → log + dừng
    return {
      action,
      actionResult,
      engineStep: 'fallback',
      success: false,
      log: this.createLog('error', 'engine', action.node_ref,
        `All variants exhausted for action "${action.id}". Node: ${action.node_ref}`,
        {
          attempted_variant_ids: sortedVariants.map(v => v.id),
          last_error: actionResult.error,
        },
      ),
    };
  }

  /**
   * Step 5: Fallback — thử variant kế tiếp.
   * CHỈ trong phạm vi Tool, TUYỆT ĐỐI KHÔNG gọi LLM (Mục 7, bước 5).
   */
  private async executeFallback(
    action: Action,
    node: ResourceNode,
    remainingVariants: Variant[],
    browser: BrowserAdapter,
    triggeredFrom: 'verify' | 'fallback',
  ): Promise<StepResult> {
    const primitive = this.registry.get(action.type);
    if (!primitive) {
      return {
        action,
        actionResult: null,
        engineStep: 'fallback',
        success: false,
        log: this.createLog('error', 'engine', action.node_ref,
          `Fallback failed: unknown action type "${action.type}".`),
      };
    }

    // Thử từng variant còn lại (Mục 7, bước 5)
    for (const variant of remainingVariants) {
      try {
        const result = await primitive.execute({
          browser,
          node,
          currentVariant: variant,
          params: action.params,
        });

        if (result.success) {
          // Mục 7: "Log PHẢI ghi nhận cả những lần dùng variant không phải ưu tiên #1
          // nhưng vẫn thành công" → tín hiệu cảnh báo sớm Map đang lệch
          return {
            action,
            actionResult: { ...result, used_fallback: true },
            engineStep: 'fallback',
            success: true,
            log: this.createLog('warn', 'engine', action.node_ref,
              `Fallback succeeded with non-primary variant "${variant.id}". Map may need re-verification.`,
              {
                used_fallback_variant: true,
                fallback_variant_id: variant.id,
                triggered_from: triggeredFrom,
              },
            ),
          };
        }
      } catch {
        // Variant này cũng fail → tiếp tục thử variant kế
        continue;
      }
    }

    // Hết variant → thử Fuzzy local-heal (Mục 7 bước 5 & Mục 6.1 Tier 4)
    // Không cần mạng, không cần LLM, không ghi gì mới vào Map
    if (['click', 'fill', 'extract'].includes(action.type)) {
      try {
        const fuzzyResult = await findByFuzzyHeal(browser, {
          intent: node.intent,
          formula: node.variants[0]?.value_formula,
        });

        if (fuzzyResult.found && fuzzyResult.value) {
          const healedData = fuzzyResult.value as { selector?: string };
          const healedSelector = healedData.selector || (fuzzyResult.value as any).text;
          if (healedSelector) {
            // Thử thực thi với selector được chữa lành tạm thời
            const healedVariant: Variant = {
              id: `healed_${Date.now()}`,
              value_formula: healedSelector,
              confidence: fuzzyResult.confidence ?? MAP_CONSTANTS.FUZZY_HEAL_MIN_CONFIDENCE,
              last_verified: Date.now(),
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
              ttl_ms: 3600000,
            };

            const healExecResult = await primitive.execute({
              browser,
              node,
              currentVariant: healedVariant,
              params: action.params,
            });

            if (healExecResult.success) {
              return {
                action,
                actionResult: { ...healExecResult, used_fallback: true },
                engineStep: 'fallback',
                success: true,
                log: this.createLog('warn', 'engine', action.node_ref,
                  `Fallback succeeded using Tier 4 Fuzzy Local-Heal (confidence: ${fuzzyResult.confidence}). Map was NOT modified.`,
                  {
                    used_fuzzy_heal: true,
                    fuzzy_confidence: fuzzyResult.confidence,
                    triggered_from: triggeredFrom,
                  },
                ),
              };
            }
          }
        }
      } catch {
        // Fuzzy heal gặp lỗi → tiếp tục bước dừng
      }
    }

    // Hết mọi tier fallback → Dừng + log có cấu trúc (Mục 7 bước 5)
    return {
      action,
      actionResult: null,
      engineStep: 'fallback',
      success: false,
      log: this.createLog('error', 'engine', action.node_ref,
        `All fallback variants and fuzzy-heal exhausted for action "${action.id}".`,
        {
          attempted_variant_ids: remainingVariants.map(v => v.id),
          triggered_from: triggeredFrom,
        },
      ),
    };
  }

  /**
   * Step 4 Confirm: Đọc lại N lần liên tiếp cho tài liệu cộng tác / CRDT (Mục 7 step 4).
   * Coi là ổn định khi giá trị không đổi qua requiredConsecutiveReads lần đọc liên tiếp.
   */
  private async confirmCrdtStability(
    browser: BrowserAdapter,
    node: ResourceNode | null,
    requiredConsecutiveReads: number = MAP_CONSTANTS.CRDT_REQUIRED_CONSECUTIVE_READS,
    intervalMs: number = MAP_CONSTANTS.CRDT_READ_INTERVAL_MS,
    maxWaitMs: number = MAP_CONSTANTS.CRDT_MAX_WAIT_MS,
  ): Promise<{ stable: boolean; readsCount: number }> {
    const selector = node?.variants[0]?.value_formula;
    if (!selector) return { stable: true, readsCount: 1 };

    const startTime = Date.now();
    let consecutiveSame = 0;
    let lastValue: unknown = undefined;
    let totalReads = 0;

    while (Date.now() - startTime < maxWaitMs) {
      totalReads++;
      const currentValue = await browser.evaluate<unknown>(`
        (() => {
          try {
            const el = document.querySelector(${JSON.stringify(selector)});
            return el ? (el.innerText || el.textContent || el.value || '') : null;
          } catch {
            return null;
          }
        })()
      `);

      if (currentValue !== null && currentValue === lastValue) {
        consecutiveSame++;
        if (consecutiveSame >= requiredConsecutiveReads) {
          return { stable: true, readsCount: totalReads };
        }
      } else {
        consecutiveSame = 1;
        lastValue = currentValue;
      }

      await new Promise(res => setTimeout(res, intervalMs));
    }

    return { stable: consecutiveSame >= requiredConsecutiveReads, readsCount: totalReads };
  }

  // --------------------------------------------------------------------------
  // LOGGING
  // --------------------------------------------------------------------------

  private createLog(
    level: StructuredLogEntry['level'],
    source: StructuredLogEntry['source'],
    nodeId: string | null,
    message: string,
    extraContext: Record<string, unknown> = {},
  ): StructuredLogEntry {
    return {
      timestamp: Date.now(),
      level,
      source,
      node_id: nodeId,
      attempted_variant_ids: (extraContext['attempted_variant_ids'] as string[]) ?? [],
      message,
      context: extraContext,
      used_fallback_variant: (extraContext['used_fallback_variant'] as boolean) ?? false,
    };
  }
}
