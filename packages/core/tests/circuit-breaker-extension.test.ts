/**
 * Circuit Breaker Extension Runtime Persistence Tests (Mục 1.4, 7.1, 15.3)
 *
 * Kiểm chứng tính bền vững của Circuit Breaker trong môi trường Chrome Extension:
 * 1. Lưu trữ và đọc lại từ chrome.storage.local
 * 2. Giữ nguyên trạng thái ngắt (tripped) sau khi tab/extension reload (persistence test)
 * 3. Tự động phục hồi (auto-recover) sau khi vượt quá sliding window
 * 4. Nút reset xoá sạch lịch sử lỗi trong storage
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { getCircuitBreakerTemplate } from '../src/packager/templates.js';

declare const window: any;

describe('Circuit Breaker Extension Runtime (Mục 1.4)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    await page.setContent('<html><body><h1>Circuit Breaker Testbed</h1></body></html>');

    // Khởi tạo mock chrome.storage.local trực tiếp trong browser context
    await page.evaluate(() => {
      (window as any).__storageData__ = (window as any).__storageData__ || {};
      (window as any).chrome = (window as any).chrome || {};
      (window as any).chrome.storage = {
        local: {
          get: async (keys: string[]) => {
            const res: Record<string, any> = {};
            for (const key of keys) {
              if (key in (window as any).__storageData__) {
                res[key] = JSON.parse(JSON.stringify((window as any).__storageData__[key]));
              }
            }
            return res;
          },
          set: async (items: Record<string, any>) => {
            for (const [k, v] of Object.entries(items)) {
              (window as any).__storageData__[k] = JSON.parse(JSON.stringify(v));
            }
          },
          clear: async () => {
            (window as any).__storageData__ = {};
          },
        },
      };
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('nạp template ToolCircuitBreaker vào browser context thành công', async () => {
    const script = getCircuitBreakerTemplate('test.example.com');
    await page.evaluate(script);

    const isDefined = await page.evaluate(() => typeof (window as any).ToolCircuitBreaker === 'function');
    expect(isDefined).toBe(true);
  });

  it('ghi nhận lỗi và lưu vào chrome.storage.local', async () => {
    const result = await page.evaluate(async () => {
      const cb = new (window as any).ToolCircuitBreaker('test.example.com', 3, 600000);
      await cb.recordFail('node_1');
      await cb.recordFail('node_2');
      const isTripped = await cb.isTripped();
      const storageState = await (window as any).chrome.storage.local.get(['dbt_cb_test_example_com']);
      return { isTripped, storageState };
    });

    expect(result.isTripped).toBe(false);
    expect(result.storageState['dbt_cb_test_example_com'].records.length).toBe(2);
  });

  it('ngắt mạch (trip) khi đạt ngưỡng thất bại tối đa (3 lần)', async () => {
    const result = await page.evaluate(async () => {
      const cb = new (window as any).ToolCircuitBreaker('test.example.com', 3, 600000);
      await cb.recordFail('node_3');
      const isTripped = await cb.isTripped();
      return isTripped;
    });

    expect(result).toBe(true);
  });

  it('bền vững qua các lần khởi động lại: một instance mới đọc đúng trạng thái ngắt từ chrome.storage.local', async () => {
    const result = await page.evaluate(async () => {
      // Giả lập extension restart: tạo instance hoàn toàn mới
      const newInstance = new (window as any).ToolCircuitBreaker('test.example.com', 3, 600000);
      const isTrippedAfterRestart = await newInstance.isTripped();
      return isTrippedAfterRestart;
    });

    expect(result).toBe(true);
  });

  it('reset mạch thành công và đồng bộ lại vào storage', async () => {
    const result = await page.evaluate(async () => {
      const cb = new (window as any).ToolCircuitBreaker('test.example.com', 3, 600000);
      await cb.reset();
      const isTrippedAfterReset = await cb.isTripped();
      const storageState = await (window as any).chrome.storage.local.get(['dbt_cb_test_example_com']);
      return { isTrippedAfterReset, storageState };
    });

    expect(result.isTrippedAfterReset).toBe(false);
    expect(result.storageState['dbt_cb_test_example_com'].records.length).toBe(0);
  });

  it('tự động phục hồi (sliding window decay) khi các bản ghi lỗi đã hết hạn', async () => {
    const result = await page.evaluate(async () => {
      // Cấu hình sliding window cực ngắn 50ms để test tự phục hồi
      const cb = new (window as any).ToolCircuitBreaker('quick.example.com', 2, 50);
      await cb.recordFail('n1');
      await cb.recordFail('n2');
      const immediateTrip = await cb.isTripped();

      // Chờ 80ms để sliding window trôi qua
      await new Promise((r) => setTimeout(r, 80));
      const recoveredTrip = await cb.isTripped();

      return { immediateTrip, recoveredTrip };
    });

    expect(result.immediateTrip).toBe(true);
    expect(result.recoveredTrip).toBe(false);
  });
});
