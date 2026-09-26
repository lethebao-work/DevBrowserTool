/**
 * ToolFactory — Quy trình 5 bước xây dựng Tool hoàn chỉnh từ Map (Mục 5)
 *
 * 5 bước Nhà máy:
 * 1. Lập kế hoạch (StateGraphPlanner)
 * 2. Biên dịch (ActionCompiler — giữ TOÀN BỘ variants)
 * 3. Tham số hoá (Parameterizer — tách biến động)
 * 4. Dry-run (DryRunRunner — test qua ExecutionEngine)
 * 5. Đóng gói (ExtensionPackager — xuất Chrome extension MV3)
 *
 * Kiểm tra ngân sách khám phá bổ sung (Mục 5.5, 15: 10 calls / 5000 tokens / 3 attempts).
 */

import { StateGraphPlanner, type PlannerOptions } from './planner.js';
import { ActionCompiler, type ActionCompileSpec } from './compiler.js';
import { Parameterizer, type ToolInputParams } from './parameterizer.js';
import { DryRunRunner, type DryRunReport } from './dry-run.js';
import { ExtensionPackager, type PackagingResult } from '../packager/packager.js';
import type { BrowserAdapter } from '../actions/primitives.js';
import {
  type MapFile,
  type ToolConfig,
  type Action,
  type ResourceNode,
  MAP_CONSTANTS,
} from '../map/schema.js';

export interface BuildToolOptions {
  /** Tên công cụ */
  tool_name: string;
  /** Thư mục đích xuất Extension */
  output_dir: string;
  /** Browser adapter để chạy dry-run (nếu muốn dry-run trước khi package) */
  browser?: BrowserAdapter;
  /** Bỏ qua dry-run nếu đặt true (mặc định false) */
  skip_dry_run?: boolean;
  /** Kế hoạch từ State Graph (nếu muốn build từ 2 state) */
  state_plan?: {
    start_state_id: string;
    goal_state_id: string;
    options?: PlannerOptions;
  };
  /** Hoặc danh sách specs thao tác trực tiếp */
  action_specs?: ActionCompileSpec[];
  /** Loại package cần xuất (chrome_extension, userscript, advisor_overlay, agent_script) */
  package_type?: ToolConfig['package_type'];
  /** Giá trị tham số cung cấp cho dry-run */
  param_values?: Record<string, unknown>;
  /** Tùy chỉnh input params metadata */
  param_overrides?: Partial<ToolInputParams>;
}

export interface BuildToolResult {
  success: boolean;
  tool_config: ToolConfig;
  dry_run_report?: DryRunReport;
  package_result?: PackagingResult;
  missing_intents: string[];
  budget_exhausted?: boolean;
  error?: string;
}

export class ToolFactory {
  private discoveryCallsUsed: number = 0;
  private discoveryTokensUsed: number = 0;
  private discoveryAttempts: number = 0;

  /**
   * Kiểm tra ngân sách khám phá Tháp (Mục 5.5, 15)
   */
  checkDiscoveryBudget(toolCallsToAdd: number = 1, tokensToAdd: number = 500): { allowed: boolean; reason?: string } {
    if (this.discoveryAttempts >= MAP_CONSTANTS.MAX_DISCOVERY_ATTEMPTS) {
      return {
        allowed: false,
        reason: `Đã đạt giới hạn tối đa ${MAP_CONSTANTS.MAX_DISCOVERY_ATTEMPTS} lần thử khám phá (Mục 15). Cần fallback sang Demo Recorder.`,
      };
    }

    if (this.discoveryCallsUsed + toolCallsToAdd > MAP_CONSTANTS.DISCOVERY_BUDGET_MAX_TOOL_CALLS) {
      return {
        allowed: false,
        reason: `Vượt quá ngân sách tool calls (${this.discoveryCallsUsed + toolCallsToAdd} > ${MAP_CONSTANTS.DISCOVERY_BUDGET_MAX_TOOL_CALLS}).`,
      };
    }

    if (this.discoveryTokensUsed + tokensToAdd > MAP_CONSTANTS.DISCOVERY_BUDGET_MAX_TOKENS) {
      return {
        allowed: false,
        reason: `Vượt quá ngân sách token (${this.discoveryTokensUsed + tokensToAdd} > ${MAP_CONSTANTS.DISCOVERY_BUDGET_MAX_TOKENS}).`,
      };
    }

    return { allowed: true };
  }

  /**
   * Ghi nhận sử dụng ngân sách khám phá
   */
  consumeDiscoveryBudget(toolCalls: number, tokens: number): void {
    this.discoveryCallsUsed += toolCalls;
    this.discoveryTokensUsed += tokens;
    this.discoveryAttempts += 1;
  }

