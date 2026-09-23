/**
 * Factory Action Compiler — Biên dịch path/intents thành chuỗi Action (Mục 5.2 bước 2)
 *
 * Nguyên tắc cốt lõi:
 * 1. Giữ nguyên TOÀN BỘ variants của mọi ResourceNode liên quan.
 * 2. Mọi Action PHẢI có on_failure tường minh (stop | skip | ask_user).
 * 3. Tạo map_snapshot tinh gọn chỉ chứa các nodes phục vụ tác vụ này.
 */

import { randomUUID } from 'node:crypto';
import type { MapFile, ResourceNode, Action, OnFailure, ActionType } from '../map/schema.js';
import type { PlanStep } from './planner.js';

export interface ActionCompileSpec {
  intent: string;
  type?: ActionType;
  params?: Record<string, unknown>;
  on_failure?: OnFailure;
  timeout_ms?: number;
}

export interface CompileResult {
  actions: Action[];
  map_snapshot: ResourceNode[];
  missing_intents: string[];
}

export class ActionCompiler {
  /**
   * Biên dịch một danh sách các bước (specs) thành chuỗi Action và map_snapshot.
   */
  static compileFromSpecs(
    map: MapFile,
    specs: ActionCompileSpec[],
    defaultOnFailure: OnFailure = 'stop'
  ): CompileResult {
    const actions: Action[] = [];
    const snapshotNodesMap = new Map<string, ResourceNode>();
    const missingIntents: string[] = [];

    // Lập chỉ mục node theo id và theo intent (lowercase)
    const nodeById = new Map<string, ResourceNode>();
    const nodeByIntent = new Map<string, ResourceNode>();

    for (const node of map.base_nodes) {
      nodeById.set(node.id, node);
      nodeByIntent.set(node.intent.toLowerCase().trim(), node);
    }

    for (const spec of specs) {
      const intentKey = spec.intent.toLowerCase().trim();
      let matchedNode = nodeById.get(spec.intent) ?? nodeByIntent.get(intentKey);

      // Nếu không tìm thấy chính xác, thử tìm partial match
      if (!matchedNode) {
        for (const [key, node] of nodeByIntent.entries()) {
          if (key.includes(intentKey) || intentKey.includes(key)) {
            matchedNode = node;
            break;
          }
        }
      }

      // Xác định action type
      let actionType: ActionType = spec.type ?? 'click';
      if (!spec.type && matchedNode) {
        if (matchedNode.type === 'dom_element') {
          actionType = 'click';
        } else if (matchedNode.type === 'endpoint') {
          actionType = 'call_api';
        }
      }

      if (matchedNode) {
        // Lưu node vào snapshot (bảo toàn TOÀN BỘ variants)
        snapshotNodesMap.set(matchedNode.id, matchedNode);
      } else if (actionType !== 'navigate') {
        // Navigate có thể không cần node_ref, nhưng click/fill cần có
        missingIntents.push(spec.intent);
      }

      const action: Action = {
        id: randomUUID(),
        type: actionType,
        node_ref: matchedNode ? matchedNode.id : null,
        params: spec.params ?? {},
        on_failure: spec.on_failure ?? defaultOnFailure,
        preferred_variant_ids: matchedNode ? matchedNode.variants.map(v => v.id) : [],
        description: spec.intent,
      };

      actions.push(action);
    }

    return {
      actions,
      map_snapshot: Array.from(snapshotNodesMap.values()),
      missing_intents: missingIntents,
    };
  }

  /**
   * Biên dịch từ kế hoạch đường đi trên State Graph (PlanStep[])
   */
  static compileFromPlan(
    map: MapFile,
    planSteps: PlanStep[],
    defaultOnFailure: OnFailure = 'stop'
  ): CompileResult {
    const specs: ActionCompileSpec[] = planSteps.map(step => ({
      intent: step.action_ref,
      on_failure: defaultOnFailure,
    }));

    return this.compileFromSpecs(map, specs, defaultOnFailure);
  }
}
