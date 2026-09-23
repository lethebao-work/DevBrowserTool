/**
 * Importance Scorer — Phân loại mức độ quan trọng của site tự động (Mục 3.7 & Mục 1.6)
 *
 * Tính điểm importance (0.0 -> 1.0) theo heuristic dựa trên tín hiệu quan sát:
 * - Có form thanh toán / thẻ tín dụng (+0.30)
 * - Có OAuth / đăng nhập / mật khẩu (+0.25)
 * - Có thu thập thông tin cá nhân PII / email / điện thoại (+0.20)
 * - Độ sâu phiên / nhiều tương tác chuyển trạng thái (+0.15)
 *
 * Hỗ trợ người dùng điều chỉnh thủ công và tự cân chỉnh trọng số khi bị override nhiều lần.
 */

import type { BrowserAdapter } from '../actions/primitives.js';
import type { MapFile } from '../map/schema.js';

export interface HeuristicWeights {
  payment: number;
  auth: number;
  pii: number;
  depth: number;
}

export interface ScoreAssessment {
  score: number;
  signals: {
    has_payment: boolean;
    has_auth: boolean;
    has_pii: boolean;
    action_depth: number;
  };
  rationale: string[];
}

export class ImportanceScorer {
  private weights: HeuristicWeights = {
    payment: 0.35,
    auth: 0.30,
    pii: 0.20,
    depth: 0.15,
  };

  private overrideHistory: Array<{ domain: string; heuristic: number; user: number }> = [];

  /**
   * Đánh giá điểm quan trọng của trang dựa trên DOM và trạng thái phiên
   */
  async assessPage(browser: BrowserAdapter, map?: MapFile): Promise<ScoreAssessment> {
    const rationale: string[] = [];

    // 1. Quét tín hiệu trên DOM
    const signals = await browser.evaluate<{
      has_payment: boolean;
      has_auth: boolean;
      has_pii: boolean;
    }>(`
      (() => {
        const bodyText = (document.body?.innerText || '').toLowerCase();
        const html = (document.documentElement?.innerHTML || '').toLowerCase();

        // Tín hiệu thanh toán
        const paymentKeywords = ['credit card', 'thanh toán', 'card number', 'cvv', 'checkout', 'giỏ hàng', 'stripe', 'paypal'];
        const has_payment = paymentKeywords.some(kw => bodyText.includes(kw)) ||
          Boolean(document.querySelector('input[autocomplete*="cc-"], input[name*="card"], [id*="payment"]'));

        // Tín hiệu xác thực / OAuth
        const authKeywords = ['sign in', 'đăng nhập', 'password', 'oauth', 'login'];
        const has_auth = Boolean(document.querySelector('input[type="password"]')) ||
          authKeywords.some(kw => bodyText.includes(kw));

        // Tín hiệu thông tin cá nhân (PII)
        const piiInputs = Boolean(document.querySelector('input[type="email"], input[type="tel"], input[autocomplete="tel"], input[autocomplete="address-line1"]'));
        const has_pii = piiInputs || bodyText.includes('số điện thoại') || bodyText.includes('địa chỉ giao hàng');

        return { has_payment, has_auth, has_pii };
      })()
    `);

    let totalScore = 0.1; // Base baseline

    if (signals.has_payment) {
      totalScore += this.weights.payment;
      rationale.push(`Phát hiện form / tín hiệu thanh toán (+${(this.weights.payment * 100).toFixed(0)}%)`);
    }

    if (signals.has_auth) {
      totalScore += this.weights.auth;
      rationale.push(`Phát hiện mật khẩu / form đăng nhập (+${(this.weights.auth * 100).toFixed(0)}%)`);
    }

    if (signals.has_pii) {
      totalScore += this.weights.pii;
      rationale.push(`Phát hiện thu thập thông tin cá nhân PII (+${(this.weights.pii * 100).toFixed(0)}%)`);
    }

    const actionDepth = map ? map.base_nodes.length : 0;
    if (actionDepth > 5) {
      totalScore += this.weights.depth;
      rationale.push(`Độ phức tạp site cao (số lượng resource nodes = ${actionDepth}) (+${(this.weights.depth * 100).toFixed(0)}%)`);
    }

    const finalScore = Math.min(1.0, Math.max(0.0, Number(totalScore.toFixed(2))));

    return {
      score: finalScore,
      signals: {
        ...signals,
        action_depth: actionDepth,
      },
      rationale,
    };
  }

  /**
   * Người dùng điều chỉnh điểm thủ công kèm lý do (Mục 3.7)
   */
  recordUserAdjustment(domain: string, heuristicScore: number, userScore: number): void {
    this.overrideHistory.push({ domain, heuristic: heuristicScore, user: userScore });

    // Mục 3.7: "Nếu heuristic và điều chỉnh của người dùng lệch nhau nhiều lần liên tiếp cho cùng 1 domain
    // -> hệ thống PHẢI tự điều chỉnh lại trọng số heuristic cho domain đó"
    const domainHistory = this.overrideHistory.filter(h => h.domain === domain);
    if (domainHistory.length >= 3) {
      const avgDiff = domainHistory.reduce((acc, h) => acc + (h.user - h.heuristic), 0) / domainHistory.length;

      // Điều chỉnh trọng số tương ứng
      if (avgDiff > 0.2) {
        // Người dùng liên tục đánh giá cao hơn -> tăng trọng số auth và pii
        this.weights.auth = Math.min(0.40, this.weights.auth + 0.05);
        this.weights.pii = Math.min(0.30, this.weights.pii + 0.05);
      } else if (avgDiff < -0.2) {
        // Người dùng liên tục đánh giá thấp hơn -> giảm trọng số
        this.weights.auth = Math.max(0.15, this.weights.auth - 0.05);
        this.weights.payment = Math.max(0.20, this.weights.payment - 0.05);
      }
    }
  }

  getWeights(): HeuristicWeights {
    return { ...this.weights };
  }
}
