/**
 * Code Templates for Generated Chrome Extension (MV3)
 *
 * Bao gồm:
 * 1. circuit-breaker.js — Cấp Tool (Mục 7.1), tách riêng, dùng chrome.storage.local
 * 2. background.js — Service worker ghi log và lưu trạng thái
 * 3. content-main.js — MAIN-world script tại document_start (Mục 5.3, 6.2)
 * 4. generateContentScript() — ISOLATED-world runner nhúng map snapshot và actions
 */

import type { Action, MapFile, ToolConfig } from '../map/schema.js';
import { MAP_CONSTANTS } from '../map/schema.js';

/**
 * Template file circuit-breaker.js (Mục 7.1)
 * Độc lập, chạy trong Extension context, dùng chrome.storage.local hoặc in-memory fallback.
 */
export function getCircuitBreakerTemplate(domain: string): string {
  return `/**
 * Circuit Breaker cấp Tool (Mục 7.1 & 15.3)
 * Tự đếm số lần fail liên tiếp theo từng node/domain trong sliding window 10 phút.
 * Tự ngắt khi đạt ${MAP_CONSTANTS.CIRCUIT_BREAKER_MAX_FAILS} lần fail.
 */

class ToolCircuitBreaker {
  constructor(domain, maxFails = ${MAP_CONSTANTS.CIRCUIT_BREAKER_MAX_FAILS}, windowMs = ${MAP_CONSTANTS.CIRCUIT_BREAKER_WINDOW_MS}) {
    this.domain = domain;
    this.maxFails = maxFails;
    this.windowMs = windowMs;
    this.storageKey = 'dbt_cb_' + domain.replace(/[^a-zA-Z0-9_]/g, '_');
    this.memoryRecords = [];
    this.tripped = false;
  }

  async loadState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const result = await chrome.storage.local.get([this.storageKey]);
        const data = result[this.storageKey];
        if (data && Array.isArray(data.records)) {
          const now = Date.now();
          this.memoryRecords = data.records.filter(r => now - r.timestamp < this.windowMs);
          this.tripped = this.memoryRecords.length >= this.maxFails;
        }
      } catch {
        // Fallback in-memory
      }
    }
  }

  async saveState() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({
          [this.storageKey]: {
            records: this.memoryRecords,
            tripped: this.tripped,
            updatedAt: Date.now(),
          },
        });
      } catch {
        // Silent in-memory fallback
      }
    }
  }

  async recordFail(nodeId) {
    await this.loadState();
    const now = Date.now();
    this.memoryRecords.push({ timestamp: now, nodeId });
    this.memoryRecords = this.memoryRecords.filter(r => now - r.timestamp < this.windowMs);

    if (this.memoryRecords.length >= this.maxFails) {
      this.tripped = true;
    }

    await this.saveState();
    return this.tripped;
  }

  async isTripped() {
    await this.loadState();
    const now = Date.now();
    this.memoryRecords = this.memoryRecords.filter(r => now - r.timestamp < this.windowMs);
    this.tripped = this.memoryRecords.length >= this.maxFails;
    return this.tripped;
  }

  async reset() {
    this.memoryRecords = [];
    this.tripped = false;
    await this.saveState();
  }
}

// Export global cho content script
if (typeof window !== 'undefined') {
  window.ToolCircuitBreaker = ToolCircuitBreaker;
}
`;
}

/**
 * Template file background.js (Service Worker MV3)
 */
export function getBackgroundTemplate(): string {
  return `/**
 * Background Service Worker (Manifest V3)
 * Ghi nhận log thực thi và trạng thái circuit breaker
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[DevBrowserTool] Extension installed and ready.');
});

// Nhận log và thông điệp từ content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DBT_LOG') {
    const { level, text, data } = message;
    const prefix = '[DevBrowserTool][' + (level || 'INFO').toUpperCase() + ']';
    if (level === 'error') {
      console.error(prefix, text, data);
    } else if (level === 'warn') {
      console.warn(prefix, text, data);
    } else {
      console.log(prefix, text, data);
    }
    sendResponse({ received: true });
  }

  if (message.type === 'DBT_CIRCUIT_BREAKER_ALERT') {
    console.error('[DevBrowserTool] CIRCUIT BREAKER TRIPPED on tab:', sender.tab?.id, message.domain);
    sendResponse({ acknowledged: true });
  }

  return true;
});
`;
}

