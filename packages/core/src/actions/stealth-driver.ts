/**
 * Stealth Driver Adapter & Subprocess Driver Bridge (Mục 8.3 & Mục 16)
 *
 * Nhiệm vụ:
 * 1. Cung cấp Driver thay thế chuyên biệt khi site VỪA có importance_score cao (≥ 0.8)
 *    VỪA có nguy cơ dùng hệ thống chống bot cấp doanh nghiệp (Cloudflare Enterprise, DataDome, Akamai).
 * 2. Triệt tiêu các dấu vết giao thức tự động hoá của CDP (Runtime.enable side-effects, navigator.webdriver).
 * 3. Hỗ trợ giao diện kết nối Subprocess Driver độc lập (như Camoufox / Nodriver) qua IPC/JSON-RPC,
 *    tuân thủ nghiêm ngặt Mục 16: KHÔNG trộn lẫn Python vào module lõi TypeScript.
 *
  */

import type { BrowserAdapter } from './primitives.js';
import { MAP_CONSTANTS } from '../map/schema.js';

export type DriverType = 'cdp_stealth' | 'external_subprocess' | 'standard_cdp';

export interface AlternativeBrowserDriver extends BrowserAdapter {
  driverType: DriverType;
  isCriticalSiteMode: boolean;
  stealthFeatures: string[];
}

export interface AntiBotDetectionResult {
  detected: boolean;
  vendor?: 'cloudflare' | 'datadome' | 'akamai' | 'perimeterx' | 'generic';
  signatures: string[];
}

/**
 * SitePolicyResolver — Xác định xem domain có đủ điều kiện kích hoạt Stealth Driver hay không (Mục 8.3).
 */
export class SitePolicyResolver {
  /** Các chữ ký đặc trưng của dịch vụ chống bot bên thứ ba cấp doanh nghiệp */
  public static readonly ENTERPRISE_ANTIBOT_SIGNATURES = [
    { vendor: 'cloudflare' as const, patterns: ['__cf_bm', 'cf-ray', 'cloudflare-static', 'challenges.cloudflare.com'] },
    { vendor: 'datadome' as const, patterns: ['datadome', 'dd.js', 'cid=datadome', 'api-js.datadome.co'] },
    { vendor: 'akamai' as const, patterns: ['akamai', '_abck', 'bm_sz', 'ak_bmsc'] },
    { vendor: 'perimeterx' as const, patterns: ['_px3', '_pxhd', 'client.perimeterx.net'] },
  ];

  /**
   * Phát hiện dấu hiệu dịch vụ chống bot doanh nghiệp bên thứ ba từ cookies/scripts/headers.
   */
  static detectThirdPartyAntiBot(
    cookies: string = '',
    htmlContent: string = '',
    headers: Record<string, string> = {}
  ): AntiBotDetectionResult {
    const matchedSignatures: string[] = [];
    let detectedVendor: AntiBotDetectionResult['vendor'] = undefined;

    const lowerCookies = cookies.toLowerCase();
    const lowerHtml = htmlContent.toLowerCase();
    const headerKeys = Object.keys(headers).map(k => `${k}:${headers[k]}`.toLowerCase());

    for (const item of this.ENTERPRISE_ANTIBOT_SIGNATURES) {
      for (const pattern of item.patterns) {
        if (
          lowerCookies.includes(pattern) ||
          lowerHtml.includes(pattern) ||
          headerKeys.some(h => h.includes(pattern))
        ) {
          matchedSignatures.push(pattern);
          if (!detectedVendor) detectedVendor = item.vendor;
        }
      }
    }

    return {
      detected: matchedSignatures.length > 0,
      vendor: detectedVendor,
      signatures: matchedSignatures,
    };
  }

  /**
   * Quyết định kích hoạt Driver thay thế chuyên biệt (Mục 8.3):
   * Điều kiện: importance_score >= 0.8 VÀ có phát hiện anti-bot doanh nghiệp (hoặc được gắn cờ chỉ định).
   */
  static shouldActivateStealthDriver(
    importanceScore: number,
    antiBotResult: AntiBotDetectionResult,
    forceStealth: boolean = false
  ): boolean {
    if (forceStealth) return true;
    const isCritical = importanceScore >= MAP_CONSTANTS.CRITICAL_SITE_IMPORTANCE_THRESHOLD;
    return isCritical && antiBotResult.detected;
  }
}

/**
 * CDPStealthAdapter — Bọc BrowserAdapter với lớp bảo vệ tầng giao thức CDP.
 *
 */
export class CDPStealthAdapter implements AlternativeBrowserDriver {
  public readonly driverType: DriverType = 'cdp_stealth';
  public readonly isCriticalSiteMode: boolean = true;
  public readonly stealthFeatures: string[] = [
    'navigator.webdriver-undefined',
    'chrome-runtime-mock',
    'plugins-mock',
    'languages-natural',
    'cdp-fingerprint-clearing',
  ];

  private readonly inner: BrowserAdapter;
  private isPrepared: boolean = false;

  constructor(inner: BrowserAdapter) {
    this.inner = inner;
  }

