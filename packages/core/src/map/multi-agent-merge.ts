/**
 * Multi-Agent Merge Engine — Hợp nhất kết quả từ nhiều agent/session (Mục 3.10)
 *
 * Nguyên tắc bất biến:
 * 1. Tự động merge các node/variant không mâu thuẫn.
 * 2. Khi mâu thuẫn selector/formula giữa 2 agent -> PHẢI gộp thành nhiều Variant trong cùng node.
 *    TUYỆT ĐỐI KHÔNG tự ý chọn 1 bên thắng và xoá bên kia ngay lúc merge.
 * 3. Loại bỏ biến thể thừa/yếu CHỈ diễn ra qua cơ chế TTL/fail-rate tự nhiên (Mục 3.11).
 * 4. Phân định đúng account-slot, TUYỆT ĐỐI KHÔNG merge mù làm lẫn delta của 1 account vào base_nodes.
 */

import {
  MAP_CONSTANTS,
  type MapFile,
  type ResourceNode,
  type Variant,
  type StateNode,
  type Transition,
} from './schema.js';

export interface MergeStats {
  nodesAdded: number;
  variantsAdded: number;
  conflictsResolvedAsVariants: number;
  slotsMerged: number;
  transitionsAdded: number;
}

export interface MergeResult {
  success: boolean;
  mergedMap: MapFile;
  stats: MergeStats;
  notes: string[];
}

export class MultiAgentMergeEngine {
  /**
   * Hợp nhất kết quả khám phá từ sourceMap vào targetMap theo đúng Mục 3.10.
   */
  static merge(targetMap: MapFile, sourceMap: MapFile): MergeResult {
    // 1. Kiểm tra tính tương thích domain
    if (targetMap.domain !== sourceMap.domain) {
      throw new Error(
        `Không thể merge 2 MapFile khác domain: "${targetMap.domain}" và "${sourceMap.domain}". Sử dụng SiteBundle nếu là multi-domain (Mục 3.13).`,
      );
    }

    const stats: MergeStats = {
      nodesAdded: 0,
      variantsAdded: 0,
      conflictsResolvedAsVariants: 0,
      slotsMerged: 0,
      transitionsAdded: 0,
    };
    const notes: string[] = [];

    // Sao chép sâu base_nodes của target
    const mergedBaseNodes: ResourceNode[] = JSON.parse(JSON.stringify(targetMap.base_nodes));

    // 2. Merge Base Nodes
    for (const srcNode of sourceMap.base_nodes) {
      const existingNodeIndex = mergedBaseNodes.findIndex(
        (n) => n.id === srcNode.id || n.intent.trim().toLowerCase() === srcNode.intent.trim().toLowerCase(),
      );

      if (existingNodeIndex === -1) {
        // Node mới chưa có -> thêm nguyên vẹn
        mergedBaseNodes.push(JSON.parse(JSON.stringify(srcNode)));
        stats.nodesAdded++;
        stats.variantsAdded += srcNode.variants.length;
        notes.push(`Thêm node mới: ${srcNode.intent} (${srcNode.id})`);
      } else {
        // Node đã tồn tại -> Kiểm tra và gộp biến thể (multi-variant)
        const targetNode = mergedBaseNodes[existingNodeIndex];
        const { variantsAdded, conflicts } = this.mergeVariants(targetNode.variants, srcNode.variants);
        stats.variantsAdded += variantsAdded;
        stats.conflictsResolvedAsVariants += conflicts;
        if (conflicts > 0) {
          notes.push(`Mâu thuẫn công thức tại node "${targetNode.intent}": Đã gộp thành đa biến thể theo Mục 3.10`);
        }
      }
    }

    // 3. Merge Account Slots (Mục 3.10: phân định đúng slot, không lẫn vào base)
    const mergedAccountSlots = JSON.parse(JSON.stringify(targetMap.account_slots || {}));
    if (sourceMap.account_slots) {
      for (const [slotHash, srcSlot] of Object.entries(sourceMap.account_slots)) {
        if (!mergedAccountSlots[slotHash]) {
          // Slot mới hoàn toàn
          mergedAccountSlots[slotHash] = JSON.parse(JSON.stringify(srcSlot));
          stats.slotsMerged++;
          notes.push(`Thêm account slot mới: ${slotHash}`);
        } else {
          // Slot đã tồn tại ở cả 2 bên -> merge delta_nodes
          const targetDeltaNodes: ResourceNode[] = mergedAccountSlots[slotHash].delta_nodes;
          for (const srcDeltaNode of srcSlot.delta_nodes) {
            const existingDeltaIndex = targetDeltaNodes.findIndex(
              (n) => n.id === srcDeltaNode.id || n.intent.trim().toLowerCase() === srcDeltaNode.intent.trim().toLowerCase(),
            );
            if (existingDeltaIndex === -1) {
              targetDeltaNodes.push(JSON.parse(JSON.stringify(srcDeltaNode)));
              stats.nodesAdded++;
            } else {
              const { variantsAdded, conflicts } = this.mergeVariants(
                targetDeltaNodes[existingDeltaIndex].variants,
                srcDeltaNode.variants,
              );
              stats.variantsAdded += variantsAdded;
              stats.conflictsResolvedAsVariants += conflicts;
            }
          }
          stats.slotsMerged++;
        }
      }
    }

    // 4. Merge State-Transition Graph
    const mergedStateGraph: StateNode[] = JSON.parse(JSON.stringify(targetMap.state_graph || []));
    if (sourceMap.state_graph) {
      for (const srcState of sourceMap.state_graph) {
        const existingState = mergedStateGraph.find((s) => s.id === srcState.id);
        if (!existingState) {
          mergedStateGraph.push(JSON.parse(JSON.stringify(srcState)));
        } else {
          // Merge preconditions
          const currentPre = new Set(existingState.preconditions);
          for (const pre of srcState.preconditions) {
            currentPre.add(pre);
          }
          existingState.preconditions = Array.from(currentPre);

          // Merge transitions
          for (const srcTrans of srcState.transitions) {
            const hasTrans = existingState.transitions.some(
              (t) => t.action_ref === srcTrans.action_ref && t.target_state_id === srcTrans.target_state_id,
            );
            if (!hasTrans) {
              existingState.transitions.push({ ...srcTrans });
              stats.transitionsAdded++;
            }
          }
        }
      }
    }

    const mergedMap: MapFile = {
      ...targetMap,
      content_revision: Math.max(targetMap.content_revision, sourceMap.content_revision) + 1,
      base_nodes: mergedBaseNodes,
      account_slots: mergedAccountSlots,
      state_graph: mergedStateGraph,
      updated_at: Date.now(),
    };

    return {
      success: true,
      mergedMap,
      stats,
      notes,
    };
  }