/**
 * Template file content-main.js (chạy ở MAIN world lúc document_start — Mục 5.3, 6.2)
 * Chỉ sinh ra khi có action patch_runtime.
 */
export function getMainWorldTemplate(): string {
  return `/**
 * MAIN World Script (document_start)
 * Dùng cho action patch_runtime (Mục 6.2)
 * CHỈ dùng cho mục đích quan sát/thu thập, TUYỆT ĐỐI KHÔNG can thiệp phòng thủ site.
 * Đăng ký namespace chung để chuỗi hoá override an toàn.
 */

(() => {
  window.__DBT_PATCH_REGISTRY__ = window.__DBT_PATCH_REGISTRY__ || new Set();

  console.log('[DevBrowserTool] MAIN world hook initialized at document_start.');
})();
`;
}

/**
 * Sinh nội dung file content.js (ISOLATED world)
 * Nhúng trực tiếp:
 * - Map snapshot (các node và variants liên quan)
 * - Danh sách Action
 * - Runtime Execution Engine: locateElement, click, fill, extract, call_api, circuit breaker
 */
export function generateContentScript(
  toolConfig: ToolConfig,
  actions: Action[],
  mapSnapshot: Partial<MapFile>,
): string {
  const configJson = JSON.stringify(toolConfig);
  const actionsJson = JSON.stringify(actions);
  const mapJson = JSON.stringify(mapSnapshot);
  const domainJson = JSON.stringify(toolConfig.target_domain);

  return `/**
 * Generated Content Script by DevBrowserTool Factory
 * Target Domain: ${toolConfig.target_domain}
 * Tool Name: ${toolConfig.name}
 * Built At: ${new Date(toolConfig.built_at).toISOString()}
 */

(() => {
  const TOOL_CONFIG = ${configJson};
  const ACTIONS = ${actionsJson};
  const MAP_SNAPSHOT = ${mapJson};
  const TARGET_DOMAIN = ${domainJson};

  // Khởi tạo Circuit Breaker cấp Tool
  const cb = new window.ToolCircuitBreaker(TARGET_DOMAIN);

  // --------------------------------------------------------------------------
  // LOGGING HELPER
  // --------------------------------------------------------------------------
  function log(level, message, data = {}) {
    const entry = {
      timestamp: Date.now(),
      level,
      source: 'tool',
      message,
      context: data,
    };

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'DBT_LOG', level, text: message, data: entry }).catch(() => {});
    }

    if (level === 'error') console.error('[DevBrowserTool]', message, data);
    else if (level === 'warn') console.warn('[DevBrowserTool]', message, data);
    else console.log('[DevBrowserTool]', message, data);

    return entry;
  }

  // --------------------------------------------------------------------------
  // PROMPT INJECTION FILTER (Mục 6.2)
  // --------------------------------------------------------------------------
  function sanitizeForLLM(rawContent, maxLength = 10000) {
    if (!rawContent) return '';
    let cleaned = String(rawContent);
    const patterns = [
      /ignore\\s+(all\\s+)?previous\\s+instructions/gi,
      /you\\s+are\\s+now\\s+a/gi,
      /system\\s*:\\s*/gi,
      /\\[INST\\]/gi,
      /\\[\\/INST\\]/gi,
      /<\\|im_start\\|>/gi,
      /<\\|im_end\\|>/gi,
      /\`\`\`system/gi,
    ];
    for (const p of patterns) {
      cleaned = cleaned.replace(p, '[FILTERED]');
    }
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength) + '\\n[...TRUNCATED]';
    }
    return '[BEGIN_EXTRACTED_CONTENT]\\n' + cleaned + '\\n[END_EXTRACTED_CONTENT]';
  }

  // --------------------------------------------------------------------------
  // ELEMENT LOCATOR — 5-tier (Mục 6.1: Tier 1 Accessibility -> Tier 2 JS)
  // --------------------------------------------------------------------------
  function resolveSelector(formula) {
    if (!formula) return null;
    let s = formula.trim();

    // 1. Unwrap document.querySelector(...) hoặc document.getElementById(...)
    if (s.startsWith('document.querySelector(') && s.endsWith(')')) {
      s = s.slice('document.querySelector('.length, -1).trim();
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('\`') && s.endsWith('\`'))) {
        s = s.slice(1, -1);
      }
      s = s.replace(/\\\\"/g, '"').replace(/\\\\'/g, "'");
    } else if (s.startsWith('document.getElementById(') && s.endsWith(')')) {
      let id = s.slice('document.getElementById('.length, -1).trim();
      if ((id.startsWith('"') && id.endsWith('"')) || (id.startsWith("'") && id.endsWith("'"))) {
        id = id.slice(1, -1);
      }
      return document.getElementById(id);
    }

    // 2. Xử lý Playwright pseudo-class :has-text("...")
    if (s.includes(':has-text(')) {
      const idx = s.indexOf(':has-text(');
      const baseSel = s.slice(0, idx).trim() || '*';
      let textPart = s.slice(idx + ':has-text('.length);
      if (textPart.endsWith(')')) textPart = textPart.slice(0, -1);
      textPart = textPart.trim();
      if ((textPart.startsWith('"') && textPart.endsWith('"')) || (textPart.startsWith("'") && textPart.endsWith("'"))) {
        textPart = textPart.slice(1, -1);
      }
      textPart = textPart.replace(/\\\\"/g, '"').replace(/\\\\'/g, "'").toLowerCase();

      try {
        const elements = Array.from(document.querySelectorAll(baseSel));
        const found = elements.find(el => (el.textContent || '').toLowerCase().includes(textPart));
        if (found) return found;
      } catch {}
    }

    // 3. Document querySelector thông thường (an toàn, không eval)
    try {
      const el = document.querySelector(s);
      if (el) return el;
    } catch {}

    return null;
  }

  function locateElement(node, variant) {
    const rawIntent = (node?.intent || '').toLowerCase();
    const intent = rawIntent.replace(/^(ô nhập|nút|chọn|link|input|button|field)\\s+/i, '').trim();
    const formula = variant?.value_formula || '';

    // Parse role/name nếu formula có dạng role:roleName[name="..."]
    let role = null;
    let name = null;
    if (formula.startsWith('role:')) {
      const match = formula.match(/^role:([a-zA-Z0-9_-]+)(?:\\[name=["'](.*?)["']\\])?/);
      if (match) {
        role = match[1];
        name = match[2] || null;
      }
    }

    // Tier 1: Accessibility Tree matching (role, aria-label, semantic text)
    if (name) {
      const byAria = document.querySelector('[aria-label=' + JSON.stringify(name) + ']');
      if (byAria) return { found: true, tier: 1, element: byAria };
    }

    if (role || name) {
      const roleSel = role ? ('[role=' + JSON.stringify(role) + ']' + (role === 'button' ? ', button' : role === 'link' ? ', a[href]' : '')) : 'button, a[href], [role]';
      const candidates = Array.from(document.querySelectorAll(roleSel));
      if (name) {
        const byText = candidates.find(el => (el.textContent || '').trim().toLowerCase() === name.toLowerCase());
        if (byText) return { found: true, tier: 1, element: byText };
      }
    }

    // Tier 2: JS/CSS query selector (CSP-safe, không dùng eval)
    if (formula && !formula.startsWith('role:')) {
      const el = resolveSelector(formula);
      if (el) return { found: true, tier: 2, element: el };
    }

    // Tier 3: Semantic & Label matching theo intent
    if (intent) {
      // Tìm qua label liên kết với input
      const allLabels = Array.from(document.querySelectorAll('label'));
      for (const lbl of allLabels) {
        const lblText = (lbl.textContent || '').toLowerCase();
        if (lblText.includes(intent)) {
          const targetInput = lbl.querySelector('input, textarea, select') || 
            (lbl.htmlFor ? document.getElementById(lbl.htmlFor) : null);
          if (targetInput) return { found: true, tier: 1, element: targetInput };
        }
      }

      const byIntent = Array.from(document.querySelectorAll('button, a[href], input, textarea, select, [role], [aria-label]')).find(el => {
        const text = (el.textContent || '').toLowerCase();
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const nameAttr = (el.getAttribute('name') || '').toLowerCase();
        return (text && text.includes(intent)) || 
               (label && label.includes(intent)) || 
               (placeholder && placeholder.includes(intent)) ||
               (nameAttr && nameAttr.includes(intent));
      });
      if (byIntent) return { found: true, tier: 1, element: byIntent };
    }

    return { found: false, tier: 5, element: null };
  }

  // --------------------------------------------------------------------------
  // ACTION PRIMITIVES (Mục 6)
  // --------------------------------------------------------------------------
  function resolveParamValue(rawVal) {
    if (typeof rawVal !== 'string') return rawVal;
    return rawVal.replace(/\\{\\{([a-zA-Z0-9_-]+)\\}\\}/g, (m, key) => {
      const ip = TOOL_CONFIG.input_params?.find(p => p.name === key);
      if (ip && ip.default_value !== undefined) return ip.default_value;
      return m;
    });
  }

  async function executeClick(node, variant) {
    const loc = locateElement(node, variant);
    if (!loc.found || !loc.element) {
      return { success: false, error: 'Element not found for click' };
    }
    loc.element.click();
    return { success: true, used_fallback: loc.tier > 1 };
  }

  async function executeFill(node, variant, value) {
    const loc = locateElement(node, variant);
    if (!loc.found || !loc.element) {
      return { success: false, error: 'Element not found for fill' };
    }
    const el = loc.element;
    const finalValue = resolveParamValue(value);

    // Phương pháp 1: Gán trực tiếp
    el.value = finalValue;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Đọc lại kiểm tra
    if (el.value === finalValue) {
      return { success: true, used_fallback: loc.tier > 1, method: 'direct' };
    }

    // Phương pháp 2: Prototype setter (React/controlled inputs, Mục 6.2)
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                   Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(el, finalValue);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: el.value === finalValue, used_fallback: loc.tier > 1, method: 'prototype_setter' };
    }

    return { success: false, error: 'Failed to set value via direct or prototype setter' };
  }

  async function executeExtract(node, variant, params = {}) {
    const loc = locateElement(node, variant);
    if (!loc.found || !loc.element) {
      return { success: false, error: 'Element not found for extract' };
    }
    const el = loc.element;
    const raw = el.innerText || el.textContent || el.value || '';
    const shouldSanitize = params.sanitize_for_llm !== false;
    return {
      success: true,
      used_fallback: loc.tier > 1,
      data: {
        raw,
        sanitized: shouldSanitize ? sanitizeForLLM(raw) : raw,
      },
    };
  }

  async function executeCallApi(node, variant, params = {}) {
    if (!variant?.value_formula) {
      return { success: false, error: 'No formula for call_api' };
    }
    try {
      const res = await fetch(variant.value_formula, {
        method: params.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(params.headers || {}) },
        body: params.body ? JSON.stringify(params.body) : undefined,
      });
      const data = await res.json().catch(() => res.text());
      return { success: res.ok, status: res.status, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // --------------------------------------------------------------------------
  // 5-STEP EXECUTION ENGINE LOOP (Mục 7)
  // --------------------------------------------------------------------------
  async function runTool() {
    log('info', 'Starting Tool execution: ' + TOOL_CONFIG.tool_id);

    // Kiểm tra Circuit Breaker trước khi chạy
    if (await cb.isTripped()) {
      log('error', 'Circuit breaker is OPEN. Execution paused to protect domain: ' + TARGET_DOMAIN);
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'DBT_CIRCUIT_BREAKER_ALERT', domain: TARGET_DOMAIN }).catch(() => {});
      }
      return { success: false, error: 'Circuit breaker is OPEN' };
    }

    const baseNodes = MAP_SNAPSHOT.base_nodes || [];

    for (const action of ACTIONS) {
      log('info', 'Executing action: ' + action.id + ' (' + action.type + ')');

      // 1. Resolve node
      const node = action.node_ref ? baseNodes.find(n => n.id === action.node_ref) : null;
      const variants = node?.variants || [];

      // Sắp xếp variant theo confidence
      const sortedVariants = [...variants].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

      let stepSuccess = false;
      let stepResult = null;

      // 2. Verify + 3. Act
      if (sortedVariants.length > 0) {
        const topVariant = sortedVariants[0];
        stepResult = await dispatchAction(action, node, topVariant);
        stepSuccess = stepResult.success;
      } else if (action.type === 'navigate') {
        stepResult = { success: true };
        stepSuccess = true;
        if (action.params?.url) window.location.href = action.params.url;
      }

      // 4. Confirm & 5. Fallback
      if (!stepSuccess && sortedVariants.length > 1) {
        log('warn', 'Primary variant failed for action ' + action.id + '. Attempting fallback variants...');
        for (let i = 1; i < sortedVariants.length; i++) {
          const fallbackVariant = sortedVariants[i];
          stepResult = await dispatchAction(action, node, fallbackVariant);
          if (stepResult.success) {
            stepSuccess = true;
            log('warn', 'Fallback variant ' + fallbackVariant.id + ' succeeded for action ' + action.id + '. Map may need re-verification.');
            break;
          }
        }
      }

      if (!stepSuccess) {
        // Ghi nhận fail vào Circuit Breaker
        await cb.recordFail(action.node_ref || 'unknown');
        log('error', 'Action failed: ' + action.id, { action, error: stepResult?.error });

        if (action.on_failure === 'stop') {
          log('error', 'Action on_failure is "stop". Halting execution.');
          return { success: false, failedAction: action.id, error: stepResult?.error };
        } else if (action.on_failure === 'ask_user') {
          log('warn', 'Action on_failure is "ask_user". Waiting for user intervention.');
          alert('[DevBrowserTool] Action ' + action.id + ' failed. Please perform manually and confirm.');
        } else if (action.on_failure === 'skip_and_continue') {
          log('warn', 'Action on_failure is "skip_and_continue". Continuing to next action.');
        }
      }
    }

    log('info', 'Tool execution finished successfully.');
    return { success: true };
  }

  async function dispatchAction(action, node, variant) {
    switch (action.type) {
      case 'click':
        return await executeClick(node, variant);
      case 'fill':
        return await executeFill(node, variant, action.params?.value || '');
      case 'extract':
        return await executeExtract(node, variant, action.params);
      case 'call_api':
        return await executeCallApi(node, variant, action.params);
      default:
        return { success: true };
    }
  }

  // Tự kích hoạt khi trang load xong
  if (document.readyState === 'complete') {
    runTool();
  } else {
    window.addEventListener('load', () => runTool());
  }

  // Expose ra window để popup/DevTools có thể trigger thủ công
  window.__DBT_RUN_TOOL__ = runTool;
})();
`;
}

