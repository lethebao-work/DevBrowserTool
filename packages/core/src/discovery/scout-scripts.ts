/**
 * ScoutScripts — JS expressions cung cấp cho Agent chạy trên page (Kiến trúc B)
 *
 * Module này KHÔNG tương tác với browser. Nó chỉ trả về các chuỗi JavaScript
 * mà Agent (hoặc bất kỳ BrowserAdapter nào) sẽ evaluate trên page thật.
 *
 * Mỗi script là 1 IIFE trả về JSON-serializable data.
 * Agent chạy qua: browser_execute_script(code=script) hoặc
 *                 chrome-devtools.evaluate_script(pageId, function=script)
 *
 * Giá trị lõi: Đóng gói tri thức bóc tách 7 loại tài nguyên thành công thức
 * tái sử dụng — Agent không cần biết cách quét DOM/Network, chỉ chạy script
 * và gửi kết quả về DevBrowserTool.
 */

export interface ScoutScript {
  /** ID duy nhất cho script */
  id: string;
  /** Mô tả cho Agent biết script làm gì */
  description: string;
  /** JavaScript IIFE expression — evaluate trên page context */
  code: string;
}

export class ScoutScripts {
  /**
   * Trả về thông tin cơ bản của trang (title, URL).
   */
  static getPageInfoScript(): ScoutScript {
    return {
      id: 'page_info',
      description: 'Lấy tiêu đề và URL hiện tại của trang',
      code: `(() => ({
  title: document.title || '',
  url: window.location.href
}))()`,
    };
  }

  /**
   * Trả về script bóc tách toàn bộ DOM tương tác.
   * Extract từ live-scout.ts dòng 350-428 — giữ nguyên logic.
   */
  static getDomExtractionScript(): ScoutScript {
    return {
      id: 'dom_elements',
      description:
        'Bóc tách toàn bộ phần tử tương tác DOM (Buttons, Inputs, Tabs, Links, Cards)',
      code: `(() => {
  const results = [];
  const seenSelectors = new Set();

  // 1. Quét tất cả clickable elements: buttons, tabs, links, [role=button], nav-items
  const clickables = document.querySelectorAll(
    'button, [role="button"], a[href], .nav-menu-item, input[type="button"], input[type="submit"], [tabindex="0"]'
  );

  for (const el of clickables) {
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute('id') || '';
    const text = (el.textContent?.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 45);
    if (!text && !id) continue;

    let selector = '';
    if (id) {
      selector = '#' + id;
    } else if (el.className && typeof el.className === 'string') {
      const mainClass = el.className.split(' ').filter(c => c && !c.includes(':') && c.length < 30).slice(0, 2).join('.');
      if (mainClass) {
        selector = tag + '.' + mainClass;
        if (text) selector += ':has-text("' + text + '")';
      }
    }
    if (!selector && text) {
      selector = tag + ':has-text("' + text + '")';
    }
    if (!selector) selector = tag;

    if (!seenSelectors.has(selector)) {
      seenSelectors.add(selector);
      results.push({
        tag,
        id,
        name: el.getAttribute('name') || '',
        type: 'button',
        role: el.getAttribute('role') || 'button',
        text,
        selector
      });
    }
  }

  // 2. Quét tất cả input fields, textareas, selects
  const formControls = document.querySelectorAll('input:not([type="button"]):not([type="submit"]):not([type="hidden"]), textarea, select');
  for (const fc of formControls) {
    const tag = fc.tagName.toLowerCase();
    const id = fc.getAttribute('id') || '';
    const name = fc.getAttribute('name') || '';
    const type = fc.getAttribute('type') || (tag === 'textarea' ? 'textarea' : 'text');
    const placeholder = fc.getAttribute('placeholder') || '';

    let selector = '';
    if (id) selector = '#' + id;
    else if (name) selector = tag + '[name="' + name + '"]';
    else if (placeholder) selector = tag + '[placeholder="' + placeholder + '"]';
    else selector = tag + '[type="' + type + '"]';

    const label = id ? (document.querySelector('label[for="' + id + '"]')?.textContent?.trim() || '') : '';
    const desc = label || placeholder || name || id || type;

    if (!seenSelectors.has(selector)) {
      seenSelectors.add(selector);
      results.push({
        tag,
        id,
        name,
        type,
        role: 'input',
        text: desc,
        selector
      });
    }
  }

  return results;
})()`,
    };
  }

  /**
   * Trả về script bóc tách Performance API entries (API endpoints).
   * Extract từ live-scout.ts dòng 163-174.
   */
  static getPerformanceExtractionScript(): ScoutScript {
    return {
      id: 'performance_entries',
      description: 'Lấy danh sách API/Resource requests từ Performance API',
      code: `(() => {
  try {
    return performance.getEntriesByType('resource').map(r => ({
      name: r.name,
      initiator: r.initiatorType
    }));
  } catch {
    return [];
  }
})()`,
    };
  }

  /**
   * Trả về script bóc tách LocalStorage/SessionStorage.
   * Extract từ live-scout.ts dòng 283-294.
   */
  static getStorageExtractionScript(): ScoutScript {
    return {
      id: 'storage_keys',
      description: 'Lấy danh sách keys của LocalStorage và SessionStorage',
      code: `(() => {
  try {
    return {
      localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage)
    };
  } catch {
    return { localStorageKeys: [], sessionStorageKeys: [] };
  }
})()`,
    };
  }

  /**
   * Trả về script phát hiện WebSocket connections qua performance entries.
   * Thay thế cho page.on('request') listener (không có trong BrowserAdapter).
   */
  static getWebSocketDetectionScript(): ScoutScript {
    return {
      id: 'websocket_detection',
      description: 'Phát hiện kết nối WebSocket đang hoạt động trên trang',
      code: `(() => {
  try {
    const wsEntries = performance.getEntriesByType('resource')
      .filter(r => r.name.startsWith('ws://') || r.name.startsWith('wss://'))
      .map(r => r.name);
    return [...new Set(wsEntries)];
  } catch {
    return [];
  }
})()`,
    };
  }

  /**
   * Trả về tất cả scripts cần thiết cho 1 phiên scout đầy đủ.
   * Agent chạy tất cả scripts này trên page, rồi gọi ingest_scout_data.
   */
  static getAllScoutScripts(): ScoutScript[] {
    return [
      this.getPageInfoScript(),
      this.getDomExtractionScript(),
      this.getPerformanceExtractionScript(),
      this.getStorageExtractionScript(),
      this.getWebSocketDetectionScript(),
    ];
  }
}
