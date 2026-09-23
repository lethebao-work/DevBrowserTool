/**
 * Importance Evaluator & Adaptive Heuristic Engine (Mục 3.7)
 *
 * Nhiệm vụ:
 * 1. Tự động đánh giá điểm quan trọng (importance_score) của website dựa trên các tín hiệu Heuristic:
 *    - Có form thanh toán / cổng giao dịch tiền mặt.
 *    - Có luồng xác thực, OAuth, thông tin cá nhân (PII).
 *    - Có các hành động đột biến dữ liệu nhạy cảm (mutating/destructive).
 *    - Tần suất truy cập / thực thi thường xuyên.
 * 2. Ghi nhận nhật ký người dùng điều chỉnh điểm số thủ công (kèm lý do).
 * 3. Thuật toán tự học thích ứng (Adaptive Learning Step):
 *    - Khi phát hiện người dùng ghi đè điểm số ≥ 3 lần liên tiếp với khoảng lệch ≥ 0.25:
 *    - Tự động điều chỉnh vector trọng số heuristic riêng cho domain đó,
 *      chuyển nguồn importance_source thành 'hybrid'.
 */

import { MAP_CONSTANTS } from './schema.js';
import type { MapFile, ImportanceSource } from './schema.js';

export interface HeuristicFeatures {
  hasPaymentForms: boolean;
  hasAuthOrPii: boolean;
  hasMutatingActions: boolean;
  accessFrequencyHigh: boolean;
}

export interface FeatureWeights {
  hasPaymentForms: number;
  hasAuthOrPii: number;
  hasMutatingActions: number;
  accessFrequencyHigh: number;
}

export interface UserAdjustmentRecord {
  timestamp: number;
  user_score: number;
  auto_score: number;
  reason: string;
  features: HeuristicFeatures;
}

export interface AdaptationResult {
  adapted: boolean;
  previous_weights: FeatureWeights;
  new_weights: FeatureWeights;
  calculated_score: number;
  discrepancy_count: number;
}

export class ImportanceEvaluator {
  /** Trọng số mặc định cơ sở */
  public static readonly DEFAULT_WEIGHTS: FeatureWeights = {
    hasPaymentForms: 0.35,
    hasAuthOrPii: 0.30,
    hasMutatingActions: 0.20,
    accessFrequencyHigh: 0.15,
  };

  /** Bước học hiệu chỉnh trọng số thích ứng */
  public static readonly LEARNING_RATE = 0.05;

  private domainWeights: Map<string, FeatureWeights> = new Map();
  private adjustmentHistory: Map<string, UserAdjustmentRecord[]> = new Map();

  /**
   * Tính điểm quan trọng tự động dựa trên vector đặc trưng và trọng số của domain.
   */
  calculateScore(features: HeuristicFeatures, domain: string = ''): number {
    const weights = this.domainWeights.get(domain) || ImportanceEvaluator.DEFAULT_WEIGHTS;

    let score = 0.1; // Điểm sàn tối thiểu cho mọi website

    if (features.hasPaymentForms) score += weights.hasPaymentForms * 0.9;
    if (features.hasAuthOrPii) score += weights.hasAuthOrPii * 0.9;
    if (features.hasMutatingActions) score += weights.hasMutatingActions * 0.9;
    if (features.accessFrequencyHigh) score += weights.accessFrequencyHigh * 0.9;

    return Math.min(1.0, Math.max(0.1, Math.round(score * 100) / 100));
  }

  /**
   * Lấy trọng số hiện tại của 1 domain.
   */
  getWeightsForDomain(domain: string): FeatureWeights {
    return { ...(this.domainWeights.get(domain) || ImportanceEvaluator.DEFAULT_WEIGHTS) };
  }

