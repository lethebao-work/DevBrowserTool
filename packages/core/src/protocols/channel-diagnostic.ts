/**
 * Quy trình chẩn đoán chọn kênh thu thập dữ liệu (Mục 3.4)
 *
 * PHẢI thực hiện theo đúng thứ tự 4 bước sau, dừng ở bước đầu tiên phù hợp:
 * 1. Client-side encryption check (Web Crypto API / Ciphertext payload) -> Boundary / DOM post-render. DỪNG.
 * 2. Active WebSocket real-time channel -> Ưu tiên đọc state qua WebSocket. DỪNG.
 * 3. Local persistence (Service Worker, Cache Storage, IndexedDB) -> Thu thập từ storage. DỪNG.
 * 4. WebAssembly boundary hook (JS <-> Wasm function calls). DỪNG.
 * 5. Mặc định: DOM / API thông thường (Tier 1-4).
 */

import type { BrowserAdapter } from '../actions/primitives.js';

export type DiagnosticChannelType =
  | 'encryption_boundary'
  | 'websocket_realtime'
  | 'local_persistence'
  | 'wasm_boundary'
  | 'standard_dom_api';

export interface DiagnosticResult {
  step: number;
  recommended_channel: DiagnosticChannelType;
  reason: string;
  details: {
    has_client_crypto: boolean;
    has_active_websocket: boolean;
    has_local_persistence: boolean;
    has_webassembly: boolean;
    detected_storage_types?: string[];
    websocket_urls?: string[];
  };
}

export class DataChannelDiagnosticEngine {
  /**
   * Chạy quy trình chẩn đoán 4 bước trên trình duyệt hiện tại.
   * Dừng ở bước đầu tiên phát hiện dấu hiệu phù hợp (Mục 3.4).
   */
  static async diagnose(browser: BrowserAdapter): Promise<DiagnosticResult> {
    const rawCheck = await browser.evaluate<{
      hasCryptoSubtle: boolean;
      activeWebSockets: string[];
      persistenceTypes: string[];
      hasWasm: boolean;
    }>(`
      (async () => {
        // 1. Kiểm tra Web Crypto API
        const hasCryptoSubtle = Boolean(
          window.crypto && window.crypto.subtle && typeof window.crypto.subtle.encrypt === 'function'
        );

        // 2. Kiểm tra WebSocket
        const activeWebSockets = [];
        if (window.__devBrowserTool_ws__ && window.__devBrowserTool_ws__.sockets) {
          for (const [ws, info] of window.__devBrowserTool_ws__.sockets.entries()) {
            if (ws.readyState === 1 || ws.readyState === 0) { // OPEN or CONNECTING
              activeWebSockets.push(info.url);
            }
          }
        }

        // 3. Kiểm tra Local Persistence an toàn (chống SecurityError trên about:blank)
        const persistenceTypes = [];
        try {
          if (window.indexedDB) persistenceTypes.push('IndexedDB');
        } catch {}
        try {
          if ('caches' in window) persistenceTypes.push('CacheStorage');
        } catch {}
        try {
          if (navigator.serviceWorker && navigator.serviceWorker.controller) persistenceTypes.push('ServiceWorker');
        } catch {}
        try {
          if (window.localStorage && window.localStorage.length > 0) persistenceTypes.push('localStorage');
        } catch {}

        // 4. Kiểm tra WebAssembly
        const hasWasm = typeof window.WebAssembly === 'object' && typeof window.WebAssembly.instantiate === 'function';

        return {
          hasCryptoSubtle,
          activeWebSockets,
          persistenceTypes,
          hasWasm,
        };
      })()
    `);

    const details = {
      has_client_crypto: rawCheck.hasCryptoSubtle,
      has_active_websocket: rawCheck.activeWebSockets.length > 0,
      has_local_persistence: rawCheck.persistenceTypes.length > 0,
      has_webassembly: rawCheck.hasWasm,
      detected_storage_types: rawCheck.persistenceTypes,
      websocket_urls: rawCheck.activeWebSockets,
    };

    // BƯỚC 1: Dữ liệu có bị mã hoá phía client không?
    if (rawCheck.hasCryptoSubtle) {
      return {
        step: 1,
        recommended_channel: 'encryption_boundary',
        reason: 'Client sử dụng Web Crypto API (crypto.subtle). Dữ liệu mã hoá client-side, cần thu thập tại boundary mã hoá/giải mã hoặc DOM post-render (Mục 3.4 bước 1).',
        details,
      };
    }

    // BƯỚC 2: Kênh WebSocket thời gian thực đang hoạt động?
    if (rawCheck.activeWebSockets.length > 0) {
      return {
        step: 2,
        recommended_channel: 'websocket_realtime',
        reason: `Phát hiện ${rawCheck.activeWebSockets.length} kết nối WebSocket đang hoạt động. Ưu tiên đọc state qua WebSocket channel, DOM chỉ gửi input (Mục 3.4 bước 2).`,
        details,
      };
    }

    // BƯỚC 3: Kiểm tra Local Persistence (Service Worker / Cache Storage / IndexedDB)
    const criticalPersistence = rawCheck.persistenceTypes.filter(t => t === 'IndexedDB' || t === 'ServiceWorker' || t === 'CacheStorage');
    if (criticalPersistence.length > 0) {
      return {
        step: 3,
        recommended_channel: 'local_persistence',
        reason: `Phát hiện kho lưu trữ cục bộ (${criticalPersistence.join(', ')}). Cần kiểm tra local persistence trước khi kết luận không có API (Mục 3.4 bước 3).`,
        details,
      };
    }

    // BƯỚC 4: WebAssembly logic
    if (rawCheck.hasWasm) {
      return {
        step: 4,
        recommended_channel: 'wasm_boundary',
        reason: 'Phát hiện WebAssembly runtime. Chỉ hook tại boundary JS <-> Wasm, không decompile module Wasm (Mục 3.4 bước 4).',
        details,
      };
    }

    // BƯỚC 5: Mặc định thông thường
    return {
      step: 5,
      recommended_channel: 'standard_dom_api',
      reason: 'Trang thông thường, không phát hiện mã hoá đặc thù hoặc WebSocket real-time. Dùng DOM/API theo tier 1-4 (Mục 3.4 bước 5).',
      details,
    };
  }
}
