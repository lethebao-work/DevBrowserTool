/**
 * Tool Registry — Quản lý Siêu dữ liệu & Vòng đời Tool (Mục 10 Lớp 3)
 *
 * Nhiệm vụ:
 * 1. Lưu trữ danh mục các Tool đã biên dịch (Metadata & Config) vào file cục bộ (tools.json).
 * 2. Theo dõi độ lệch phiên bản (Drift Detection): so sánh map_content_revision lúc build
 *    với content_revision hiện tại trong MapStore.
 * 3. Tích hợp tín hiệu Circuit Breaker từ Runtime để cảnh báo tool bị ngắt.
 * 4. Hỗ trợ kích hoạt Nhà máy build lại (Rebuild Tool) 1-click từ Map mới nhất.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ToolConfig, MapFile, StructuredLogEntry } from '../map/schema.js';
import { MAP_CONSTANTS } from '../map/schema.js';

export type ToolStatus = 'healthy' | 'drift_detected' | 'circuit_broken' | 'stale';

export interface RegisteredTool {
  id: string;
  name: string;
  description: string;
  target_domain: string;
  package_type: ToolConfig['package_type'];
  built_at: number;
  map_schema_version: string;
  map_content_revision: number;
  last_executed?: number;
  execution_count: number;
  recent_errors: StructuredLogEntry[];
  circuit_breaker_tripped: boolean;
  status: ToolStatus;
  config: ToolConfig;
}

export interface ToolHealthStatus {
  id: string;
  status: ToolStatus;
  has_drift: boolean;
  built_revision: number;
  current_map_revision: number;
  circuit_breaker_active: boolean;
  recent_error_count: number;
}

export class ToolRegistry {
  private readonly registryFilePath: string;
  private tools: Map<string, RegisteredTool> = new Map();

  constructor(storageDir: string) {
    this.registryFilePath = join(storageDir, 'tools.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.registryFilePath)) {
      this.tools = new Map();
      return;
    }

    try {
      const raw = readFileSync(this.registryFilePath, 'utf-8');
      const list: RegisteredTool[] = JSON.parse(raw);
      this.tools = new Map(list.map(t => [t.id, t]));
    } catch {
      this.tools = new Map();
    }
  }

  private save(): void {
    const dir = dirname(this.registryFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const list = Array.from(this.tools.values());
    writeFileSync(this.registryFilePath, JSON.stringify(list, null, 2), 'utf-8');
  }

  /**
   * Đăng ký hoặc cập nhật một Tool vào Registry (Mục 10 lớp 3).
   */
  registerTool(config: ToolConfig): RegisteredTool {
    const id = `${config.target_domain}_${config.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
    const existing = this.tools.get(id);

    const tool: RegisteredTool = {
      id,
      name: config.name,
      description: config.description,
      target_domain: config.target_domain,
      package_type: config.package_type,
      built_at: config.built_at || Date.now(),
      map_schema_version: config.map_schema_version,
      map_content_revision: config.map_content_revision,
      last_executed: existing?.last_executed,
      execution_count: existing?.execution_count ?? 0,
      recent_errors: existing?.recent_errors ?? [],
      circuit_breaker_tripped: false,
      status: 'healthy',
      config,
    };

    this.tools.set(id, tool);
    this.save();
    return tool;
  }

  /**
   * Lấy danh sách tất cả các Tool trong hệ thống.
   */
  listTools(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Lấy chi tiết một Tool theo ID.
   */
  getTool(id: string): RegisteredTool | null {
    return this.tools.get(id) || null;
  }

  /**
   * Xóa một Tool khỏi Registry.
   */
  deleteTool(id: string): boolean {
    const existed = this.tools.delete(id);
    if (existed) {
      this.save();
    }
    return existed;
  }

  /**
   * Ghi nhận một lần thực thi Tool (Mục 7 & Mục 10).
   */
  recordExecution(id: string, success: boolean, logEntry?: StructuredLogEntry): void {
    const tool = this.tools.get(id);
    if (!tool) return;

    tool.execution_count++;
    tool.last_executed = Date.now();

    if (!success && logEntry) {
      tool.recent_errors.unshift(logEntry);
      // Giới hạn tối đa 20 lỗi gần nhất
      if (tool.recent_errors.length > 20) {
        tool.recent_errors = tool.recent_errors.slice(0, 20);
      }

      // Đếm số lỗi trong cửa sổ 10 phút để kích hoạt Circuit Breaker
      const windowStart = Date.now() - MAP_CONSTANTS.CIRCUIT_BREAKER_WINDOW_MS;
      const recentFails = tool.recent_errors.filter(e => e.timestamp >= windowStart).length;

      if (recentFails >= MAP_CONSTANTS.CIRCUIT_BREAKER_MAX_FAILS) {
        tool.circuit_breaker_tripped = true;
        tool.status = 'circuit_broken';
      }
    } else if (success) {
      // Nếu thành công và không bị drift/circuit-breaker
      if (tool.status === 'circuit_broken') {
        tool.circuit_breaker_tripped = false;
        tool.status = 'healthy';
      }
    }

    this.save();
  }

  /**
   * Kiểm tra sức khoẻ và phát hiện độ lệch (Drift Detection) của Tool so với Map hiện tại (Mục 10).
   */
  checkToolHealth(id: string, currentMap: MapFile): ToolHealthStatus {
    const tool = this.tools.get(id);
    if (!tool) {
      throw new Error(`Tool not found: ${id}`);
    }

    const hasDrift = currentMap.content_revision > tool.map_content_revision;
    let status: ToolStatus = 'healthy';

    if (tool.circuit_breaker_tripped) {
      status = 'circuit_broken';
    } else if (hasDrift) {
      status = 'drift_detected';
    } else {
      status = 'healthy';
    }

    tool.status = status;
    this.save();

    return {
      id,
      status,
      has_drift: hasDrift,
      built_revision: tool.map_content_revision,
      current_map_revision: currentMap.content_revision,
      circuit_breaker_active: tool.circuit_breaker_tripped,
      recent_error_count: tool.recent_errors.length,
    };
  }

  /**
   * Cập nhật Tool sau khi Nhà máy biên dịch lại (Rebuild) (Mục 5.4 & 10 lớp 3).
   * Xóa cờ circuit breaker và đặt lại revision mới nhất.
   */
  updateAfterRebuild(id: string, newConfig: ToolConfig): RegisteredTool {
    const tool = this.tools.get(id);
    if (!tool) {
      return this.registerTool(newConfig);
    }

    tool.config = newConfig;
    tool.built_at = newConfig.built_at;
    tool.map_schema_version = newConfig.map_schema_version;
    tool.map_content_revision = newConfig.map_content_revision;
    tool.circuit_breaker_tripped = false;
    tool.recent_errors = []; // Xóa lịch sử lỗi của bản cũ
    tool.status = 'healthy';

    this.save();
    return tool;
  }
}
