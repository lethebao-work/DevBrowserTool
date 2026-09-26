/**
 * SPIKE: Kiểm tra Chrome có expose CDP trực tiếp hay không
 * 
 * Chạy: npx tsx scripts/spike-cdp-direct.ts
 * 
 * Kết quả quyết định:
 * - CDP accessible → Kiến trúc A/C khả thi (optional fast-path)
 * - CDP unreachable → Chỉ dùng Kiến trúc B (Agent-Driven)
 * 
 * Kiến trúc B luôn là nền tảng bất kể kết quả.
 */

const CDP_ENDPOINTS = [
  'http://127.0.0.1:9222/json',
  'http://127.0.0.1:9223/json',
  'http://127.0.0.1:9229/json',
  'http://127.0.0.1:9515/json', // ChromeDriver default
];

async function spikeCheckCdp(): Promise<void> {
  console.log('='.repeat(60));
  console.log('SPIKE: Kiểm tra Chrome CDP accessibility');
  console.log('='.repeat(60));
  console.log('');

  let foundEndpoint = false;

  for (const endpoint of CDP_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.log(`❌ ${endpoint} — HTTP ${response.status}`);
        continue;
      }

      const pages = (await response.json()) as Array<{
        type: string;
        title: string;
        url: string;
        webSocketDebuggerUrl?: string;
        id: string;
      }>;

      console.log(`✅ CDP endpoint accessible: ${endpoint}`);
      console.log(`   Pages found: ${pages.length}`);
      console.log('');

      for (const page of pages.slice(0, 8)) {
        console.log(`   [${page.type}] "${page.title}"`);
        console.log(`     URL: ${page.url}`);
        console.log(`     WS:  ${page.webSocketDebuggerUrl || 'N/A'}`);
        console.log('');
      }

      foundEndpoint = true;
      break;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log(`❌ ${endpoint} — Timeout (3s)`);
      } else {
        console.log(`❌ ${endpoint} — ${err.code || err.message}`);
      }
    }
  }

  console.log('');
  console.log('='.repeat(60));
  if (foundEndpoint) {
    console.log('KẾT QUẢ: CDP ACCESSIBLE');
    console.log('→ Kiến trúc A/C khả thi làm optional fast-path');
    console.log('→ Kiến trúc B vẫn là nền tảng (Agent-Driven)');
  } else {
    console.log('KẾT QUẢ: CDP UNREACHABLE');
    console.log('→ Chrome không bật --remote-debugging-port');
    console.log('→ Kiến trúc B (Agent-Driven) là lựa chọn duy nhất');
  }
  console.log('='.repeat(60));
}

spikeCheckCdp().catch(err => {
  console.error('Spike failed:', err);
  process.exit(1);
});