  /**
   * Ghi nhận điều chỉnh thủ công của người dùng (Mục 3.7).
   * Khi phát hiện bất đồng liên tiếp (≥ 3 lần lệch ≥ 0.25) → tự động hiệu chỉnh trọng số riêng cho domain.
   */
  recordUserAdjustment(
    domain: string,
    userScore: number,
    features: HeuristicFeatures,
    reason: string = ''
  ): AdaptationResult {
    const clampedUserScore = Math.min(1.0, Math.max(0.0, userScore));
    const currentAutoScore = this.calculateScore(features, domain);

    if (!this.adjustmentHistory.has(domain)) {
      this.adjustmentHistory.set(domain, []);
    }

    const history = this.adjustmentHistory.get(domain)!;
    history.push({
      timestamp: Date.now(),
      user_score: clampedUserScore,
      auto_score: currentAutoScore,
      reason,
      features,
    });

    const previousWeights = this.getWeightsForDomain(domain);

    // Kiểm tra chuỗi bất đồng liên tiếp gần nhất
    const threshold = MAP_CONSTANTS.IMPORTANCE_ADAPTIVE_DEVIATION_THRESHOLD; // 0.25
    const requiredCount = MAP_CONSTANTS.IMPORTANCE_ADAPTIVE_MIN_DISCREPANCIES; // 3

    let consecutiveDiscrepancies = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (Math.abs(entry.user_score - entry.auto_score) >= threshold) {
        consecutiveDiscrepancies++;
      } else {
        break;
      }
    }

    // Nếu chưa đủ số lần bất đồng → giữ nguyên trọng số
    if (consecutiveDiscrepancies < requiredCount) {
      return {
        adapted: false,
        previous_weights: previousWeights,
        new_weights: previousWeights,
        calculated_score: currentAutoScore,
        discrepancy_count: consecutiveDiscrepancies,
      };
    }

    // THUẬT TOÁN THÍCH ỨNG TRỌNG SỐ (Adaptive Learning Step)
    const errorDelta = clampedUserScore - currentAutoScore;
    const lr = ImportanceEvaluator.LEARNING_RATE;

    const newWeights: FeatureWeights = { ...previousWeights };

    // Tăng/giảm trọng số các tính năng đang kích hoạt (active) theo hướng của người dùng
    const activeKeys: (keyof FeatureWeights)[] = [];
    const inactiveKeys: (keyof FeatureWeights)[] = [];

    (Object.keys(features) as (keyof HeuristicFeatures)[]).forEach(k => {
      if (features[k]) {
        activeKeys.push(k);
      } else {
        inactiveKeys.push(k);
      }
    });

    for (const key of activeKeys) {
      newWeights[key] = Math.max(0.05, newWeights[key] + lr * errorDelta);
    }
    for (const key of inactiveKeys) {
      newWeights[key] = Math.max(0.05, newWeights[key] - lr * errorDelta * 0.5);
    }

    // Chuẩn hoá tổng trọng số = 1.0
    const sum =
      newWeights.hasPaymentForms +
      newWeights.hasAuthOrPii +
      newWeights.hasMutatingActions +
      newWeights.accessFrequencyHigh;

    newWeights.hasPaymentForms = Math.round((newWeights.hasPaymentForms / sum) * 1000) / 1000;
    newWeights.hasAuthOrPii = Math.round((newWeights.hasAuthOrPii / sum) * 1000) / 1000;
    newWeights.hasMutatingActions = Math.round((newWeights.hasMutatingActions / sum) * 1000) / 1000;
    newWeights.accessFrequencyHigh =
      Math.round(
        (1.0 - newWeights.hasPaymentForms - newWeights.hasAuthOrPii - newWeights.hasMutatingActions) * 1000
      ) / 1000;

    this.domainWeights.set(domain, newWeights);
    const newCalculatedScore = this.calculateScore(features, domain);

    return {
      adapted: true,
      previous_weights: previousWeights,
      new_weights: newWeights,
      calculated_score: newCalculatedScore,
      discrepancy_count: consecutiveDiscrepancies,
    };
  }

  /**
   * Cập nhật điểm và nguồn của MapFile theo kết quả đánh giá (Mục 3.7).
   */
  applyToMap(map: MapFile, newScore: number, source: ImportanceSource): MapFile {
    return {
      ...map,
      importance_score: Math.min(1.0, Math.max(0.0, newScore)),
      importance_source: source,
      updated_at: Date.now(),
    };
  }
}
