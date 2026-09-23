/**
 * Map Export/Import Engine — Xuất nhập bản đồ thủ công (Mục 2 nguyên tắc 1 & Mục 4)
 *
 * Nguyên tắc bất biến:
 * 1. CHỈ áp dụng cho MapFile, TUYỆT ĐỐI KHÔNG áp dụng cho Tool (Mục 4 & 5.4).
 * 2. Từ chối ngay nếu phát hiện payload chứa mã nguồn thực thi Tool hoặc userscript.
 * 3. Kiểm tra tính toàn vẹn (SHA-256 checksum) và tương thích schema_version.
 * 4. Tẩy rửa (sanitize) các token xác thực nhạy cảm nếu có trong URLs.
 * 5. Ghi file atomic (thừa hưởng từ MapStore).
 */

import { createHash } from 'node:crypto';
import { MapFileSchema, type MapFile } from './schema.js';
import type { MapStore } from './store.js';

export interface MapExportEnvelope {
  format: 'DevBrowserTool_MapFile_Export';
  format_version: '1.0.0';
  exported_at: number;
  checksum_sha256: string;
  data: MapFile;
}

export interface ImportResult {
  success: boolean;
  importedDomain: string;
  checksumVerified: boolean;
  contentRevision: number;
  baseNodesCount: number;
  stateCount: number;
  map: MapFile;
}

export class MapExportImportEngine {
  /**
   * Xuất MapFile thành gói Envelope JSON có chữ ký checksum (Mục 4).
   */
  static exportMap(map: MapFile): { jsonString: string; envelope: MapExportEnvelope } {
    // 1. Tẩy rửa dữ liệu nhạy cảm nếu có trong state graph match_key (token, password)
    const sanitizedMap: MapFile = JSON.parse(JSON.stringify(map));
    for (const state of sanitizedMap.state_graph) {
      if (state.match_key.url_pattern) {
        state.match_key.url_pattern = state.match_key.url_pattern
          .replace(/([?&](?:token|auth|key|secret|password)=)[^&]+/gi, '$1[REDACTED]');
      }
    }

    // 2. Tính SHA-256 checksum của map data
    const dataString = JSON.stringify(sanitizedMap);
    const checksum = createHash('sha256').update(dataString, 'utf-8').digest('hex');

    const envelope: MapExportEnvelope = {
      format: 'DevBrowserTool_MapFile_Export',
      format_version: '1.0.0',
      exported_at: Date.now(),
      checksum_sha256: checksum,
      data: sanitizedMap,
    };

    return {
      jsonString: JSON.stringify(envelope, null, 2),
      envelope,
    };
  }

  /**
   * Nhập gói MapFile vào MapStore sau khi kiểm tra schema và bảo mật (Mục 4).
   */
  static async importMap(
    jsonString: string,
    store: MapStore,
  ): Promise<ImportResult> {
    let parsed: any;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      throw new Error(`Dữ liệu JSON không hợp lệ: ${String(err)}`);
    }

    // ========================================================================
    // NGUYÊN TẮC BẢO MẬT BẮT BUỘC (Mục 4 & Mục 5.4):
    // CHỈ cho phép MapFile, TUYỆT ĐỐI CẤM Tool export/import
    // ========================================================================
    if (
      parsed.actions ||
      parsed.tool_name ||
      parsed.tool_version ||
      jsonString.includes('// ==UserScript==') ||
      jsonString.includes('class ExtensionPackager') ||
      jsonString.includes('chrome.runtime')
    ) {
      throw new Error(
        'Từ chối nhập: Phát hiện dữ liệu chứa mã nguồn hoặc cấu trúc của Tool. Theo Mục 4 và Mục 5.4, hệ thống CHỈ cho phép export/import MapFile, TUYỆT ĐỐI KHÔNG export/import Tool.',
      );
    }

    let mapData: any;
    let checksumVerified = false;

    // Kiểm tra định dạng envelope
    if (parsed.format === 'DevBrowserTool_MapFile_Export' && parsed.data) {
      mapData = parsed.data;
      // Xác minh tính toàn vẹn dữ liệu (chống lỗi truyền tải, cắt cụt file hoặc bit rot)
      const rawDataString = JSON.stringify(parsed.data);
      const computedHash = createHash('sha256').update(rawDataString, 'utf-8').digest('hex');
      checksumVerified = computedHash === parsed.checksum_sha256;
      if (!checksumVerified) {
        throw new Error('Từ chối nhập: Checksum SHA-256 không khớp, tệp có thể đã bị hư hại hoặc lỗi trong quá trình lưu trữ/truyền tải.');
      }
    } else {
      // Trường hợp raw MapFile JSON
      mapData = parsed;
    }

    // Validate chặt chẽ bằng Zod Schema
    const parseResult = MapFileSchema.safeParse(mapData);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`MapFile không tuân thủ đặc tả Mục 4: ${errorMsg}`);
    }

    const validatedMap: MapFile = parseResult.data;

    // Lưu atomic vào local MapStore
    await store.saveMap(validatedMap);

    return {
      success: true,
      importedDomain: validatedMap.domain,
      checksumVerified,
      contentRevision: validatedMap.content_revision,
      baseNodesCount: validatedMap.base_nodes.length,
      stateCount: validatedMap.state_graph.length,
      map: validatedMap,
    };
  }
}
