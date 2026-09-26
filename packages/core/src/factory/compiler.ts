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
      if (!node) continue;
      if (node.id) nodeById.set(node.id, node);
      if (node.intent) {
        nodeByIntent.set(node.intent.toLowerCase().trim(), node);
      }
    }

    for (const spec of specs) {
      if (!spec) continue;
      const rawIntent = (spec.intent ?? (spec as any).id ?? (spec as any).selector ?? '').toString();
      const intentKey = rawIntent.toLowerCase().trim();
      let matchedNode = (spec.intent ? nodeById.get(spec.intent) : undefined) ?? nodeByIntent.get(intentKey);

      // Nếu không tìm thấy chính xác, thử tìm partial match
      if (!matchedNode && intentKey) {
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

  /**
   * Phân loại và đề xuất các node hành động có sẵn trong Map cho Agent lựa chọn.
   */
  static proposeActions(map: MapFile) {
    const inputNodes: Array<{
      id: string;
      intent: string;
      selector: string;
      role: string;
      type: string;
      variantsCount: number;
    }> = [];

    const buttonNodes: Array<{
      id: string;
      intent: string;
      selector: string;
      role: string;
      type: string;
      variantsCount: number;
    }> = [];

    const endpointNodes: Array<{
      id: string;
      intent: string;
      url: string;
      method: string;
    }> = [];

    const persistenceNodes: Array<{
      id: string;
      intent: string;
      key: string;
    }> = [];

    for (const node of map.base_nodes) {
      if (!node) continue;
      const primarySelector = node.variants?.[0]?.value_formula || '';
      if (node.type === 'dom_element') {
        const intentLower = (node.intent || '').toLowerCase();
        const idLower = (node.id || '').toLowerCase();
        if (
          intentLower.includes('nút') ||
          intentLower.includes('button') ||
          idLower.includes('btn') ||
          idLower.includes('button') ||
          primarySelector.includes('button')
        ) {
          buttonNodes.push({
            id: node.id,
            intent: node.intent,
            selector: primarySelector,
            role: 'button',
            type: 'dom_element',
            variantsCount: node.variants.length,
          });
        } else {
          inputNodes.push({
            id: node.id,
            intent: node.intent,
            selector: primarySelector,
            role: 'input',
            type: 'dom_element',
            variantsCount: node.variants.length,
          });
        }
      } else if (node.type === 'endpoint') {
        endpointNodes.push({
          id: node.id,
          intent: node.intent,
          url: primarySelector,
          method: node.intent.startsWith('API POST') ? 'POST' : 'GET',
        });
      } else if (node.type === 'local_persistence') {
        persistenceNodes.push({
          id: node.id,
          intent: node.intent,
          key: primarySelector,
        });
      }
    }

    return {
      domain: map.domain,
      input_nodes: inputNodes,
      button_nodes: buttonNodes,
      endpoints: endpointNodes,
      persistence_keys: persistenceNodes,
      states_available: map.state_graph?.map(s => s.id) || [],
    };
  }

  /**
   * Tạo chuỗi JS scripts để Agent tự thực thi dry-run trên browser của mình.
   */
  static generateExecutionScripts(map: MapFile, specs: ActionCompileSpec[]) {
    const compiled = this.compileFromSpecs(map, specs);
    const steps: Array<{
      step: number;
      action_id: string;
      type: ActionType;
      description: string;
      script: string;
    }> = [];

    for (let i = 0; i < compiled.actions.length; i++) {
      const act = compiled.actions[i];
      const node = compiled.map_snapshot.find(n => n.id === act.node_ref);
      const selector = node?.variants?.[0]?.value_formula || (act.params?.selector as string) || '';
      let script = '';

      if (act.type === 'fill') {
        const val = String(act.params?.value ?? '');
        script = `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { success: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
  if ('value' in el) {
    el.value = ${JSON.stringify(val)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, filled: ${JSON.stringify(val)} };
  }
  return { success: false, error: 'Element is not an inputable field' };
})()`;
      } else if (act.type === 'click') {
        script = `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { success: false, error: 'Element not found: ' + ${JSON.stringify(selector)} };
  if (typeof el.click === 'function') {
    el.click();
    return { success: true };
  }
  return { success: false, error: 'Element is not clickable' };
})()`;
      } else if (act.type === 'call_api') {
        const url = node?.variants?.[0]?.value_formula || '';
        const method = (act.params?.method as string) || 'GET';
        script = `(() => {
  return fetch(${JSON.stringify(url)}, { method: ${JSON.stringify(method)} })
    .then(r => r.json().catch(() => ({ status: r.status })))
    .then(data => ({ success: true, data }))
    .catch(err => ({ success: false, error: err.message }));
})()`;
      } else {
        script = `(() => ({ success: true, noop: true }))()`;
      }

      steps.push({
        step: i + 1,
        action_id: act.id,
        type: act.type,
        description: act.description || '',
        script,
      });
    }

    return {
      domain: map.domain,
      total_steps: steps.length,
      steps,
    };
  }
}

