/**
 * Discovery Loop Engine — Vòng lặp khám phá Agent-first (Mục 3.1 & Mục 1.2)
 *
 * Nguyên tắc cốt lõi:
 * 1. Static Analysis First: kiểm tra source-maps và swagger trước.
 * 2. Thử tối đa 3 lần cho 1 mục tiêu (MAX_DISCOVERY_ATTEMPTS = 3). Vượt quá -> fallback sang DemoRecorder.
 * 3. Xin demo / xác nhận NGAY TỪ ĐẦU cho các hành động nhạy cảm (OAuth, password, payment, submit).
 * 4. Ổn định: quan sát tối thiểu 2 lần (MIN_OBSERVATIONS_FOR_STABLE = 2), loại trừ HTTP 5xx.
 * 5. Giới hạn ngân sách cứng: DISCOVERY_BUDGET_MAX_TOOL_CALLS = 10, DISCOVERY_BUDGET_MAX_TOKENS = 5000.
 */

import { randomUUID } from 'node:crypto';
import type { BrowserAdapter } from '../actions/primitives.js';
import { locateElement } from '../locator/index.js';
import { MAP_CONSTANTS, type ResourceNode, type Variant } from '../map/schema.js';
import { StaticAnalyzer } from './static-analyzer.js';

export interface DiscoveryGoal {
  target_intent: string;
  is_sensitive?: boolean;
  action_type?: 'click' | 'fill' | 'navigate' | 'call_api';
  role_hint?: string;
  expected_outcome?: string;
}

export interface DiscoveryResult {
  success: boolean;
  node?: ResourceNode;
  requires_user_demo: boolean;
  reason?: string;
  attempts_made: number;
  tool_calls_used: number;
  tokens_used: number;
}

export class DiscoveryLoop {
  private toolCallsUsed: number = 0;
  private tokensUsed: number = 0;

  /**
   * Khám phá một mục tiêu hành động cụ thể trên trang
   */
  async discoverAction(
    browser: BrowserAdapter,
    domain: string,
    goal: DiscoveryGoal
  ): Promise<DiscoveryResult> {
    const isSensitive = goal.is_sensitive || this.checkIfSensitive(goal.target_intent);

    // Mục 3.1 bước 4: Hành động nhạy cảm PHẢI xin demo / xác nhận ngay từ đầu, KHÔNG được tự thử
    if (isSensitive) {
      return {
        success: false,
        requires_user_demo: true,
        reason: `Mục tiêu "${goal.target_intent}" thuộc nhóm hành động nhạy cảm (OAuth / password / thanh toán). Bắt buộc chuyển sang Demo Recorder.`,
        attempts_made: 0,
        tool_calls_used: 0,
        tokens_used: 0,
      };
    }

    // Bước 1: Static analysis first (Mục 3.1 bước 1)
    const baseUrl = browser.getUrl ? await browser.getUrl() : await browser.currentUrl();
    const staticResult = await StaticAnalyzer.analyzePage(browser, baseUrl);
    this.recordBudgetUsage(1, 400);

    const matchedStaticNode = staticResult.candidate_nodes.find(n =>
      n.intent.toLowerCase().includes(goal.target_intent.toLowerCase())
    );

    if (matchedStaticNode) {
      return {
        success: true,
        node: {
          ...matchedStaticNode,
          id: matchedStaticNode.id ?? randomUUID(),
          variants: (matchedStaticNode.variants ?? []).map(v => ({
            fail_count_recent: 0,
            locale: null,
            ...v,
            id: v.id ?? randomUUID(),
            created_at: v.created_at ?? Date.now(),
          })),
          created_at: Date.now(),
          updated_at: Date.now(),
        } as ResourceNode,
        requires_user_demo: false,
        attempts_made: 1,
        tool_calls_used: this.toolCallsUsed,
        tokens_used: this.tokensUsed,
      };
    }

    // Bước 2: Agent-first discovery loop (Mục 3.1 bước 2 & 3)
    let attempts = 0;
    const observedVariants: Variant[] = [];

    while (attempts < MAP_CONSTANTS.MAX_DISCOVERY_ATTEMPTS) {
      // Kiểm tra ngân sách
      if (
        this.toolCallsUsed >= MAP_CONSTANTS.DISCOVERY_BUDGET_MAX_TOOL_CALLS ||
        this.tokensUsed >= MAP_CONSTANTS.DISCOVERY_BUDGET_MAX_TOKENS
      ) {
        return {
          success: false,
          requires_user_demo: true,
          reason: `Vượt quá ngân sách khám phá Tháp (Calls: ${this.toolCallsUsed}, Tokens: ${this.tokensUsed}). Fallback sang Demo Recorder.`,
          attempts_made: attempts,
          tool_calls_used: this.toolCallsUsed,
          tokens_used: this.tokensUsed,
        };
      }

      attempts++;
      this.recordBudgetUsage(1, 500);

      // Thử định vị phần tử theo semantic intent (Tier 1 & Tier 2)
      const loc = await locateElement(browser, {
        intent: goal.target_intent,
        role: goal.role_hint,
      });

      if (loc.found) {
        // Ghi nhận variant quan sát được
        observedVariants.push({
          id: randomUUID(),
          value_formula: loc.value && typeof loc.value === 'string'
            ? loc.value
            : `document.querySelector(${JSON.stringify(loc.description)})`,
          confidence: loc.tier === 1 ? 0.95 : 0.85,
          last_verified: Date.now(),
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
          fail_count_recent: 0,
          locale: null,
          created_at: Date.now(),
        });

        // Mục 3.1 bước 5: Cần quan sát tối thiểu MIN_OBSERVATIONS_FOR_STABLE = 2 lần
        if (observedVariants.length >= MAP_CONSTANTS.MIN_OBSERVATIONS_FOR_STABLE) {
          const node: ResourceNode = {
            id: `node-${goal.target_intent.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}`,
            type: goal.action_type === 'call_api' ? 'endpoint' : 'dom_element',
            intent: goal.target_intent,
            variants: observedVariants.slice(0, MAP_CONSTANTS.MAX_VARIANTS_PER_NODE),
            discovered_via: 'normal',
            requires_elevation: false,
            created_at: Date.now(),
            updated_at: Date.now(),
          };

          return {
            success: true,
            node,
            requires_user_demo: false,
            attempts_made: attempts,
            tool_calls_used: this.toolCallsUsed,
            tokens_used: this.tokensUsed,
          };
        }
      }
    }

    // Sau 3 lần thử vẫn không đạt đủ quan sát ổn định -> Fallback sang Demo Recorder
    return {
      success: false,
      requires_user_demo: true,
      reason: `Đã thử ${attempts}/${MAP_CONSTANTS.MAX_DISCOVERY_ATTEMPTS} lần không tìm thấy phần tử ổn định cho "${goal.target_intent}". Cần người dùng demo mẫu.`,
      attempts_made: attempts,
      tool_calls_used: this.toolCallsUsed,
      tokens_used: this.tokensUsed,
    };
  }

  private checkIfSensitive(intent: string): boolean {
    const lower = intent.toLowerCase();
    const sensitiveKeywords = [
      'oauth',
      'đăng nhập',
      'login',
      'password',
      'mật khẩu',
      'thanh toán',
      'checkout',
      'credit card',
      'mua hàng',
      'xác nhận giao dịch',
      'xóa tài khoản',
      'delete account',
    ];
    return sensitiveKeywords.some(kw => lower.includes(kw));
  }

  private recordBudgetUsage(calls: number, tokens: number): void {
    this.toolCallsUsed += calls;
    this.tokensUsed += tokens;
  }
}
