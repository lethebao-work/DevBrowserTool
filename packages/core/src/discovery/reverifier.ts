/**
 * Map Reverifier — Kiểm định lại và kích hoạt Decay định kỳ (Mục 3.11 & Mục 1.3)
 *
 * Nhiệm vụ:
 * 1. Tính toán điểm ưu tiên sau decay theo thời gian thực (decay factor).
 * 2. Tự động kiểm tra (re-verify) các variants có nguy cơ hết hạn trên trình duyệt.
 * 3. Tự động dọn dẹp các biến thể quá hạn và liên tục thất bại.
 */

import type { BrowserAdapter } from '../actions/primitives.js';
import { locateElement } from '../locator/index.js';
import type { MapFile, ResourceNode, Variant } from '../map/schema.js';
import { MAP_CONSTANTS } from '../map/schema.js';

export interface ReverifyReport {
  nodes_checked: number;
  variants_verified: number;
  variants_decayed: number;
  variants_culled: number;
  updated_map: MapFile;
}

export class MapReverifier {
  /**
   * Tính toán điểm decay hiện tại của variant dựa trên thời gian trôi qua kể từ last_verified
   */
  static computeDecayedScore(variant: Variant, now: number = Date.now()): number {
    const timeSinceVerified = variant.last_verified ? now - variant.last_verified : variant.ttl_ms;
    const decayFactor = Math.max(0, 1 - timeSinceVerified / variant.ttl_ms);
    const failPenalty = Math.max(0, 1 - variant.fail_count_recent * 0.15);
    return Number((variant.confidence * decayFactor * failPenalty).toFixed(3));
  }

  /**
   * Chạy kiểm tra re-verification trên browser cho các variants của Map
   */
  static async reverifyMap(
    browser: BrowserAdapter,
    map: MapFile,
    options?: { forceAll?: boolean; confidenceThreshold?: number }
  ): Promise<ReverifyReport> {
    const now = Date.now();
    const threshold = options?.confidenceThreshold ?? MAP_CONSTANTS.CONFIDENCE_HIGH;
    let variantsVerified = 0;
    let variantsDecayed = 0;
    let variantsCulled = 0;

    const newBaseNodes: ResourceNode[] = [];

    for (const node of map.base_nodes) {
      const newVariants: Variant[] = [];

      for (const variant of node.variants) {
        const decayedScore = this.computeDecayedScore(variant, now);

        const degradedAt = variant.degraded_at;

        // === Mục 3.11: Quy trình 2 bước (hạ ưu tiên → xoá) ===
        // Bước 2: Variant đã degraded đủ lâu (>= TTL/2) mà không được quan sát lại → xoá hẳn
        if (degradedAt && (now - degradedAt >= variant.ttl_ms * MAP_CONSTANTS.DEGRADE_CULL_TTL_RATIO)) {
          variantsCulled++;
          continue;
        }

        // Bước 1: Điểm decay quá thấp và fail liên tục → hạ ưu tiên (degrade), chưa xoá
        if (decayedScore < 0.2 && variant.fail_count_recent >= 3 && !degradedAt) {
          variantsDecayed++;
          newVariants.push({
            ...variant,
            confidence: MAP_CONSTANTS.CONFIDENCE_DEGRADED, // Hạ ưu tiên xuống đáy
            degraded_at: now, // Đánh dấu thời điểm bắt đầu hạ ưu tiên
          });
          continue;
        }

        const needsReverify = options?.forceAll || decayedScore < threshold || (now - (variant.last_verified ?? 0) > variant.ttl_ms / 2);

        if (needsReverify && ['dom_element', 'endpoint'].includes(node.type)) {
          try {
            const loc = await locateElement(browser, {
              intent: node.intent,
              formula: variant.value_formula,
            });

            if (loc.found) {
              // Re-verify thành công -> làm mới last_verified, xoá degraded_at nếu có
              variantsVerified++;
              const restored = {
                ...variant,
                last_verified: now,
                fail_count_recent: 0,
                confidence: MAP_CONSTANTS.CONFIDENCE_RESCUED, // Phục hồi mức trung bình, cần thêm verify để tăng
              };
              delete (restored as any).degraded_at; // Cứu variant khỏi trạng thái hạ ưu tiên
              newVariants.push(restored);
            } else {
              // Không tìm thấy -> tăng fail count và giảm nhẹ confidence
              variantsDecayed++;
              newVariants.push({
                ...variant,
                fail_count_recent: variant.fail_count_recent + 1,
                confidence: Math.max(0.1, Number((variant.confidence * 0.9).toFixed(2))),
              });
            }
          } catch {
            variantsDecayed++;
            newVariants.push({
              ...variant,
              fail_count_recent: variant.fail_count_recent + 1,
            });
          }
        } else {
          newVariants.push(variant);
        }
      }

      newBaseNodes.push({
        ...node,
        variants: newVariants,
        updated_at: now,
      });
    }

    const updatedMap: MapFile = {
      ...map,
      base_nodes: newBaseNodes,
      content_revision: map.content_revision + 1,
      updated_at: now,
    };

    return {
      nodes_checked: map.base_nodes.length,
      variants_verified: variantsVerified,
      variants_decayed: variantsDecayed,
      variants_culled: variantsCulled,
      updated_map: updatedMap,
    };
  }
}
