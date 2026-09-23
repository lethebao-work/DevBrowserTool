/**
 * Static Source Analyzer — Phân tích tĩnh trước khi khám phá (Mục 3.1 bước 1 & Mục 1.5)
 *
 * Nhiệm vụ:
 * 1. Kiểm tra Source Maps (.js.map) lộ ra cạnh các bundles script.
 * 2. Quét các OpenAPI / Swagger specification phổ biến.
 * 3. Trích xuất trực tiếp các API endpoints và form components lộ ra,
 *    giảm thiểu tối đa chi phí token và lượt gọi browser mù.
 */

import type { BrowserAdapter } from '../actions/primitives.js';
import type { ResourceNodeInput } from '../map/schema.js';

export interface StaticAnalysisResult {
  has_source_maps: boolean;
  discovered_endpoints: string[];
  discovered_components: string[];
  candidate_nodes: ResourceNodeInput[];
  source_map_urls: string[];
  swagger_urls: string[];
}

export class StaticAnalyzer {
  private static readonly COMMON_SWAGGER_PATHS = [
    '/openapi.json',
    '/swagger.json',
    '/api-docs',
    '/v2/api-docs',
    '/v3/api-docs',
    '/api/swagger.json',
  ];

  /**
   * Phân tích tĩnh một trang web đang mở trên trình duyệt.
   */
  static async analyzePage(browser: BrowserAdapter, baseUrl: string): Promise<StaticAnalysisResult> {
    const candidateNodes: ResourceNodeInput[] = [];
    const discoveredEndpoints: string[] = [];
    const discoveredComponents: string[] = [];
    const sourceMapUrls: string[] = [];
    const swaggerUrls: string[] = [];

    try {
      // 1. Quét các thẻ <script src="..."> trên trang để tìm .js.map
      const scriptUrls = await browser.evaluate<string[]>(`
        (() => {
          const scripts = Array.from(document.querySelectorAll('script[src]'));
          return scripts.map(s => s.src).filter(Boolean);
        })()
      `);

      for (const scriptUrl of scriptUrls ?? []) {
        // Kiểm tra xem script có sourceMappingURL comment hoặc file .map cạnh bên không
        if (scriptUrl.endsWith('.js')) {
          const possibleMapUrl = `${scriptUrl}.map`;
          sourceMapUrls.push(possibleMapUrl);
        }
      }

      // 2. Thử dò tìm Swagger / OpenAPI công khai
      for (const path of this.COMMON_SWAGGER_PATHS) {
        try {
          const targetSwaggerUrl = new URL(path, baseUrl).toString();
          // Kiểm tra fetch thử trong browser context
          const checkResult = await browser.evaluate<{ status: number; hasSpec: boolean }>(`
            (async () => {
              try {
                const res = await fetch(${JSON.stringify(targetSwaggerUrl)}, { method: 'HEAD' });
                return { status: res.status, hasSpec: res.status === 200 };
              } catch {
                return { status: 0, hasSpec: false };
              }
            })()
          `);

          if (checkResult && checkResult.hasSpec) {
            swaggerUrls.push(targetSwaggerUrl);
            discoveredEndpoints.push(path);

            candidateNodes.push({
              id: `api-spec-${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
              type: 'endpoint',
              intent: `API Spec Document (${path})`,
              created_at: Date.now(),
              updated_at: Date.now(),
              discovered_via: 'normal',
              requires_elevation: false,
              variants: [
                {
                  id: `var_${path.replace(/[^a-zA-Z0-9]/g, '_')}`,
                  value_formula: targetSwaggerUrl,
                  confidence: 1.0,
                  last_verified: Date.now(),
                  ttl_ms: 30 * 24 * 60 * 60 * 1000,
                  fail_count_recent: 0,
                  locale: null,
                  created_at: Date.now(),
                },
              ],
            });
          }
        } catch {
          // Bỏ qua lỗi URL không hợp lệ
        }
      }

      // 3. Phân tích tĩnh các form và interactive elements có sẵn trong DOM ban đầu
      const domElements = await browser.evaluate<Array<{ intent: string; selector: string; role: string }>>(`
        (() => {
          const elements = [];
          // Quét các button, input, textarea có ID, name hoặc role rõ ràng
          document.querySelectorAll('button, input, textarea, select, form[action]').forEach(el => {
            const id = el.getAttribute('id');
            const name = el.getAttribute('name');
            const role = el.getAttribute('role') || el.tagName.toLowerCase();
            const text = el.textContent?.trim().slice(0, 30) || el.getAttribute('aria-label') || '';
            let selector = '';
            let intent = '';

            if (id) {
              selector = '#' + id;
              intent = text || id;
            } else if (name) {
              selector = el.tagName.toLowerCase() + '[name="' + name + '"]';
              intent = text || name;
            } else if (el.tagName.toLowerCase() === 'button') {
              selector = text ? 'button:has-text("' + text + '")' : 'button';
              intent = text || 'Button';
            }

            if (selector) {
              elements.push({
                intent: intent || selector,
                selector,
                role
              });
            }
          });
          return elements;
        })()
      `);

      for (const el of domElements ?? []) {
        discoveredComponents.push(el.selector);
        candidateNodes.push({
          id: `dom-${el.selector.replace(/[^a-zA-Z0-9]/g, '_')}`,
          type: 'dom_element',
          intent: el.intent,
          created_at: Date.now(),
          updated_at: Date.now(),
          discovered_via: 'normal',
          requires_elevation: false,
          variants: [
            {
              id: `var_dom_${el.selector.replace(/[^a-zA-Z0-9]/g, '_')}`,
              value_formula: `document.querySelector(${JSON.stringify(el.selector)})`,
              confidence: 0.9,
              last_verified: Date.now(),
              ttl_ms: 30 * 24 * 60 * 60 * 1000,
              fail_count_recent: 0,
              locale: null,
              created_at: Date.now(),
            },
          ],
        });
      }
    } catch (err) {
      // Static analysis fail không chặn toàn bộ hệ thống
    }

    return {
      has_source_maps: sourceMapUrls.length > 0,
      discovered_endpoints: discoveredEndpoints,
      discovered_components: discoveredComponents,
      candidate_nodes: candidateNodes,
      source_map_urls: sourceMapUrls,
      swagger_urls: swaggerUrls,
    };
  }
}
