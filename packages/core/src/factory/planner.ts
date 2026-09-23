/**
 * Factory Planner — Lập kế hoạch đường đi trên State Graph (Mục 5.2 bước 1)
 *
 * Thuật toán BFS tìm đường đi ngắn nhất từ State bắt đầu tới State mục tiêu.
 * Kiểm tra các điều kiện tiên quyết (preconditions) trên từng trạng thái.
 */

import type { MapFile, StateNode } from '../map/schema.js';

export interface PlanStep {
  from_state_id: string;
  action_ref: string;
  target_state_id: string;
}

export interface PlanResult {
  success: boolean;
  path: PlanStep[];
  visited_states: string[];
  unmet_preconditions: string[];
  error?: string;
}

export interface PlannerOptions {
  /** Các điều kiện đã thoả mãn sẵn (ví dụ: 'is_logged_in', 'cookie_ready') */
  satisfied_conditions?: string[];
  /** Bỏ qua kiểm tra preconditions nếu đặt true */
  ignore_preconditions?: boolean;
}

export class StateGraphPlanner {
  /**
   * Tìm đường đi từ start_state_id đến goal_state_id trên state_graph của Map.
   */
  static findPath(
    map: MapFile,
    startStateId: string,
    goalStateId: string,
    options: PlannerOptions = {}
  ): PlanResult {
    const statesMap = new Map<string, StateNode>();
    for (const state of map.state_graph) {
      statesMap.set(state.id, state);
    }

    if (!statesMap.has(startStateId)) {
      return {
        success: false,
        path: [],
        visited_states: [],
        unmet_preconditions: [],
        error: `Trạng thái bắt đầu "${startStateId}" không tồn tại trong State Graph.`,
      };
    }

    if (!statesMap.has(goalStateId)) {
      return {
        success: false,
        path: [],
        visited_states: [],
        unmet_preconditions: [],
        error: `Trạng thái mục tiêu "${goalStateId}" không tồn tại trong State Graph.`,
      };
    }

    if (startStateId === goalStateId) {
      return {
        success: true,
        path: [],
        visited_states: [startStateId],
        unmet_preconditions: [],
      };
    }

    const satisfiedConditions = new Set<string>(options.satisfied_conditions ?? []);
    const queue: Array<{ stateId: string; path: PlanStep[] }> = [
      { stateId: startStateId, path: [] },
    ];
    const visited = new Set<string>([startStateId]);
    const unmetPreconditions: string[] = [];

    while (queue.length > 0) {
      const { stateId, path } = queue.shift()!;
      const currentState = statesMap.get(stateId);
      if (!currentState) continue;

      for (const transition of currentState.transitions) {
        const nextStateId = transition.target_state_id;
        const nextState = statesMap.get(nextStateId);

        if (!nextState) continue;

        // Kiểm tra preconditions
        if (!options.ignore_preconditions && nextState.preconditions.length > 0) {
          const missing = nextState.preconditions.filter(p => !satisfiedConditions.has(p));
          if (missing.length > 0) {
            unmetPreconditions.push(...missing);
            // Nếu không thoả preconditions thì không đi qua nhánh này
            continue;
          }
        }

        const newStep: PlanStep = {
          from_state_id: stateId,
          action_ref: transition.action_ref,
          target_state_id: nextStateId,
        };
        const newPath = [...path, newStep];

        if (nextStateId === goalStateId) {
          return {
            success: true,
            path: newPath,
            visited_states: Array.from(visited).concat(nextStateId),
            unmet_preconditions: unmetPreconditions,
          };
        }

        if (!visited.has(nextStateId)) {
          visited.add(nextStateId);
          queue.push({ stateId: nextStateId, path: newPath });
        }
      }
    }

    return {
      success: false,
      path: [],
      visited_states: Array.from(visited),
      unmet_preconditions: unmetPreconditions,
      error: `Không tìm thấy đường đi khả dĩ từ "${startStateId}" tới "${goalStateId}".`,
    };
  }
}
