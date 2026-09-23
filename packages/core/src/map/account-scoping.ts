/**
 * Account Scoping Engine — Phân tách & Quản lý Dữ liệu Đa Tài Khoản (Mục 3.9)
 *
 * Nhiệm vụ:
 * 1. Sinh mã băm định danh nội bộ (account hash) ẩn danh (SHA-256), KHÔNG lưu PII.
 * 2. Tự động phát hiện khi người dùng đổi tài khoản trên trình duyệt.
 * 3. Duy trì Base nodes (dùng chung) và Delta nodes (riêng từng tài khoản).
 * 4. Tự động thăng cấp (promote) Delta node lên Base node khi quan sát giống nhau ở ≥ 2 tài khoản.
 */

import { createHash } from 'node:crypto';
import type { BrowserAdapter } from '../actions/primitives.js';
import type { MapFile, ResourceNode, Variant } from './schema.js';
import { MAP_CONSTANTS } from './schema.js';
import type { MapStore } from './store.js';

export interface AccountChangeResult {
  changed: boolean;
  previous_hash?: string;
  current_hash: string;
  slot_created: boolean;
  updated_map: MapFile;
}

export interface PromotionReport {
  promoted_count: number;
  promoted_nodes: ResourceNode[];
  updated_map: MapFile;
}

export class AccountScopingEngine {
  /** Ngưỡng tài khoản tối thiểu để thăng cấp delta -> base (Mục 3.9) */
  public static readonly PROMOTION_ACCOUNT_THRESHOLD = 2;

  /**
   * Namespace tag cố định dùng để phân tách domain hash cho tài khoản (Domain Separation Tag).
   * BẮT BUỘC là hằng số cố định, xác định trước — TUYỆT ĐỐI KHÔNG random hoá vì việc này
   * sẽ phá vỡ tính xác định (determinism) cần thiết cho Multi-Agent Merge (Mục 3.10, 4.4).
   */
  public static readonly ACCOUNT_HASH_NAMESPACE_TAG = 'dbt_account_scope_v1';

  /**
   * Sinh account hash ẩn danh nội bộ từ raw identifier (email/id/token).
   * TUYỆT ĐỐI KHÔNG lưu raw identifier dưới dạng plaintext (Mục 3.9).
   *
   * Tính chất bắt buộc: DETERMINISTIC (Xác định).
   * Cùng rawIdentifier + domain ở bất kỳ agent hay tiến trình độc lập nào
   * đều PHẢI sinh ra cùng một chuỗi hash để đảm bảo merge đúng slot.
   */
  static generateAccountHash(rawIdentifier: string, domain: string = ''): string {
    const normalized = rawIdentifier.trim().toLowerCase();
    const hash = createHash('sha256')
      .update(`${domain}:${normalized}:${this.ACCOUNT_HASH_NAMESPACE_TAG}`)
      .digest('hex');
    return `acc_${hash.substring(0, 16)}`;
  }

  /**
   * Phát hiện đổi tài khoản trên trình duyệt thật (Mục 3.9).
   * Khi đổi tài khoản: tạo slot mới nếu chưa có, base map vẫn dùng lại ngay không cần verify lại.
   */
  static async detectAccountChange(
    browser: BrowserAdapter,
    mapStore: MapStore,
    map: MapFile,
    currentAccountHash?: string
  ): Promise<AccountChangeResult> {
    // 1. Quét dấu vết tài khoản từ client-side (cookies, localStorage, meta tags)
    const rawIdentity = await browser.evaluate<string | null>(`
      (() => {
        try {
          // A. Meta tag hoặc data attribute
          const userMeta = document.querySelector('meta[name="user-id"], meta[name="account-id"], [data-user-id], [data-account-id]');
          if (userMeta) {
            const val = userMeta.getAttribute('content') || userMeta.getAttribute('data-user-id') || userMeta.getAttribute('data-account-id');
            if (val) return val;
          }

          // B. LocalStorage các key phổ biến
          const candidateKeys = ['userId', 'user_id', 'accountId', 'account_id', 'user', 'profile', 'auth_token', 'token'];
          for (const k of candidateKeys) {
            const v = localStorage.getItem(k);
            if (v) {
              try {
                const parsed = JSON.parse(v);
                if (parsed && (parsed.id || parsed.userId || parsed.email)) {
                  return String(parsed.id || parsed.userId || parsed.email);
                }
              } catch {}
              if (v.length > 3 && v.length < 100) return v;
            }
          }

          // C. Cookies
          const cookies = document.cookie.split(';').map(c => c.trim());
          for (const c of cookies) {
            const [k, v] = c.split('=');
            if (k && candidateKeys.includes(k) && v) {
              return v;
            }
          }

          return null;
        } catch {
          return null;
        }
      })()
    `);

    const detectedIdentity = rawIdentity || 'anonymous_default';
    const detectedHash = this.generateAccountHash(detectedIdentity, map.domain);

    let updatedMap = map;
    let slotCreated = false;

    // Nếu slot chưa tồn tại trong map -> tạo slot mới
    if (!updatedMap.account_slots[detectedHash]) {
      updatedMap = mapStore.addAccountSlot(updatedMap, detectedHash, []);
      slotCreated = true;
    }

    const changed = currentAccountHash !== undefined && currentAccountHash !== detectedHash;

    return {
      changed,
      previous_hash: currentAccountHash,
      current_hash: detectedHash,
      slot_created: slotCreated,
      updated_map: updatedMap,
    };
  }

