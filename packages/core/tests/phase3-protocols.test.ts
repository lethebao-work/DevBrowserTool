/**
 * Phase 3 Tests — WebSocket, Binary Protocol & Channel Diagnostic (Mục 3.1, 3.4, 3.5, 3.7)
 *
 * Kiểm tra:
 * 1. WebSocketHookManager: Hook WebSocket trong browser, bắt frame text & binary (Mục 3.1)
 * 2. BinarySchemaEngine: Decode & encode Protobuf thuần thuật toán (Mục 3.5)
 * 3. BinarySchemaEngine: Suy ngược schema từ samples (Mục 3.5 Tháp gọi LLM 1 lần)
 * 4. DataChannelDiagnosticEngine: Quy trình chẩn đoán 4 bước (Mục 3.4)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { PlaywrightBrowserAdapter } from '../src/adapters/playwright-browser.js';
import { WebSocketHookManager } from '../src/protocols/websocket-hook.js';
import { BinarySchemaEngine, type BinarySchemaDefinition } from '../src/protocols/binary-schema.js';
import { DataChannelDiagnosticEngine } from '../src/protocols/channel-diagnostic.js';

const PROTOCOL_TEST_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <title>Protocol & Real-time Test Page</title>
</head>
<body>
  <h1>Real-time & Protocol Testing</h1>
  <div id="status">Connecting...</div>

  <script>
    // Mô phỏng crypto.subtle (vì about:blank không phải Secure Context nên browser không cấp sẵn)
    try {
      if (!window.crypto) window.crypto = {};
      if (!window.crypto.subtle) {
        window.crypto.subtle = {
          encrypt: () => Promise.resolve(new ArrayBuffer(8)),
          decrypt: () => Promise.resolve(new ArrayBuffer(8)),
        };
      }
    } catch {}
    window.indexedDB = window.indexedDB || {};
  </script>
</body>
</html>
`;

describe('Phase 3 — WebSocket & Binary Protocol Engine (Mục 3.1, 3.4, 3.5)', () => {
  let browser: Browser;
  let page: Page;
  let adapter: PlaywrightBrowserAdapter;

  beforeAll(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
    await page.setContent(PROTOCOL_TEST_PAGE);
    adapter = new PlaywrightBrowserAdapter(page);
  });

  afterAll(async () => {
    await browser?.close();
  });

  describe('WebSocketHookManager (Mục 3.1 & 3.4)', () => {
    it('cài đặt hook WebSocket thành công vào browser runtime', async () => {
      const installRes = await WebSocketHookManager.installHook(adapter);
      expect(installRes.success).toBe(true);

      // Cài lần 2 không gây lỗi
      const reInstall = await WebSocketHookManager.installHook(adapter);
      expect(reInstall.success).toBe(true);
      expect(reInstall.message).toContain('already installed');
    });

    it('bắt và ghi nhận các frame gửi (sent) và nhận (received) qua WebSocket', async () => {
      // Kích hoạt một WebSocket giả lập trên page để kiểm tra hook
      await page.evaluate(() => {
        // Tạo một custom event WebSocket dispatch
        const ws = new WebSocket('wss://echo.example.com/feed');
        ws.send(JSON.stringify({ type: 'subscribe', channel: 'ticker_BTC' }));
        // Giả lập nhận frame từ server
        if (ws.onmessage) {
          ws.onmessage({ data: JSON.stringify({ ticker: 'BTC', price: 68500 }) } as any);
        }
      });

      const frames = await WebSocketHookManager.getFrames(adapter);
      expect(frames.length).toBeGreaterThanOrEqual(1);

      const sentFrame = frames.find(f => f.direction === 'sent');
      expect(sentFrame).toBeDefined();
      expect(sentFrame?.socket_url).toContain('echo.example.com');
      expect(sentFrame?.data_text).toContain('subscribe');
    });

    it('ghi nhận chính xác active channels', async () => {
      const channels = await WebSocketHookManager.getActiveChannels(adapter);
      expect(channels.length).toBeGreaterThanOrEqual(1);
      expect(channels[0].url).toContain('echo.example.com');
    });
  });

  describe('BinarySchemaEngine (Mục 3.5 & Mục 4 binary_schema)', () => {
    const testSchema: BinarySchemaDefinition = {
      schema_name: 'MarketDataUpdate',
      version: '1.0.0',
      fields: [
        { tag: 1, name: 'symbol', type: 'string' },
        { tag: 2, name: 'price', type: 'fixed32' },
        { tag: 3, name: 'volume', type: 'varint' },
      ],
    };

    it('mã hoá và giải mã Protobuf message thuần thuật toán (không gọi LLM)', () => {
      const payload = {
        symbol: 'ETH/USDT',
        price: 3450.5,
        volume: 120,
      };

      // 1. Encode
      const encodedBytes = BinarySchemaEngine.encode(payload, testSchema);
      expect(encodedBytes).toBeInstanceOf(Uint8Array);
      expect(encodedBytes.length).toBeGreaterThan(0);

      // 2. Decode thuần thuật toán
      const decoded = BinarySchemaEngine.decode(encodedBytes, testSchema);
      expect(decoded.symbol).toBe('ETH/USDT');
      expect(decoded.volume).toBe(120);
      expect(Number(decoded.price)).toBeCloseTo(3450.5, 1);
    });

    it('giải mã tự động không cần schema bằng cách tự suy wire types', () => {
      const payload = {
        symbol: 'BTC',
        volume: 42,
      };

      const encodedBytes = BinarySchemaEngine.encode(payload, testSchema);
      const autoDecoded = BinarySchemaEngine.decode(encodedBytes);

      // Tự động phân rã thành tag_1 (string) và tag_3 (varint)
      expect(autoDecoded['field_1']).toBe('BTC');
      expect(autoDecoded['field_3']).toBe(42);
    });

    it('suy ngược BinarySchemaDefinition từ các frame mẫu (Mục 3.5)', async () => {
      const frame1 = BinarySchemaEngine.encode({ symbol: 'SOL', volume: 10 }, testSchema);
      const frame2 = BinarySchemaEngine.encode({ symbol: 'ADA', volume: 20 }, testSchema);

      const inferredSchema = await BinarySchemaEngine.inferSchemaFromSamples(
        [frame1, frame2],
        'InferredMarketFeed',
        'const config = { symbol: 1, volume: 3 };',
      );

      expect(inferredSchema.schema_name).toBe('InferredMarketFeed');
      expect(inferredSchema.fields.length).toBe(2);

      const tag1 = inferredSchema.fields.find(f => f.tag === 1);
      expect(tag1).toBeDefined();
      expect(tag1?.type).toBe('string');
      expect(tag1?.name).toBe('symbol');

      const tag3 = inferredSchema.fields.find(f => f.tag === 3);
      expect(tag3).toBeDefined();
      expect(tag3?.type).toBe('varint');
      expect(tag3?.name).toBe('volume');
    });
  });

  describe('DataChannelDiagnosticEngine: Quy trình chẩn đoán 4 bước (Mục 3.4)', () => {
    it('thực hiện tuần tự các bước và dừng ở kênh ưu tiên đầu tiên phù hợp', async () => {
      const result = await DataChannelDiagnosticEngine.diagnose(adapter);

      // Trang có crypto.subtle -> Dừng ngay tại bước 1: encryption_boundary
      expect(result.step).toBe(1);
      expect(result.recommended_channel).toBe('encryption_boundary');
      expect(result.details.has_client_crypto).toBe(true);
      expect(result.reason).toContain('Mục 3.4 bước 1');
    });
  });
});
