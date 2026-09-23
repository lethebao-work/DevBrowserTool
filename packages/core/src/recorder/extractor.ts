/**
 * Event Extractor (Mục 3.2, 3.3, 6.1)
 *
 * Chuyển đổi các sự kiện người dùng đã demo (RecordedEvent[]) thành
 * ResourceNode và các Variant tương ứng với:
 * - Intent ngữ nghĩa suy ra từ Accessibility role/name/aria-label
 * - Variant Tier 1 (Accessibility Tree: role + name)
 * - Variant Tier 2 (CSS Query selector)
 */

import { randomUUID } from 'node:crypto';
import { MAP_CONSTANTS, type ResourceNode, type Variant } from '../map/schema.js';
import type { DomElementSnapshot, ExtractedDemoResult, RecordedEvent } from './types.js';

/**
 * Tạo ID ngữ nghĩa chuẩn hoá từ intent.
 * Ví dụ: "Nút Đăng nhập" → "btn_dang_nhap"
 */
export function slugifyIntent(prefix: string, name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Bỏ dấu tiếng Việt
    .replace(/[^a-z0-9]+/g, '_')     // Ký tự không phải chữ số thành _
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);                   // Giới hạn độ dài

  return `${prefix}_${clean || 'element'}`;
}

/**
 * Suy ra vai trò và mô tả ngữ nghĩa (intent) từ snapshot của element.
 */
export function deriveIntent(target: DomElementSnapshot, eventType: string): {
  id: string;
  intent: string;
  role: string;
  name: string;
} {
  const tag = target.tagName.toLowerCase();
  const rawRole = target.role;
  const rawName = target.ariaLabel || target.textContent?.trim() || target.placeholder || target.name || '';

  let role = rawRole || 'element';
  let prefix = 'el';
  let roleLabel = 'Phần tử';

  if (tag === 'button' || rawRole === 'button' || (tag === 'input' && ['button', 'submit'].includes(target.inputType || ''))) {
    role = 'button';
    prefix = 'btn';
    roleLabel = 'Nút';
  } else if (tag === 'a' || rawRole === 'link') {
    role = 'link';
    prefix = 'link';
    roleLabel = 'Liên kết';
  } else if (tag === 'input' || tag === 'textarea' || tag === 'select' || rawRole === 'textbox') {
    role = 'textbox';
    prefix = 'input';
    roleLabel = 'Ô nhập';
  }

  const cleanName = rawName.slice(0, 50).replace(/\s+/g, ' ');
  const intent = cleanName ? `${roleLabel} ${cleanName}` : `${roleLabel} (${target.selector})`;
  const id = slugifyIntent(prefix, cleanName || target.id || 'target');

  return { id, intent, role, name: cleanName };
}

/**
 * Trích xuất danh sách ResourceNode và Variants từ các RecordedEvent.
 */
export function extractResourceNodesFromEvents(
  events: RecordedEvent[],
  now: number = Date.now(),
): ExtractedDemoResult {
  const nodesMap = new Map<string, ResourceNode>();
  let clicks = 0;
  let fills = 0;
  let navigates = 0;

  for (const event of events) {
    if (event.type === 'click') clicks++;
    if (event.type === 'fill') fills++;
    if (event.type === 'navigate') navigates++;

    if (!event.target) continue;

    const { id, intent, role, name } = deriveIntent(event.target, event.type);

    // Nếu node đã tồn tại, kiểm tra xem có variant mới không
    let existingNode = nodesMap.get(id);

    if (!existingNode) {
      const variants: Variant[] = [];

      // Variant 1: Tier 1 (Accessibility Tree — ưu tiên cao nhất, Mục 6.1)
      if (name) {
        variants.push({
          id: randomUUID(),
          value_formula: `role:${role}[name="${name}"]`,
          confidence: 0.90,
          last_verified: now,
          fail_count_recent: 0,
          locale: null,
          created_at: now,
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
        });
      }

      // Variant 2: Tier 2 (CSS Query selector)
      if (event.target.selector) {
        variants.push({
          id: randomUUID(),
          value_formula: event.target.selector,
          confidence: 0.85,
          last_verified: now,
          fail_count_recent: 0,
          locale: null,
          created_at: now,
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
        });
      }

      const newNode: ResourceNode = {
        id,
        type: 'dom_element',
        intent,
        variants,
        discovered_via: 'normal',
        requires_elevation: false,
        created_at: now,
        updated_at: now,
      };

      nodesMap.set(id, newNode);
    } else {
      // Bổ sung variant nếu có selector khác
      const selector = event.target.selector;
      const hasSelector = existingNode.variants.some(v => v.value_formula === selector);
      if (selector && !hasSelector && existingNode.variants.length < MAP_CONSTANTS.MAX_VARIANTS_PER_NODE) {
        existingNode.variants.push({
          id: randomUUID(),
          value_formula: selector,
          confidence: 0.80,
          last_verified: now,
          fail_count_recent: 0,
          locale: null,
          created_at: now,
          ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS,
        });
        existingNode.updated_at = now;
      }
    }
  }

  const nodes = Array.from(nodesMap.values());
  const variantsByNodeId: Record<string, Variant[]> = {};
  for (const n of nodes) {
    variantsByNodeId[n.id] = n.variants;
  }

  return {
    nodes,
    variantsByNodeId,
    summary: {
      totalEvents: events.length,
      clicks,
      fills,
      navigates,
    },
  };
}
