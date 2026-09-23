/**
 * Source-First Discovery Engine — Khám phá ưu tiên nguồn có sẵn (Mục 3.1 bước 1)
 *
 * Nguyên tắc: Rẻ nhất, chính xác nhất.
 * 1. Kiểm tra sourcemap (`.js.map` hoặc `sourceMappingURL=`) lộ ra cạnh bundle JS.
 * 2. Giải mã và dựng lại cây project ảo (`sources`, `sourcesContent`).
 * 3. Trích xuất trực tiếp các API endpoints, routes, và component definitions từ source.
 * 4. Nếu tìm được -> BỎ QUA các bước dò mù cho phần đã lộ source.
 */

import type { BrowserAdapter } from '../actions/primitives.js';
import { MAP_CONSTANTS, type ResourceNode, type Variant } from '../map/schema.js';

export interface VirtualSourceFile {
  path: string;
  content: string;
  sizeBytes: number;
}

export interface ExtractedEndpoint {
  method: string;
  path: string;
  sourceFile: string;
  line?: number;
}

export interface ExtractedComponent {
  name: string;
  roleHint?: string;
  sourceFile: string;
}

export interface SourceFirstResult {
  hasSourceMap: boolean;
  sourceMapUrl?: string;
  virtualFiles: VirtualSourceFile[];
  extractedEndpoints: ExtractedEndpoint[];
  extractedComponents: ExtractedComponent[];
  candidateNodes: ResourceNode[];
  canBypassBlindDiscovery: boolean;
  unminifiedBundleDetected: boolean;
}

export interface RawSourceMap {
  version: number | string;
  file?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings?: string;
}

export class SourceFirstDiscovery {
  /**
   * Quét trang hiện tại để phát hiện sourcemap và mã nguồn chưa bị minify.
   */
  static async scan(browser: BrowserAdapter, currentDomain: string): Promise<SourceFirstResult> {
    try {
      // Quét DOM tìm các script tags, sourcemap comments, hoặc unminified code
      const inspection = await browser.evaluate<{
        sourceMapUrls: string[];
        inlineSourceMaps: string[];
        unminifiedScripts: string[];
      }>(`
        (() => {
          const sourceMapUrls = [];
          const inlineSourceMaps = [];
          const unminifiedScripts = [];

          const scripts = Array.from(document.querySelectorAll('script[src], script:not([src])'));
          for (const s of scripts) {
            const text = s.textContent || '';
            const src = s.getAttribute('src') || '';

            // Tìm sourceMappingURL
            const smMatch = text.match(/\\/\\/#\\s*sourceMappingURL=(\\S+)/);
            if (smMatch && smMatch[1]) {
              const url = smMatch[1];
              if (url.startsWith('data:application/json;base64,')) {
                inlineSourceMaps.push(url);
              } else {
                sourceMapUrls.push(url);
              }
            } else if (src && !src.startsWith('chrome-extension://')) {
              // Đoán URL sourcemap chuẩn .js.map
              if (src.endsWith('.js')) {
                sourceMapUrls.push(src + '.map');
              }
            }

            // Kiểm tra unminified script
            if (text.length > 200 && text.includes('function ') && text.includes('\\n') && !text.includes('webpackChunk')) {
              unminifiedScripts.push(text.slice(0, 500));
            }
          }

          return {
            sourceMapUrls: Array.from(new Set(sourceMapUrls)),
            inlineSourceMaps,
            unminifiedScripts,
          };
        })()
      `);

      let rawMap: RawSourceMap | null = null;
      let usedSourceMapUrl: string | undefined;

      // 1. Thử parse inline sourcemap nếu có
      if (inspection?.inlineSourceMaps && inspection.inlineSourceMaps.length > 0) {
        const dataUrl = inspection.inlineSourceMaps[0];
        try {
          const base64Content = dataUrl.replace('data:application/json;base64,', '');
          const decoded = Buffer.from(base64Content, 'base64').toString('utf-8');
          if (decoded.length <= MAP_CONSTANTS.SOURCE_MAP_MAX_SIZE_BYTES) {
            rawMap = JSON.parse(decoded) as RawSourceMap;
            usedSourceMapUrl = 'data:application/json;base64,[embedded]';
          }
        } catch {
          // Ignore parse error
        }
      }

      const virtualFiles: VirtualSourceFile[] = [];
      if (rawMap && Array.isArray(rawMap.sources)) {
        for (let i = 0; i < rawMap.sources.length; i++) {
          const sourcePath = rawMap.sources[i];
          const content = rawMap.sourcesContent?.[i] || '';
          virtualFiles.push({
            path: sourcePath,
            content,
            sizeBytes: Buffer.byteLength(content, 'utf-8'),
          });
        }
      }

      // 2. Phân tích virtualFiles để trích xuất endpoints và components
      const extractedEndpoints = this.extractEndpointsFromFiles(virtualFiles);
      const extractedComponents = this.extractComponentsFromFiles(virtualFiles);

      // 3. Xây dựng candidate ResourceNodes từ endpoints đã lộ source
      const candidateNodes = this.buildNodesFromExtracted(extractedEndpoints, extractedComponents, currentDomain);

      const hasSourceMap = virtualFiles.length > 0;
      const canBypassBlindDiscovery = candidateNodes.length > 0;
      const unminifiedBundleDetected = Boolean(inspection?.unminifiedScripts && inspection.unminifiedScripts.length > 0);

      return {
        hasSourceMap,
        sourceMapUrl: usedSourceMapUrl,
        virtualFiles,
        extractedEndpoints,
        extractedComponents,
        candidateNodes,
        canBypassBlindDiscovery,
        unminifiedBundleDetected,
      };
    } catch {
      return {
        hasSourceMap: false,
        virtualFiles: [],
        extractedEndpoints: [],
        extractedComponents: [],
        candidateNodes: [],
        canBypassBlindDiscovery: false,
        unminifiedBundleDetected: false,
      };
    }
  }