/**
 * Template README.md cho Extension đóng gói
 */
export function getExtensionReadme(toolConfig: ToolConfig): string {
  return `# 📦 DevBrowserTool — Generated Chrome Extension (MV3)

- **Tool Name:** \`${toolConfig.name}\`
- **Target Domain:** \`${toolConfig.target_domain}\`
- **Built At:** ${new Date(toolConfig.built_at).toLocaleString()}
- **Package Type:** Manifest V3 Unpacked Extension

## 🚀 Cách cài đặt vào Chrome

1. Mở Google Chrome và truy cập: \`chrome://extensions/\`
2. Bật công tắc **"Developer mode"** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Nhấp vào nút **"Load unpacked"** (Tải tiện ích đã giải nén).
4. Chọn thư mục chứa file \`manifest.json\` này.
5. Truy cập \`https://${toolConfig.target_domain}\` — Extension sẽ tự động hoạt động!

## 🛡️ Tính năng An toàn được tích hợp
- **Circuit Breaker cấp Tool (Mục 7.1)**: Tự động ngắt khi phát hiện ≥ 5 lỗi liên tiếp trong 10 phút.
- **Tập quyền tối thiểu (Mục 5.6)**: Chỉ xin quyền trên đúng domain mục tiêu, không xin dư quyền.
- **Anti-detection Nhóm 1**: Không dùng cơ chế vượt rào hay phá hoại site.
- **Chống Prompt-injection (Mục 6.2)**: Mọi dữ liệu trích xuất đều được lọc tự động qua \`sanitizeForLLM()\`.
`;
}