  /**
   * Thăng cấp (Promote) Delta node lên Base node khi xuất hiện ở ≥ 2 tài khoản khác nhau (Mục 3.9).
   * - Kiểm tra các delta nodes ở tất cả account slots.
   * - Nếu một node/variant được quan sát giống nhau ở ≥ 2 accounts → thăng cấp thành base node dùng chung.
   * - Xoá khỏi delta nodes của các account đó để dọn dẹp trùng lặp.
   */
  static promoteDeltaToBase(map: MapFile): PromotionReport {
    const slots = Object.values(map.account_slots);
    if (slots.length < this.PROMOTION_ACCOUNT_THRESHOLD) {
      return {
        promoted_count: 0,
        promoted_nodes: [],
        updated_map: map,
      };
    }

    // Nhóm các delta node theo intent
    const deltaNodeMap = new Map<string, Array<{ slotHash: string; node: ResourceNode }>>();

    for (const slot of slots) {
      for (const node of slot.delta_nodes) {
        const key = `${node.type}:${node.intent.toLowerCase().trim()}`;
        if (!deltaNodeMap.has(key)) {
          deltaNodeMap.set(key, []);
        }
        deltaNodeMap.get(key)!.push({ slotHash: slot.account_hash, node });
      }
    }

    const now = Date.now();
    const promotedNodes: ResourceNode[] = [];
    const promotedIntents = new Set<string>();
    const newBaseNodes = [...map.base_nodes];
    const newAccountSlots = { ...map.account_slots };

    for (const [key, entries] of deltaNodeMap.entries()) {
      // Điều kiện Mục 3.9: quan sát giống hệt nhau ở ≥ 2 account khác nhau
      const uniqueAccounts = new Set(entries.map(e => e.slotHash));
      if (uniqueAccounts.size >= this.PROMOTION_ACCOUNT_THRESHOLD) {
        const sampleNode = entries[0].node;

        // Tổng hợp và gộp các variants từ các account
        const mergedVariantsMap = new Map<string, Variant>();
        for (const entry of entries) {
          for (const v of entry.node.variants) {
            const formulaKey = v.value_formula.trim();
            if (!mergedVariantsMap.has(formulaKey)) {
              mergedVariantsMap.set(formulaKey, { ...v });
            } else {
              // Cập nhật confidence cao hơn nếu có
              const existing = mergedVariantsMap.get(formulaKey)!;
              if (v.confidence > existing.confidence) {
                existing.confidence = v.confidence;
              }
              existing.last_verified = Math.max(existing.last_verified ?? 0, v.last_verified ?? 0);
            }
          }
        }

        const baseNode: ResourceNode = {
          ...sampleNode,
          variants: Array.from(mergedVariantsMap.values()).slice(0, MAP_CONSTANTS.MAX_VARIANTS_PER_NODE),
          updated_at: now,
        };

        // Kiểm tra xem đã có trong base_nodes chưa
        const existingBaseIndex = newBaseNodes.findIndex(
          bn => bn.id === baseNode.id || bn.intent.toLowerCase().trim() === baseNode.intent.toLowerCase().trim()
        );

        if (existingBaseIndex !== -1) {
          // Gộp variants vào base node hiện tại
          const existingBase = newBaseNodes[existingBaseIndex];
          const combined = [...existingBase.variants];
          for (const nv of baseNode.variants) {
            if (!combined.some(cv => cv.value_formula === nv.value_formula)) {
              combined.push(nv);
            }
          }
          newBaseNodes[existingBaseIndex] = {
            ...existingBase,
            variants: combined.slice(0, MAP_CONSTANTS.MAX_VARIANTS_PER_NODE),
            updated_at: now,
          };
          promotedNodes.push(newBaseNodes[existingBaseIndex]);
        } else {
          newBaseNodes.push(baseNode);
          promotedNodes.push(baseNode);
        }

        promotedIntents.add(sampleNode.intent.toLowerCase().trim());
      }
    }

    // Xoá các node đã được thăng cấp khỏi delta_nodes của các account slot
    if (promotedNodes.length > 0) {
      for (const slotHash of Object.keys(newAccountSlots)) {
        const slot = newAccountSlots[slotHash];
        const remainingDelta = slot.delta_nodes.filter(
          n => !promotedIntents.has(n.intent.toLowerCase().trim())
        );
        newAccountSlots[slotHash] = {
          ...slot,
          delta_nodes: remainingDelta,
        };
      }
    }

    const updatedMap: MapFile = {
      ...map,
      base_nodes: newBaseNodes,
      account_slots: newAccountSlots,
      content_revision: map.content_revision + (promotedNodes.length > 0 ? 1 : 0),
      updated_at: now,
    };

    return {
      promoted_count: promotedNodes.length,
      promoted_nodes: promotedNodes,
      updated_map: updatedMap,
    };
  }
}
