/**
 * Manifest V3 Generator & Permission Calculator (Mục 5.3 & 5.6)
 *
 * Nguyên tắc permission tối thiểu (Mục 5.6):
 * "Nhà máy PHẢI tính chính xác tập quyền cần thiết dựa trên chuỗi action
 * thực tế có trong Tool, KHÔNG được xin quyền rộng hơn phòng khi cần dùng sau."
 */

import type { Action, ToolConfig } from '../map/schema.js';

export interface CalculatedPermissions {
  /** Các quyền API của Chrome Extension */
  permissions: string[];
  /** Host permissions cho domain */
  host_permissions: string[];
  /** Có cần MAIN-world script không */
  hasPatchRuntime: boolean;
}

/**
 * Tính toán tập quyền tối thiểu dựa trên danh sách Action thực tế (Mục 5.6).
 */
export function calculatePermissions(
  domain: string,
  actions: Action[],
): CalculatedPermissions {
  const perms = new Set<string>();
  let hasPatchRuntime = false;

  // Circuit breaker cấp Tool luôn cần storage để lưu fail records trong sliding window (Mục 7.1)
  perms.add('storage');

  for (const action of actions) {
    if (action.type === 'patch_runtime') {
      hasPatchRuntime = true;
    }

    if (action.type === 'deep_scan_local') {
      const scanType = action.params?.['scan_type'] as string | undefined;
      if (scanType === 'cookies') {
        perms.add('cookies');
      }
    }
  }

  // Host permissions: chỉ xin quyền cho domain mục tiêu và subdomain
  // Clean domain (loại bỏ port, protocol nếu có)
  const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  const hostPermissions = [
    `https://${cleanDomain}/*`,
    `https://*.${cleanDomain}/*`,
    `http://${cleanDomain}/*`,
    `http://*.${cleanDomain}/*`,
  ];

  return {
    permissions: Array.from(perms),
    host_permissions: hostPermissions,
    hasPatchRuntime,
  };
}

export interface ManifestV3 {
  manifest_version: 3;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  host_permissions: string[];
  background: {
    service_worker: string;
    type: 'module';
  };
  content_scripts: Array<{
    matches: string[];
    js: string[];
    run_at?: 'document_start' | 'document_end' | 'document_idle';
    world?: 'ISOLATED' | 'MAIN';
  }>;
}

/**
 * Tạo Manifest V3 hoàn chỉnh cho Extension (Mục 5.3).
 */
export function generateManifest(
  toolConfig: ToolConfig,
  actions?: Action[],
): ManifestV3 {
  const effectiveActions = actions ?? toolConfig.actions;
  const { permissions, host_permissions, hasPatchRuntime } = calculatePermissions(
    toolConfig.target_domain,
    effectiveActions,
  );

  const contentScripts: ManifestV3['content_scripts'] = [
    // Script ISOLATED world cho thực thi chính
    {
      matches: host_permissions,
      js: ['circuit-breaker.js', 'content.js'],
      run_at: 'document_idle',
    },
  ];

  // Chỉ thêm MAIN-world script khi có action patch_runtime (Mục 5.3, 5.6)
  // Và BẮT BUỘC chạy ở document_start
  if (hasPatchRuntime) {
    contentScripts.push({
      matches: host_permissions,
      js: ['content-main.js'],
      run_at: 'document_start',
      world: 'MAIN',
    });
  }

  return {
    manifest_version: 3,
    name: toolConfig.name,
    version: '1.0.0',
    description: toolConfig.description || `DevBrowserTool extension for ${toolConfig.target_domain}`,
    permissions,
    host_permissions,
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    content_scripts: contentScripts,
  };
}