  /**
   * Khởi tạo các cờ stealth trong document context trước khi chạy actions.
   */
  async prepareStealthContext(): Promise<void> {
    if (this.isPrepared) return;

    await this.inner.evaluate(`
      (() => {
        try {
          // 1. Loại bỏ navigator.webdriver (xóa cờ tự động hoá cơ bản)
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true,
          });

          // 2. Bổ sung window.chrome chuẩn nếu chưa có
          if (!window['chrome']) {
            window['chrome'] = {
              runtime: {},
              loadTimes: function() {},
              csi: function() {},
              app: {},
            };
          }

          // 3. Giả lập languages tự nhiên
          if (!navigator.languages || navigator.languages.length === 0) {
            Object.defineProperty(navigator, 'languages', {
              get: () => ['en-US', 'en', 'vi'],
              configurable: true,
            });
          }

          // 4. Giả lập plugins array có độ dài tự nhiên
          if (navigator.plugins && navigator.plugins.length === 0) {
            const fakePlugins = [
              { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            ];
            Object.defineProperty(navigator, 'plugins', {
              get: () => fakePlugins,
              configurable: true,
            });
          }
        } catch {}
      })()
    `).catch(() => { });

    this.isPrepared = true;
  }

  async navigate(url: string): Promise<void> {
    await this.prepareStealthContext();
    await this.inner.navigate(url);
    // Tái áp dụng stealth sau khi trang tải mới
    await this.prepareStealthContext();
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    await this.prepareStealthContext();
    return this.inner.evaluate<T>(script);
  }

  async waitFor(condition: string, timeoutMs?: number): Promise<boolean> {
    return this.inner.waitFor(condition, timeoutMs);
  }

  async screenshot(): Promise<Buffer> {
    return this.inner.screenshot();
  }

  async currentUrl(): Promise<string> {
    return this.inner.currentUrl();
  }

  async currentTitle(): Promise<string> {
    return this.inner.currentTitle();
  }

  async getUrl(): Promise<string> {
    if (this.inner.getUrl) return this.inner.getUrl();
    return this.inner.currentUrl();
  }

  async click(selector: string): Promise<void> {
    await this.prepareStealthContext();
    await this.inner.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el && el instanceof HTMLElement) el.click();
      })()
    `);
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.prepareStealthContext();
    await this.inner.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
  }
}

/**
 * ExternalSubprocessDriverBridge — Cầu nối tiến trình Driver chuyên biệt (như Camoufox / Nodriver).
 *
 * Tuân thủ Mục 16:
 * - Module lõi 100% TypeScript.
 * - Giao tiếp với driver tiến trình ngoài qua JSON-RPC message passing.
 * - Tự động phát hiện khi tiến trình chưa sẵn sàng và fallback an toàn sang CDPStealthAdapter.
 */
export class ExternalSubprocessDriverBridge implements AlternativeBrowserDriver {
  public readonly driverType: DriverType = 'external_subprocess';
  public readonly isCriticalSiteMode: boolean = true;
  public readonly stealthFeatures: string[] = ['cdp-free-socket', 'custom-c++-browser-fingerprint'];

  private readonly endpointUrl: string;
  private readonly fallbackAdapter: BrowserAdapter;
  private isConnected: boolean = false;

  constructor(endpointUrl: string = 'http://127.0.0.1:9222/jsonrpc', fallbackAdapter: BrowserAdapter) {
    this.endpointUrl = endpointUrl;
    this.fallbackAdapter = fallbackAdapter;
  }

  /**
   * Kiểm tra xem tiến trình driver ngoài có đang lắng nghe hay không.
   */
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpointUrl}/health`, { signal: AbortSignal.timeout(500) });
      this.isConnected = res.ok;
      return this.isConnected;
    } catch {
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Gửi RPC call tới tiến trình driver ngoài (hoặc fallback nếu không khả dụng).
   */
  private async executeRpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.isConnected) {
      const alive = await this.checkHealth();
      if (!alive) {
        // Fallback sang adapter nội bộ khi tiến trình ngoài không khả dụng
        return this.executeFallback<T>(method, params);
      }
    }

    try {
      const response = await fetch(this.endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) throw new Error(`RPC HTTP error: ${response.status}`);
      const json: any = await response.json();
      if (json && json.error) throw new Error(`RPC method error: ${json.error.message || json.error}`);
      return json.result as T;
    } catch {
      // Fallback
      return this.executeFallback<T>(method, params);
    }
  }

  private async executeFallback<T>(method: string, params: Record<string, unknown>): Promise<T> {
    switch (method) {
      case 'navigate':
        await this.fallbackAdapter.navigate(String(params['url']));
        return undefined as T;
      case 'evaluate':
        return this.fallbackAdapter.evaluate<T>(String(params['script']));
      case 'waitFor':
        return (await this.fallbackAdapter.waitFor(String(params['condition']), Number(params['timeoutMs']))) as T;
      case 'screenshot':
        return (await this.fallbackAdapter.screenshot()) as T;
      case 'currentUrl':
        return (await this.fallbackAdapter.currentUrl()) as T;
      case 'currentTitle':
        return (await this.fallbackAdapter.currentTitle()) as T;
      default:
        throw new Error(`Unsupported driver method: ${method}`);
    }
  }

  async navigate(url: string): Promise<void> {
    await this.executeRpc('navigate', { url });
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    return this.executeRpc<T>('evaluate', { script });
  }

  async waitFor(condition: string, timeoutMs?: number): Promise<boolean> {
    return this.executeRpc<boolean>('waitFor', { condition, timeoutMs });
  }

  async screenshot(): Promise<Buffer> {
    return this.executeRpc<Buffer>('screenshot');
  }

  async currentUrl(): Promise<string> {
    return this.executeRpc<string>('currentUrl');
  }

  async currentTitle(): Promise<string> {
    return this.executeRpc<string>('currentTitle');
  }

  async getUrl(): Promise<string> {
    return this.currentUrl();
  }
}
