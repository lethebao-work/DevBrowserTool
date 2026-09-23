/**
 * Chrome Extension Packager (Mục 5.3 & 0.8)
 *
 * Chịu trách nhiệm đóng gói Tool thành Chrome Extension (Manifest V3) hoàn chỉnh:
 * 1. Trích xuất snapshot Map gọn gàng (chỉ các node có trong actions)
 * 2. Tính toán permission tối thiểu (Mục 5.6)
 * 3. Sinh manifest.json chuẩn MV3
 * 4. Sinh circuit-breaker.js tách riêng (Mục 7.1)
 * 5. Sinh background.js service worker
 * 6. Sinh content.js (ISOLATED world) nhúng map_snapshot + actions + engine
 * 7. Sinh content-main.js (MAIN world, document_start) CHỈ KHI có patch_runtime
 * 8. Ghi ra thư mục đích để có thể Load Unpacked trực tiếp vào Chrome
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Action, MapFile, ToolConfig } from '../map/schema.js';
import { generateManifest, calculatePermissions, type ManifestV3 } from './manifest.js';
import {
  getCircuitBreakerTemplate,
  getBackgroundTemplate,
  getMainWorldTemplate,
  generateContentScript,
  getExtensionReadme,
} from './templates.js';

export interface PackagingOptions {
  /** Cấu hình Tool đã biên dịch */
  toolConfig: ToolConfig;
  /** Danh sách chuỗi Action cụ thể */
  actions: Action[];
  /** MapFile gốc để trích xuất snapshot */
  mapFile: MapFile;
  /** Thư mục đích để ghi extension files */
  outputDir: string;
}

export interface PackagingResult {
  /** Thành công hay thất bại */
  success: boolean;
  /** Thư mục chứa extension đã đóng gói */
  outputDir: string;
  /** Danh sách file đã được sinh ra */
  generatedFiles: string[];
  /** Manifest V3 đã sinh */
  manifest: ManifestV3;
  /** Các quyền đã khai báo */
  permissions: string[];
  /** Có bao gồm MAIN-world script không */
  hasPatchRuntime: boolean;
}

export class ExtensionPackager {
  /**
   * Đóng gói Tool thành Chrome Extension (MV3).
   */
  static package(options: PackagingOptions): PackagingResult {
    const { toolConfig, actions, mapFile, outputDir } = options;

    // 1. Tạo thư mục đích nếu chưa có
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // 2. Trích xuất map snapshot gọn nhẹ (chỉ giữ lại các node có trong actions)
    const referencedNodeIds = new Set(
      actions.map((a) => a.node_ref).filter((id): id is string => Boolean(id))
    );

    const relevantBaseNodes = mapFile.base_nodes.filter((node) =>
      referencedNodeIds.has(node.id)
    );

    const mapSnapshot: Partial<MapFile> = {
      schema_version: mapFile.schema_version,
      content_revision: mapFile.content_revision,
      domain: mapFile.domain,
      base_nodes: relevantBaseNodes,
    };

    // 3. Tính toán permission và sinh manifest.json
    const manifest = generateManifest(toolConfig, actions);
    const { hasPatchRuntime } = calculatePermissions(toolConfig.target_domain, actions);

    const generatedFiles: string[] = [];

    // Ghi manifest.json
    const manifestPath = join(outputDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    generatedFiles.push(manifestPath);

    // Ghi circuit-breaker.js (Mục 7.1)
    const cbPath = join(outputDir, 'circuit-breaker.js');
    writeFileSync(cbPath, getCircuitBreakerTemplate(toolConfig.target_domain), 'utf-8');
    generatedFiles.push(cbPath);

    // Ghi background.js
    const bgPath = join(outputDir, 'background.js');
    writeFileSync(bgPath, getBackgroundTemplate(), 'utf-8');
    generatedFiles.push(bgPath);

    // Ghi content.js (ISOLATED world)
    const contentPath = join(outputDir, 'content.js');
    writeFileSync(
      contentPath,
      generateContentScript(toolConfig, actions, mapSnapshot),
      'utf-8'
    );
    generatedFiles.push(contentPath);

    // Ghi content-main.js (MAIN world lúc document_start) CHỈ KHI có patch_runtime
    if (hasPatchRuntime) {
      const mainPath = join(outputDir, 'content-main.js');
      writeFileSync(mainPath, getMainWorldTemplate(), 'utf-8');
      generatedFiles.push(mainPath);
    }

    // Ghi README.md hướng dẫn cài đặt vào Chrome
    const readmePath = join(outputDir, 'README.md');
    writeFileSync(readmePath, getExtensionReadme(toolConfig), 'utf-8');
    generatedFiles.push(readmePath);

    return {
      success: true,
      outputDir,
      generatedFiles,
      manifest,
      permissions: manifest.permissions,
      hasPatchRuntime,
    };
  }
}
