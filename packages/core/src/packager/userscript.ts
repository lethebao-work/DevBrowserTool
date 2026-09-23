/**
 * Userscript Packager — Đóng gói dạng .user.js kèm @updateURL (Mục 5.3)
 *
 * Cho phép:
 * 1. Sinh file `.user.js` tự chứa đầy đủ metadata UserScript (Tampermonkey, Violentmonkey)
 * 2. Cấu hình `@updateURL` và `@downloadURL` phục vụ tự động cập nhật bản mới từ Nhà máy
 * 3. Nhúng snapshot Map và chuỗi actions + Runtime Engine độc lập
 */

import type { Action, MapFile, ResourceNode } from '../map/schema.js';

export interface UserscriptConfig {
  name: string;
  namespace?: string;
  version?: string;
  description?: string;
  matchPatterns: string[];
  updateUrl?: string;
  downloadUrl?: string;
  runAt?: 'document-start' | 'document-end' | 'document-idle';
  actions: Action[];
  map: MapFile;
}

export class UserscriptPackager {
  /**
   * Sinh nội dung mã nguồn của Userscript hoàn chỉnh (.user.js).
   */
  static build(config: UserscriptConfig): string {
    const version = config.version || '1.0.0';
    const namespace = config.namespace || 'https://devbrowsertool.local';
    const runAt = config.runAt || 'document-idle';
    const description = config.description || `DevBrowserTool automated script for ${config.name}`;

    // Lọc map snapshot chỉ giữ lại các node được tham chiếu trong actions
    const referencedNodeIds = new Set(
      config.actions.filter(a => a.node_ref).map(a => a.node_ref as string),
    );
    const relevantBaseNodes = config.map.base_nodes.filter(n => referencedNodeIds.has(n.id));

    const mapSnapshot: Partial<MapFile> = {
      schema_version: config.map.schema_version,
      content_revision: config.map.content_revision,
      domain: config.map.domain,
      base_nodes: relevantBaseNodes,
    };

    // Tạo khối metadata header của UserScript
    const headerLines = [
      '// ==UserScript==',
      `// @name         ${config.name}`,
      `// @namespace    ${namespace}`,
      `// @version      ${version}`,
      `// @description  ${description}`,
      ...config.matchPatterns.map(p => `// @match        ${p}`),
    ];

    if (config.updateUrl) {
      headerLines.push(`// @updateURL    ${config.updateUrl}`);
    }
    if (config.downloadUrl) {
      headerLines.push(`// @downloadURL  ${config.downloadUrl}`);
    }

    headerLines.push(
      `// @run-at       ${runAt}`,
      '// @grant        none',
      '// ==/UserScript==',
    );

    // Phần body tự chứa của Userscript
    const scriptBody = `
(function() {
  'use strict';

  const TOOL_CONFIG = {
    name: ${JSON.stringify(config.name)},
    version: ${JSON.stringify(version)},
    mapSnapshot: ${JSON.stringify(mapSnapshot, null, 2)},
    actions: ${JSON.stringify(config.actions, null, 2)},
  };

  console.log('[DevBrowserTool] Userscript initialized:', TOOL_CONFIG.name, 'v' + TOOL_CONFIG.version);

  // Circuit Breaker cấp LocalStorage
  const CB_KEY = 'dbt_cb_' + TOOL_CONFIG.name;
  function getFailCount() {
    try {
      const data = JSON.parse(localStorage.getItem(CB_KEY) || '{"fails":0,"time":0}');
      if (Date.now() - data.time > 600000) return 0; // Reset sau 10 phút
      return data.fails;
    } catch {
      return 0;
    }
  }

  function recordFail() {
    const fails = getFailCount() + 1;
    localStorage.setItem(CB_KEY, JSON.stringify({ fails, time: Date.now() }));
    return fails;
  }

  function resetFail() {
    localStorage.removeItem(CB_KEY);
  }

  // Runtime Step Execution
  async function executeAction(action) {
    console.log('[DevBrowserTool] Executing action:', action.id, action.type);
    
    if (action.type === 'navigate') {
      window.location.href = action.params.url;
      return true;
    }

    if (action.type === 'click') {
      const node = TOOL_CONFIG.mapSnapshot.base_nodes.find(n => n.id === action.node_ref);
      const variants = node ? node.variants : [];
      
      // Thử lần lượt các variants
      for (const variant of variants) {
        let el = null;
        try {
          if (variant.value_formula) {
            el = document.querySelector(variant.value_formula);
          }
        } catch {}

        if (el) {
          el.click();
          return true;
        }
      }

      // Fuzzy fallback
      if (node && node.intent) {
        const buttons = Array.from(document.querySelectorAll('button, a, input[type=submit]'));
        const matched = buttons.find(b => (b.textContent || '').trim().includes(node.intent));
        if (matched) {
          matched.click();
          return true;
        }
      }

      return false;
    }

    if (action.type === 'fill') {
      const node = TOOL_CONFIG.mapSnapshot.base_nodes.find(n => n.id === action.node_ref);
      const variants = node ? node.variants : [];
      const val = action.params?.value || '';

      for (const variant of variants) {
        let el = null;
        try {
          if (variant.value_formula) el = document.querySelector(variant.value_formula);
        } catch {}

        if (el) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    }

    return true;
  }

  async function runAll() {
    if (getFailCount() >= 5) {
      console.warn('[DevBrowserTool] Circuit breaker tripped for this Userscript. Execution paused.');
      return;
    }

    for (const action of TOOL_CONFIG.actions) {
      const success = await executeAction(action);
      if (!success) {
        recordFail();
        console.error('[DevBrowserTool] Action failed:', action.id);
        if (action.on_failure === 'stop') break;
      }
    }
  }

  // Tự động gắn trigger button tiện dụng hoặc chạy tự động
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAll);
  } else {
    runAll();
  }
})();
`;

    return `${headerLines.join('\n')}\n\n${scriptBody.trim()}\n`;
  }
}