  /**
   * Hợp nhất danh sách Variant của 2 node cùng intent (Mục 3.10 & 3.11).
   * Không chọn winner, giữ tất cả công thức khác biệt làm variants.
   */
  private static mergeVariants(
    targetVariants: Variant[],
    sourceVariants: Variant[],
  ): { variantsAdded: number; conflicts: number } {
    let variantsAdded = 0;
    let conflicts = 0;

    for (const srcVar of sourceVariants) {
      const matchIndex = targetVariants.findIndex(
        (tv) => tv.value_formula.trim() === srcVar.value_formula.trim(),
      );

      if (matchIndex !== -1) {
        // Cùng formula -> cập nhật last_verified và lấy confidence tốt hơn
        const tv = targetVariants[matchIndex];
        tv.last_verified = Math.max(tv.last_verified || 0, srcVar.last_verified || 0) || Date.now();
        tv.confidence = Math.max(tv.confidence, srcVar.confidence);
        tv.fail_count_recent = Math.min(tv.fail_count_recent, srcVar.fail_count_recent);
      } else {
        // Formula khác nhau -> MÂU THUẪN GIỮA AGENT -> Gộp thành Variant mới (Mục 3.10)
        targetVariants.push({ ...srcVar });
        variantsAdded++;
        conflicts++;
      }
    }

    // Giữ giới hạn MAX_VARIANTS_PER_NODE = 5 (Mục 15.5 & 3.11)
    if (targetVariants.length > MAP_CONSTANTS.MAX_VARIANTS_PER_NODE) {
      // Sắp xếp ưu tiên: confidence cao hơn, thời gian verified mới hơn
      targetVariants.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return (b.last_verified || 0) - (a.last_verified || 0);
      });
      targetVariants.splice(MAP_CONSTANTS.MAX_VARIANTS_PER_NODE);
    }

    return { variantsAdded, conflicts };
  }
}
