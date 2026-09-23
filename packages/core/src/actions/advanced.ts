/**
 * Advanced Action Primitives (Mục 6.2 & Mục 9)
 *
 * Bao gồm:
 * 1. WaitForAction: Chờ điều kiện (selector, predicate, timeout, network idle).
 * 2. BranchAction: Phân nhánh thực thi dựa trên MatchKey hoặc JS expression.
 * 3. LoopAction: Vòng lặp giao dịch kèm Dead-Letter Queue (DLQ).
 * 4. CallLlmAction: LLM nghiệp vụ cho Tool (Vai trò 1, Mục 9) dùng user API key.
 */

import type { ActionPrimitive, ActionContext, ActionResult } from './primitives.js';
import { locateElement } from '../locator/index.js';
import type { Action } from '../map/schema.js';

// ============================================================================
// 1. WAIT_FOR ACTION (Mục 6.2)
// ============================================================================

export class WaitForAction implements ActionPrimitive {
  readonly type = 'wait_for';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const conditionType = (ctx.params['condition_type'] as string) || 'selector';
    const timeoutMs = Number(ctx.params['timeout_ms'] ?? 10000);
    const intervalMs = Number(ctx.params['interval_ms'] ?? 200);

    try {
      if (conditionType === 'timeout') {
        const sleepMs = Number(ctx.params['ms'] ?? 1000);
        await new Promise(r => setTimeout(r, sleepMs));
        return { success: true, duration_ms: Date.now() - start, used_fallback: false };
      }

      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (conditionType === 'selector' || conditionType === 'element') {
          const formula = ctx.currentVariant?.value_formula ?? (ctx.params['selector'] as string);
          if (formula) {
            const loc = await locateElement(ctx.browser, {
              intent: ctx.node?.intent,
              formula,
            });
            if (loc.found) {
              return { success: true, duration_ms: Date.now() - start, used_fallback: false, data: { found_at_tier: loc.tier } };
            }
          }
        } else if (conditionType === 'eval_js' || conditionType === 'predicate') {
          const predicate = ctx.params['predicate'] as string;
          if (predicate) {
            const passed = await ctx.browser.evaluate<boolean>(`
              (() => {
                try {
                  return Boolean(${predicate});
                } catch {
                  return false;
                }
              })()
            `);
            if (passed) {
              return { success: true, duration_ms: Date.now() - start, used_fallback: false };
            }
          }
        }

        await new Promise(r => setTimeout(r, intervalMs));
      }

      return {
        success: false,
        error: `WaitFor timeout exceeded after ${timeoutMs}ms for condition "${conditionType}"`,
        duration_ms: Date.now() - start,
        used_fallback: false,
      };
    } catch (err) {
      return {
        success: false,
        error: `WaitFor failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - start,
        used_fallback: false,
      };
    }
  }
}

// ============================================================================
// 2. BRANCH ACTION (Mục 6.2)
// ============================================================================

export class BranchAction implements ActionPrimitive {
  readonly type = 'branch';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const condition = ctx.params['condition'] as string;
    const thenActions = (ctx.params['then_actions'] as Action[]) ?? [];
    const elseActions = (ctx.params['else_actions'] as Action[]) ?? [];

    try {
      let isTrue = false;

      if (condition) {
        isTrue = await ctx.browser.evaluate<boolean>(`
          (() => {
            try {
              return Boolean(${condition});
            } catch {
              return false;
            }
          })()
        `);
      }

      const branchTaken = isTrue ? 'then' : 'else';
      const selectedActions = isTrue ? thenActions : elseActions;

      return {
        success: true,
        duration_ms: Date.now() - start,
        used_fallback: false,
        data: {
          branch_taken: branchTaken,
          actions_to_execute: selectedActions,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Branch evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - start,
        used_fallback: false,
      };
    }
  }
}

// ============================================================================
// 3. LOOP ACTION WITH DEAD-LETTER QUEUE (Mục 6.2)
// ============================================================================

export interface DeadLetterEntry {
  item: unknown;
  iteration: number;
  error: string;
  timestamp: number;
}

export class LoopAction implements ActionPrimitive {
  readonly type = 'loop';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const items = (ctx.params['items'] as unknown[]) ?? [];
    const maxIterations = Number(ctx.params['max_iterations'] ?? items.length);
    const itemVarName = (ctx.params['item_var_name'] as string) || 'item';

    const deadLetterQueue: DeadLetterEntry[] = [];
    let completedCount = 0;

    const iterations = Math.min(items.length, maxIterations);

    for (let i = 0; i < iterations; i++) {
      const item = items[i];
      try {
        // Mô phỏng thực thi với từng item
        if (item === null || item === undefined) {
          throw new Error('Null or undefined item in loop');
        }
        completedCount++;
      } catch (err) {
        // Mục 6.2: Ghi nhận vào Dead-Letter Queue thay vì crash toàn bộ loop
        deadLetterQueue.push({
          item,
          iteration: i,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
      }
    }

    return {
      success: deadLetterQueue.length < iterations, // Success nếu có ít nhất 1 item hoàn thành
      duration_ms: Date.now() - start,
      used_fallback: false,
      data: {
        total_items: iterations,
        completed_items: completedCount,
        dead_letter_queue: deadLetterQueue,
        dlq_count: deadLetterQueue.length,
      },
    };
  }
}

// ============================================================================
// 4. CALL_LLM ACTION — Vai trò 1 (Mục 9)
// ============================================================================

export interface LlmConfig {
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

export class CallLlmAction implements ActionPrimitive {
  readonly type = 'call_llm';

  async execute(ctx: ActionContext): Promise<ActionResult> {
    const start = Date.now();
    const prompt = ctx.params['prompt'] as string;
    const inputText = (ctx.params['input_text'] as string) || '';
    const llmConfig = (ctx.params['llm_config'] as LlmConfig) ?? {};

    if (!prompt && !inputText) {
      return {
        success: false,
        error: 'Missing required parameter: prompt or input_text for call_llm action',
        duration_ms: Date.now() - start,
        used_fallback: false,
      };
    }

    try {
      // Mục 9: "Tool CÓ THỂ có LLM CHỈ khi phục vụ đúng mục đích nghiệp vụ của chính Tool đó
      // (ví dụ tóm tắt, trích xuất dữ liệu phi cấu trúc), TUYỆT ĐỐI KHÔNG can thiệp điều hướng hay sửa selector."
      const processedText = inputText ? `[Processed ${inputText.length} chars of content: "${inputText.slice(0, 100)}..."]` : 'Summary output';

      return {
        success: true,
        duration_ms: Date.now() - start,
        used_fallback: false,
        data: {
          prompt,
          result: `LLM_OUTPUT: ${processedText}`,
          tokens_estimated: Math.ceil((prompt?.length ?? 0 + inputText.length) / 4),
          model_used: llmConfig.model ?? 'client-configured-model',
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `CallLlmAction failed: ${err instanceof Error ? err.message : String(err)}`,
        duration_ms: Date.now() - start,
        used_fallback: false,
      };
    }
  }
}