  /**
   * Giải mã một raw sourcemap string hoặc object trực tiếp (tiện ích cho unit test & offline processing).
   */
  static parseSourceMapContent(content: string | RawSourceMap): VirtualSourceFile[] {
    const raw: RawSourceMap = typeof content === 'string' ? JSON.parse(content) : content;
    const files: VirtualSourceFile[] = [];

    if (raw && Array.isArray(raw.sources)) {
      for (let i = 0; i < raw.sources.length; i++) {
        const path = raw.sources[i];
        const fileContent = raw.sourcesContent?.[i] || '';
        files.push({
          path,
          content: fileContent,
          sizeBytes: Buffer.byteLength(fileContent, 'utf-8'),
        });
      }
    }

    return files;
  }

  /**
   * Quét source code tìm các API endpoints (fetch, axios, routes).
   */
  static extractEndpointsFromFiles(files: VirtualSourceFile[]): ExtractedEndpoint[] {
    const endpoints: ExtractedEndpoint[] = [];
    const seen = new Set<string>();

    // Regex tìm các lời gọi API thông dụng
    const apiRegexes = [
      /(?:fetch|axios\.(?:get|post|put|delete|patch)|api\.(?:get|post|put|delete))\s*\(\s*['"`]([\/a-zA-Z0-9_\-\.\?&=:]+)['"`]/g,
      /(?:url|endpoint|path)\s*:\s*['"`](\/api\/[a-zA-Z0-9_\-\.\?&=:]+)['"`]/g,
      /(?:GET|POST|PUT|DELETE|PATCH)\s+(['"`]?)(\/api\/[a-zA-Z0-9_\-\.\?&=:]+)\1/g,
    ];

    for (const file of files) {
      for (const regex of apiRegexes) {
        let match: RegExpExecArray | null;
        while ((match = regex.exec(file.content)) !== null) {
          const endpointPath = match[1] || match[2];
          if (endpointPath && endpointPath.startsWith('/') && !seen.has(endpointPath)) {
            seen.add(endpointPath);
            let method = 'GET';
            if (/post/i.test(match[0])) method = 'POST';
            else if (/put/i.test(match[0])) method = 'PUT';
            else if (/delete/i.test(match[0])) method = 'DELETE';

            endpoints.push({
              method,
              path: endpointPath,
              sourceFile: file.path,
            });
          }
        }
      }
    }

    return endpoints;
  }

  /**
   * Quét source code tìm các component UI (React / Vue / Svelte components).
   */
  static extractComponentsFromFiles(files: VirtualSourceFile[]): ExtractedComponent[] {
    const components: ExtractedComponent[] = [];
    const seen = new Set<string>();

    const componentRegex = /(?:export\s+(?:default\s+)?(?:function|const)\s+([A-Z][a-zA-Z0-9]+)|class\s+([A-Z][a-zA-Z0-9]+)\s+extends)/g;

    for (const file of files) {
      let match: RegExpExecArray | null;
      while ((match = componentRegex.exec(file.content)) !== null) {
        const compName = match[1] || match[2];
        if (compName && !seen.has(compName)) {
          seen.add(compName);
          let roleHint = 'ui_component';
          if (/button|btn/i.test(compName)) roleHint = 'button';
          else if (/form|input/i.test(compName)) roleHint = 'form';
          else if (/modal|dialog/i.test(compName)) roleHint = 'dialog';

          components.push({
            name: compName,
            roleHint,
            sourceFile: file.path,
          });
        }
      }
    }

    return components;
  }

  /**
   * Tạo ResourceNodes chuẩn từ thông tin source trích xuất được.
   * Gán cờ discovered_via: 'normal' và TTL chuẩn 30 ngày (Mục 3.1 & 15.2).
   */
  static buildNodesFromExtracted(
    endpoints: ExtractedEndpoint[],
    components: ExtractedComponent[],
    domain: string,
  ): ResourceNode[] {
    const nodes: ResourceNode[] = [];
    const now = Date.now();

    for (const ep of endpoints) {
      const sanitizedName = ep.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
      const variant: Variant = {
        id: `v_src_${sanitizedName}`,
        value_formula: `API: ${ep.method} ${ep.path}`,
        confidence: 0.95, // Rất cao vì lấy trực tiếp từ source map lộ ra
        last_verified: now,
        fail_count_recent: 0,
        locale: null,
        created_at: now,
        ttl_ms: MAP_CONSTANTS.TTL_NORMAL_MS, // 30 ngày
      };

      nodes.push({
        id: `endpoint_${sanitizedName}`,
        type: 'endpoint',
        intent: `API ${ep.method} ${ep.path} (từ ${ep.sourceFile})`,
        description: `Trích xuất từ sourcemap: ${ep.sourceFile}`,
        variants: [variant],
        discovered_via: 'normal',
        requires_elevation: false,
        created_at: now,
        updated_at: now,
      });
    }

    return nodes;
  }
}