  /**
   * Quy trình Build 5 bước trọn gói
   */
  async build(map: MapFile, options: BuildToolOptions): Promise<BuildToolResult> {
    let actions: Action[] = [];
    let mapSnapshot: ResourceNode[] = [];
    let missingIntents: string[] = [];

    // BƯỚC 1: Lập kế hoạch (nếu có state_plan) hoặc dùng action_specs
    if (options.state_plan) {
      const planResult = StateGraphPlanner.findPath(
        map,
        options.state_plan.start_state_id,
        options.state_plan.goal_state_id,
        options.state_plan.options
      );

      if (!planResult.success) {
        return {
          success: false,
          tool_config: null as any,
          missing_intents: [],
          error: `Bước 1 (Lập kế hoạch) thất bại: ${planResult.error}`,
        };
      }

      // BƯỚC 2: Biên dịch từ State Plan
      const compileResult = ActionCompiler.compileFromPlan(map, planResult.path);
      actions = compileResult.actions;
      mapSnapshot = compileResult.map_snapshot;
      missingIntents = compileResult.missing_intents;
    } else if (options.action_specs && options.action_specs.length > 0) {
      // BƯỚC 2: Biên dịch từ Action Specs
      const compileResult = ActionCompiler.compileFromSpecs(map, options.action_specs);
      actions = compileResult.actions;
      mapSnapshot = compileResult.map_snapshot;
      missingIntents = compileResult.missing_intents;
    } else {
      return {
        success: false,
        tool_config: null as any,
        missing_intents: [],
        error: 'Không có state_plan hoặc action_specs nào được cung cấp.',
      };
    }

    // Kiểm tra thiếu node (Mục 5.5)
    if (missingIntents.length > 0) {
      const budget = this.checkDiscoveryBudget(missingIntents.length, missingIntents.length * 400);
      if (!budget.allowed) {
        return {
          success: false,
          tool_config: null as any,
          missing_intents: missingIntents,
          budget_exhausted: true,
          error: `Thiếu ResourceNode cho các intents: [${missingIntents.join(', ')}]. Ngân sách Tháp: ${budget.reason}`,
        };
      }
    }

    // BƯỚC 3: Tham số hoá (Parameterize)
    const placeholders = Parameterizer.extractPlaceholders(actions);
    const inputParamsConfig = Parameterizer.buildInputParamsConfig(placeholders, options.param_overrides);

    // Gán default_value từ param_values nếu config chưa có
    if (options.param_values) {
      for (const [key, val] of Object.entries(options.param_values)) {
        if (inputParamsConfig[key] && inputParamsConfig[key].default_value === undefined) {
          inputParamsConfig[key].default_value = val;
        }
      }
    }

    // Chuẩn bị actions để dry-run (nội suy giá trị tạm thời chỉ cho mục đích chạy thử trên browser)
    const executableActions = options.param_values
      ? Parameterizer.interpolateActions(actions, options.param_values)
      : actions;

    // BƯỚC 4: Dry-Run (nếu có browser và không bị skip)
    let dryRunReport: DryRunReport | undefined;
    if (options.browser && !options.skip_dry_run) {
      // Chuẩn bị snapshot map cho engine chạy thử
      const dryRunMap: MapFile = {
        ...map,
        base_nodes: mapSnapshot,
      };

      dryRunReport = await DryRunRunner.run(options.browser, dryRunMap, executableActions);

      if (!dryRunReport.success) {
        return {
          success: false,
          tool_config: null as any,
          dry_run_report: dryRunReport,
          missing_intents: missingIntents,
          error: `Bước 4 (Dry-run) thất bại: ${dryRunReport.failed_steps}/${dryRunReport.total_steps} bước không vượt qua.`,
        };
      }
    }

    // Tạo ToolConfig chuẩn (GIỮ NGUYÊN placeholder {{param}} để người dùng cuối thay đổi tham số)
    const toolConfig: ToolConfig = {
      name: options.tool_name,
      description: `Tool generated for ${map.domain}`,
      target_domain: map.domain,
      map_schema_version: map.schema_version,
      map_content_revision: map.content_revision,
      package_type: options.package_type || 'chrome_extension',
      input_params: Parameterizer.toInputParamsList(inputParamsConfig),
      actions: actions,
      map_snapshot: {
        nodes: mapSnapshot,
        states: [],
      },
      built_at: Date.now(),
    };

    // BƯỚC 5: Đóng gói (Package Extension — giữ nguyên template placeholder và resolveParamValue tại runtime)
    const packageResult = ExtensionPackager.package({
      toolConfig,
      actions: actions,
      mapFile: map,
      outputDir: options.output_dir,
    });

    return {
      success: true,
      tool_config: toolConfig,
      dry_run_report: dryRunReport,
      package_result: packageResult,
      missing_intents: missingIntents,
    };
  }
}
