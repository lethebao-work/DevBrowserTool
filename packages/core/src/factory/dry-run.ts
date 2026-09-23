/**
 * Factory Dry-Run Runner — Kiểm thử chuỗi actions qua ExecutionEngine (Mục 5.2 bước 4 & Mục 10 lớp 1)
 *
 * Xuất kết quả chi tiết dạng bảng (Step index, Type, Target, Status, Variant, Duration, Error)
 * để UI hiển thị trực quan (không chỉ văn xuôi).
 */

import { ExecutionEngine, type ExecutionResult, type EngineConfig } from '../engine/executor.js';
import { ActionRegistry, type BrowserAdapter } from '../actions/primitives.js';
import { MapStore } from '../map/store.js';
import type { MapFile, Action, ResourceNode } from '../map/schema.js';

export interface DryRunTableRow {
  step_index: number;
  action_id: string;
  action_type: string;
  target_intent: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  variant_used: string;
  duration_ms: number;
  error?: string;
}

export interface DryRunReport {
  success: boolean;
  total_steps: number;
  passed_steps: number;
  failed_steps: number;
  duration_total_ms: number;
  rows: DryRunTableRow[];
  execution_result: ExecutionResult;
}

export class DryRunRunner {
  /**
   * Chạy dry-run một chuỗi action trên browser adapter đã cung cấp.
   */
  static async run(
    browser: BrowserAdapter,
    map: MapFile,
    actions: Action[],
    config?: Partial<EngineConfig>
  ): Promise<DryRunReport> {
    const registry = ActionRegistry.createDefault();
    const mapStore = new MapStore('');
    const engine = new ExecutionEngine(registry, mapStore, config);
    const startTime = Date.now();

    const execResult = await engine.execute(actions, map, browser);
    const totalDuration = Date.now() - startTime;

    // Lập chỉ mục node map để lấy intent cho bảng
    const nodeMap = new Map<string, ResourceNode>();
    for (const node of map.base_nodes) {
      nodeMap.set(node.id, node);
    }

    const rows: DryRunTableRow[] = [];
    let passedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const stepResult = execResult.steps.find(s => s.action.id === action.id);
      const targetNode = action.node_ref ? nodeMap.get(action.node_ref) : null;
      const targetIntent = targetNode ? targetNode.intent : (action.type === 'navigate' ? String(action.params.url ?? '') : (action.description ?? 'N/A'));

      if (!stepResult) {
        // Bị bỏ qua do bước trước fail
        rows.push({
          step_index: i + 1,
          action_id: action.id,
          action_type: action.type,
          target_intent: targetIntent,
          status: 'SKIPPED',
          variant_used: 'None',
          duration_ms: 0,
        });
        continue;
      }

      if (stepResult.success) {
        passedCount++;
      } else {
        failedCount++;
      }

      rows.push({
        step_index: i + 1,
        action_id: action.id,
        action_type: action.type,
        target_intent: targetIntent,
        status: stepResult.success ? 'PASS' : 'FAIL',
        variant_used: stepResult.log.attempted_variant_ids?.[0] ?? (targetNode?.variants?.[0]?.id ?? 'default'),
        duration_ms: stepResult.actionResult?.duration_ms ?? 0,
        error: stepResult.actionResult?.error ?? (stepResult.log.level === 'error' ? stepResult.log.message : undefined),
      });
    }

    return {
      success: execResult.success,
      total_steps: actions.length,
      passed_steps: passedCount,
      failed_steps: failedCount,
      duration_total_ms: totalDuration,
      rows,
      execution_result: execResult,
    };
  }

  /**
   * Tạo chuỗi định dạng bảng Markdown của kết quả Dry-Run (phục vụ hiển thị UI / report)
   */
  static formatMarkdownTable(report: DryRunReport): string {
    const lines: string[] = [
      '| # | Action | Target / Intent | Status | Variant | Duration | Error |',
      '|---|---|---|---|---|---|---|',
    ];

    for (const row of report.rows) {
      const statusIcon = row.status === 'PASS' ? '✅ PASS' : (row.status === 'FAIL' ? '❌ FAIL' : '⏭️ SKIPPED');
      const err = row.error ? `\`${row.error.replace(/\|/g, '\\|')}\`` : '—';
      lines.push(
        `| ${row.step_index} | ${row.action_type} | ${row.target_intent} | ${statusIcon} | ${row.variant_used} | ${row.duration_ms}ms | ${err} |`
      );
    }

    return lines.join('\n');
  }
}
