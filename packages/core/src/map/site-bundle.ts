/**
 * Site Bundle Manager — Quản lý liên kết đa domain (Mục 3.13, 15.7)
 *
 * Nguyên tắc bất biến:
 * 1. Tự động tạo/gán bundle_id khi phát hiện di chuyển qua lại ≥2 domain (OAuth redirect, SSO).
 * 2. TIÊU CHÍ GIỚI HẠN CHẶT CHẼ (Boundary Criteria):
 *    - Bắt buộc có dấu hiệu tham số OAuth/SSO (code, state, redirect_uri, client_id...)
 *    - HOẶC là chuỗi khứ hồi quay lại domain gốc trong ngưỡng <= 5 bước (MAP_CONSTANTS.SITE_BUNDLE_MAX_RETURN_STEPS)
 *    - HOẶC là iframe được nhúng trực tiếp trong DOM của domain chủ.
 *    - LOẠI TRỪ các click link ngoài ngẫu nhiên (quảng cáo, tin tức) để tránh sinh liên kết rác làm nhiễu State Graph.
 * 3. Bundle KHÔNG sở hữu dữ liệu: Dữ liệu vẫn nằm trong MapFile riêng từng domain.
 * 4. Cho phép State-Transition Graph của domain A trỏ sang State của domain B qua tham chiếu liên domain.
 * 5. Iframe từ domain khác PHẢI tách map riêng theo domain sở hữu, host map chỉ giữ con trỏ tham chiếu.
 */

import type { MapStore } from './store.js';
import type { MapFile } from './schema.js';
import { MAP_CONSTANTS } from './schema.js';

export interface CrossDomainTransition {
  source_domain: string;
  source_state_id: string;
  target_domain: string;
  target_state_id: string;
  action_intent: string;
}

export interface IframeReference {
  host_domain: string;
  iframe_domain: string;
  container_selector: string;
  registered_at: number;
}

export type BundleEligibilityReason =
  | 'oauth_sso_parameters'
  | 'round_trip_return'
  | 'embedded_iframe'
  | 'ineligible_external_link';

export interface BundleEligibilityCheck {
  eligible: boolean;
  reason: BundleEligibilityReason;
  description: string;
}

export interface SiteBundleManifest {
  bundle_id: string;
  name: string;
  primary_domain: string;
  linked_domains: string[];
  cross_domain_transitions: CrossDomainTransition[];
  iframe_references: IframeReference[];
  created_at: number;
  updated_at: number;
}

export class SiteBundleManager {
  private bundles = new Map<string, SiteBundleManifest>();

