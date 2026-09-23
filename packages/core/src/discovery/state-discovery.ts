/**
 * State Discovery Engine — Tự động suy luận State-Transition Graph động (Mục 3.3 & Mục 1.1)
 *
 * Nhiệm vụ:
 * 1. MatchKeyGenerator:
 *    - URL pattern regex synthesis (ví dụ /user/123/profile -> ^/user/[^/]+/profile$)
 *    - DOM fingerprinting: Hash cấu trúc ngữ nghĩa bỏ qua dynamic IDs/timestamps
 *    - Virtual route detection: window.location.hash hoặc history.state
 * 2. State-Transition Graph Inference:
 *    - Tự động phát hiện khi chuyển trạng thái (StateNode)
 *    - Ghi nhận transitions giữa các trạng thái
 *    - Tự động suy luận preconditions (ví dụ: requires_auth, cart_not_empty)
 */

import { createHash } from 'node:crypto';
import type { BrowserAdapter } from '../actions/primitives.js';
import type { StateNode, MatchKey, Transition } from '../map/schema.js';

export class StateDiscoveryEngine {
  /**
   * Sinh MatchKey động từ trạng thái hiện tại của trình duyệt.
   */
  static async captureMatchKey(browser: BrowserAdapter): Promise<MatchKey> {
    const rawUrl = browser.getUrl ? await browser.getUrl() : await browser.currentUrl();
    const urlObj = new URL(rawUrl);

    // 1. URL pattern: tổng hợp regex pattern (thay số/UUID bằng placeholder)
    const pathname = urlObj.pathname;
    const synthesizedPattern = this.synthesizeUrlPattern(pathname);

    // 2. DOM fingerprint: hash cấu trúc semantic
    const domStructure = await browser.evaluate<string>(`
      (() => {
        // Thu thập cấu trúc thẻ ngữ nghĩa chính, bỏ qua id/class động
        const elements = document.querySelectorAll('main, nav, header, footer, form, article, table, h1, h2');
        const tags = Array.from(elements).map(el => {
          const role = el.getAttribute('role') || '';
          const tag = el.tagName.toLowerCase();
          return tag + (role ? ':' + role : '');
        });
        return tags.join('>');
      })()
    `);

    const domFingerprint = createHash('sha256')
      .update(domStructure || 'empty-dom')
      .digest('hex')
      .slice(0, 16);

    // 3. Virtual route (bắt hash hoặc SPA state)
    const virtualRoute = await browser.evaluate<string | null>(`
      (() => {
        if (window.location.hash) return window.location.hash;
        if (window.history.state && window.history.state.key) return String(window.history.state.key);
        return null;
      })()
    `);

    return {
      url_pattern: synthesizedPattern,
      dom_fingerprint: domFingerprint,
      virtual_route: virtualRoute,
    };
  }

  /**
   * Thay thế các UUID, số nguyên, dynamic slug bằng regex pattern.
   */
  static synthesizeUrlPattern(pathname: string): string {
    return pathname
      // Thay thế UUID (8-4-4-4-12 hex)
      .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':uuid')
      // Thay thế ID dạng số (/users/123/ -> /users/:id/)
      .replace(/\/(\d+)(\/|$)/g, '/:id$2');
  }

  /**
   * Kiểm tra xem 2 MatchKey có thuộc cùng một State không.
   */
  static isSameState(keyA: MatchKey, keyB: MatchKey): boolean {
    if (keyA.url_pattern === keyB.url_pattern && keyA.virtual_route === keyB.virtual_route) {
      return true;
    }
    // Nếu URL pattern khớp và DOM fingerprint trùng khớp -> cùng state
    if (keyA.url_pattern === keyB.url_pattern && keyA.dom_fingerprint === keyB.dom_fingerprint) {
      return true;
    }
    return false;
  }

  /**
   * Tự động suy luận preconditions dựa trên nội dung trang hiện tại
   */
  static async inferPreconditions(browser: BrowserAdapter): Promise<string[]> {
    const preconditions: string[] = [];

    const isLoginOrAuth = await browser.evaluate<boolean>(`
      (() => {
        const text = (document.body?.innerText || '').toLowerCase();
        const hasAuthBadge = Boolean(document.querySelector('[data-user], .user-avatar, #user-profile, .logged-in'));
        return hasAuthBadge;
      })()
    `);

    if (isLoginOrAuth) {
      preconditions.push('authenticated_session');
    }

    return preconditions;
  }

  /**
   * Tạo StateNode tự động từ quan sát hiện tại
   */
  static async discoverCurrentState(browser: BrowserAdapter, stateIdPrefix: string = 'state'): Promise<StateNode> {
    const matchKey = await this.captureMatchKey(browser);
    const preconditions = await this.inferPreconditions(browser);

    const safeUrlPath = (matchKey.url_pattern || 'root')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);

    const stateId = `${stateIdPrefix}_${safeUrlPath}_${matchKey.dom_fingerprint?.slice(0, 6) ?? 'any'}`;

    return {
      id: stateId,
      match_key: matchKey,
      preconditions,
      transitions: [],
    };
  }
}
