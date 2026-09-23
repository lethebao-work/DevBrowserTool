/**
 * Map Graph Visualizer — Chuyển đổi và Render Đồ thị Resource & State (Mục 10 lớp 2)
 *
 * Nhiệm vụ:
 * 1. Chuyển đổi MapFile sang định dạng Cytoscape.js elements (nodes & edges).
 * 2. Phân biệt trực quan:
 *    - Resource Graph (endpoints, DOM elements, schemas, local persistence, hardware_bound).
 *    - State-Transition Graph (states, match keys, dynamic transitions).
 *    - Base nodes vs Account Delta nodes (Mục 3.9).
 * 3. Hiển thị thông số chất lượng: confidence, TTL, degraded status, số lượng variant.
 * 4. Sinh mã SVG / Mermaid đồ thị để xem độc lập không cần Webview.
 */

import type { MapFile, ResourceNode, StateNode } from './schema.js';
import { MAP_CONSTANTS } from './schema.js';

export interface CytoscapeNodeData {
  id: string;
  label: string;
  type: string;
  category: 'resource' | 'state' | 'delta_resource';
  confidence?: number;
  variant_count?: number;
  has_degraded?: boolean;
  ttl_ms?: number;
  last_verified?: number | null;
  account_slot?: string;
  color?: string;
}

export interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
  type: 'transition' | 'precondition' | 'belongs_to';
}

export interface CytoscapeGraphData {
  nodes: Array<{ data: CytoscapeNodeData }>;
  edges: Array<{ data: CytoscapeEdgeData }>;
}

export class MapVisualizer {
  /**
   * Chuyển đổi MapFile sang Cytoscape Graph Data Model
   */
  static toCytoscapeData(map: MapFile): CytoscapeGraphData {
    const nodes: Array<{ data: CytoscapeNodeData }> = [];
    const edges: Array<{ data: CytoscapeEdgeData }> = [];

    // 1. Thêm Base Resource Nodes
    for (const node of map.base_nodes) {
      const topConfidence = node.variants.length > 0
        ? Math.max(...node.variants.map(v => v.confidence))
        : 0;

      const hasDegraded = node.variants.some((v: any) => v.degraded_at);

      nodes.push({
        data: {
          id: `res_${node.id}`,
          label: `${node.intent} (${node.type})`,
          type: node.type,
          category: 'resource',
          confidence: topConfidence,
          variant_count: node.variants.length,
          has_degraded: hasDegraded,
          ttl_ms: node.variants[0]?.ttl_ms,
          last_verified: node.variants[0]?.last_verified,
          color: this.getNodeColor(node.type, topConfidence),
        },
      });
    }

    // 2. Thêm Delta Nodes từ các Account Slots (Mục 3.9)
    for (const [slotHash, slot] of Object.entries(map.account_slots)) {
      for (const node of slot.delta_nodes) {
        const topConfidence = node.variants.length > 0
          ? Math.max(...node.variants.map(v => v.confidence))
          : 0;

        const nodeId = `delta_${slotHash.substring(0, 6)}_${node.id}`;
        nodes.push({
          data: {
            id: nodeId,
            label: `[Delta] ${node.intent}`,
            type: node.type,
            category: 'delta_resource',
            confidence: topConfidence,
            variant_count: node.variants.length,
            account_slot: slotHash,
            color: '#a855f7', // Màu tím cho Delta
          },
        });
      }
    }

    // 3. Thêm State Nodes & Preconditions
    for (const state of map.state_graph) {
      nodes.push({
        data: {
          id: `state_${state.id}`,
          label: `State: ${state.id}\n(${state.match_key.url_pattern || 'any URL'})`,
          type: 'state_node',
          category: 'state',
          color: '#3b82f6', // Xanh dương cho State
        },
      });

      // Precondition edges: node -> state
      for (const preNodeId of (state.preconditions ?? [])) {
        edges.push({
          data: {
            id: `pre_${preNodeId}_${state.id}`,
            source: `res_${preNodeId}`,
            target: `state_${state.id}`,
            label: 'precondition',
            type: 'precondition',
          },
        });
      }

      // Transition edges: state -> target_state
      const transitions = state.transitions ?? [];
      for (let i = 0; i < transitions.length; i++) {
        const trans = transitions[i];
        edges.push({
          data: {
            id: `trans_${state.id}_${trans.target_state_id}_${i}`,
            source: `state_${state.id}`,
            target: `state_${trans.target_state_id}`,
            label: trans.action_ref,
            type: 'transition',
          },
        });
      }
    }

    return { nodes, edges };
  }

  /**
   * Sinh mã biểu đồ Mermaid (Markdown diagram) để xem trực quan ngay trong Markdown
   */
  static toMermaid(map: MapFile): string {
    const lines: string[] = ['flowchart TD'];

    // Subgraph Base Resources
    lines.push('  subgraph BaseResources["📦 Base Resource Graph"]');
    for (const node of map.base_nodes) {
      const sanitizedId = `res_${node.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      const conf = node.variants.length > 0 ? (node.variants[0].confidence * 100).toFixed(0) : '0';
      lines.push(`    ${sanitizedId}["${node.intent}<br/>[${node.type} | ${conf}% conf]"]`);
    }
    lines.push('  end');

    // Subgraph State Graph
    if (map.state_graph.length > 0) {
      lines.push('  subgraph StateGraph["🌐 State-Transition Graph"]');
      for (const state of map.state_graph) {
        const sanitizedStateId = `state_${state.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        lines.push(`    ${sanitizedStateId}(("${state.id}"))`);
      }

      for (const state of map.state_graph) {
        const fromId = `state_${state.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        for (const trans of state.transitions) {
          const toId = `state_${trans.target_state_id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
          lines.push(`    ${fromId} -->|"${trans.action_ref}"| ${toId}`);
        }
      }
      lines.push('  end');
    }

    return lines.join('\n');
  }

  private static getNodeColor(type: string, confidence: number): string {
    if (type === 'hardware_bound') return '#ef4444'; // Đỏ (không thể tự động hoá)
    if (confidence <= MAP_CONSTANTS.CONFIDENCE_DEGRADED) return '#f59e0b'; // Vàng cam (decay)
    if (confidence >= MAP_CONSTANTS.CONFIDENCE_HIGH) return '#10b981'; // Xanh lục (rất tốt)
    return '#6b7280'; // Xám trung tính
  }
}