  /**
   * Kiểm tra điều kiện đủ để tạo hoặc liên kết vào Site Bundle (Mục 3.13, 15.7).
   * Loại trừ các click link ngoài ngẫu nhiên để tránh phình to và làm nhiễu đồ thị.
   */
  static checkEligibility(
    sourceDomain: string,
    targetDomain: string,
    context?: {
      targetUrl?: string;
      stepsAway?: number;
      isIframe?: boolean;
    },
  ): BundleEligibilityCheck {
    if (sourceDomain.toLowerCase() === targetDomain.toLowerCase()) {
      return {
        eligible: false,
        reason: 'ineligible_external_link',
        description: 'Cùng một domain, không cần liên kết Site Bundle.',
      };
    }

    // 1. Kiểm tra iframe nhúng trực tiếp
    if (context?.isIframe) {
      return {
        eligible: true,
        reason: 'embedded_iframe',
        description: `Iframe từ domain "${targetDomain}" được nhúng trực tiếp trong trang của "${sourceDomain}".`,
      };
    }

    // 2. Kiểm tra tham số giao thức OAuth / SSO / SAML
    const url = context?.targetUrl || '';
    const oauthRegex = /[?&#](?:code|state|redirect_uri|client_id|response_type|oauth|sso|saml|openid|auth)=/i;
    const pathAuthRegex = /\/(?:oauth|sso|saml|auth|login|signin)\b/i;

    if (oauthRegex.test(url) || pathAuthRegex.test(url)) {
      return {
        eligible: true,
        reason: 'oauth_sso_parameters',
        description: `Phát hiện tham số hoặc endpoint giao thức xác thực OAuth/SSO/SAML (${url.slice(0, 80)}...).`,
      };
    }

    // 3. Kiểm tra chuỗi khứ hồi quay lại domain gốc trong ngưỡng <= 5 bước
    if (context?.stepsAway !== undefined && context.stepsAway <= MAP_CONSTANTS.SITE_BUNDLE_MAX_RETURN_STEPS) {
      return {
        eligible: true,
        reason: 'round_trip_return',
        description: `Chuỗi điều hướng khứ hồi hoàn thành trong ${context.stepsAway} bước (<= ngưỡng ${MAP_CONSTANTS.SITE_BUNDLE_MAX_RETURN_STEPS}).`,
      };
    }

    // 4. Nếu không thoả mãn bất kỳ tiêu chí nào -> Coi là link ngoài thông thường, từ chối tạo bundle
    return {
      eligible: false,
      reason: 'ineligible_external_link',
      description: `Điều hướng ngoài ngẫu nhiên tới "${targetDomain}". Không có dấu hiệu OAuth/SSO hay khứ hồi, từ chối tạo bundle để tránh nhiễu dữ liệu.`,
    };
  }

  /**
   * Tạo bundle mới hoặc liên kết thêm domain vào bundle hiện có (Mục 3.13).
   * Có kiểm tra điều kiện hợp lệ để tránh gom nhầm link rác.
   */
  createOrLinkBundle(
    primaryDomain: string,
    secondaryDomain: string,
    bundleName?: string,
    eligibility?: BundleEligibilityCheck,
  ): SiteBundleManifest {
    // Nếu có truyền eligibility và không đạt -> Từ chối
    if (eligibility && !eligibility.eligible) {
      throw new Error(`Từ chối tạo Site Bundle: ${eligibility.description}`);
    }

    // Kiểm tra xem primaryDomain đã thuộc bundle nào chưa
    let existing = Array.from(this.bundles.values()).find(
      (b) => b.primary_domain === primaryDomain || b.linked_domains.includes(primaryDomain),
    );

    const now = Date.now();

    if (!existing) {
      const bundleId = `bundle_${primaryDomain.replace(/[^a-zA-Z0-9]/g, '_')}_${now}`;
      existing = {
        bundle_id: bundleId,
        name: bundleName || `Bundle ${primaryDomain} & ${secondaryDomain}`,
        primary_domain: primaryDomain,
        linked_domains: [primaryDomain],
        cross_domain_transitions: [],
        iframe_references: [],
        created_at: now,
        updated_at: now,
      };
      this.bundles.set(bundleId, existing);
    }

    if (!existing.linked_domains.includes(secondaryDomain)) {
      existing.linked_domains.push(secondaryDomain);
      existing.updated_at = now;
    }

    return existing;
  }

  /**
   * Đăng ký một bước chuyển trạng thái vượt biên giới domain (ví dụ OAuth redirect).
   */
  registerCrossDomainTransition(
    bundleId: string,
    transition: CrossDomainTransition,
  ): boolean {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return false;

    if (!bundle.linked_domains.includes(transition.source_domain)) {
      bundle.linked_domains.push(transition.source_domain);
    }
    if (!bundle.linked_domains.includes(transition.target_domain)) {
      bundle.linked_domains.push(transition.target_domain);
    }

    const exists = bundle.cross_domain_transitions.some(
      (t) =>
        t.source_domain === transition.source_domain &&
        t.source_state_id === transition.source_state_id &&
        t.target_domain === transition.target_domain &&
        t.target_state_id === transition.target_state_id,
    );

    if (!exists) {
      bundle.cross_domain_transitions.push(transition);
      bundle.updated_at = Date.now();
    }

    return true;
  }

  /**
   * Đăng ký tham chiếu iframe xuyên domain (Mục 3.13).
   * Map của domain chứa iframe chỉ giữ con trỏ tham chiếu, KHÔNG nhân bản dữ liệu.
   */
  registerIframeReference(
    bundleId: string,
    ref: Omit<IframeReference, 'registered_at'>,
  ): boolean {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return false;

    if (!bundle.linked_domains.includes(ref.host_domain)) {
      bundle.linked_domains.push(ref.host_domain);
    }
    if (!bundle.linked_domains.includes(ref.iframe_domain)) {
      bundle.linked_domains.push(ref.iframe_domain);
    }

    bundle.iframe_references.push({
      ...ref,
      registered_at: Date.now(),
    });
    bundle.updated_at = Date.now();

    return true;
  }

  getBundle(bundleId: string): SiteBundleManifest | null {
    return this.bundles.get(bundleId) || null;
  }

  findBundleForDomain(domain: string): SiteBundleManifest | null {
    for (const b of this.bundles.values()) {
      if (b.primary_domain === domain || b.linked_domains.includes(domain)) {
        return b;
      }
    }
    return null;
  }

  async syncBundleToMapStore(bundleId: string, store: MapStore): Promise<number> {
    const bundle = this.bundles.get(bundleId);
    if (!bundle) return 0;

    let updatedCount = 0;
    for (const domain of bundle.linked_domains) {
      let map = store.loadMap(domain);
      if (!map) {
        map = store.createMap(domain);
      }
      if (map.bundle_id !== bundle.bundle_id) {
        map.bundle_id = bundle.bundle_id;
        store.saveMap(map);
        updatedCount++;
      }
    }

    return updatedCount;
  }
}
