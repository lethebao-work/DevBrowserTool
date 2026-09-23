/**
 * Factory Parameterizer — Tham số hoá input parameters (Mục 5.2 bước 3)
 *
 * Cho phép định nghĩa tham số đầu vào động (dạng {{paramName}})
 * và nội suy (interpolate) giá trị tham số khi chạy.
 */

import type { Action } from '../map/schema.js';

export interface ParamDefinition {
  type: 'string' | 'number' | 'boolean';
  description: string;
  default_value?: unknown;
  required?: boolean;
}

export type ToolInputParams = Record<string, ParamDefinition>;

export class Parameterizer {
  private static readonly PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

  /**
   * Tự động phát hiện các tham số dạng {{param}} trong danh sách actions.
   */
  static extractPlaceholders(actions: Action[]): string[] {
    const placeholders = new Set<string>();

    for (const action of actions) {
      this.scanValueForPlaceholders(action.params, placeholders);
    }

    return Array.from(placeholders);
  }

  private static scanValueForPlaceholders(value: unknown, outSet: Set<string>): void {
    if (typeof value === 'string') {
      let match: RegExpExecArray | null;
      const regex = new RegExp(this.PLACEHOLDER_REGEX);
      while ((match = regex.exec(value)) !== null) {
        outSet.add(match[1]);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        this.scanValueForPlaceholders(item, outSet);
      }
    } else if (value !== null && typeof value === 'object') {
      for (const val of Object.values(value as Record<string, unknown>)) {
        this.scanValueForPlaceholders(val, outSet);
      }
    }
  }

  /**
   * Nội suy (thay thế) các biến {{key}} trong Action params bằng runtime values.
   */
  static interpolateActions(actions: Action[], values: Record<string, unknown>): Action[] {
    return actions.map(action => ({
      ...action,
      params: this.interpolateValue(action.params, values) as Record<string, unknown>,
    }));
  }

  private static interpolateValue(value: unknown, values: Record<string, unknown>): unknown {
    if (typeof value === 'string') {
      return value.replace(this.PLACEHOLDER_REGEX, (match, paramName) => {
        if (paramName in values) {
          const replacement = values[paramName];
          return typeof replacement === 'string' ? replacement : String(replacement);
        }
        return match; // Giữ nguyên nếu chưa cung cấp
      });
    } else if (Array.isArray(value)) {
      return value.map(item => this.interpolateValue(item, values));
    } else if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this.interpolateValue(v, values);
      }
      return result;
    }
    return value;
  }

  /**
   * Tạo bản khai báo input_params tự động từ danh sách placeholder tìm thấy.
   */
  static buildInputParamsConfig(
    placeholders: string[],
    overrides?: Partial<ToolInputParams>
  ): ToolInputParams {
    const result: ToolInputParams = {};

    for (const name of placeholders) {
      if (overrides && overrides[name]) {
        result[name] = overrides[name]!;
      } else {
        result[name] = {
          type: 'string',
          description: `Input parameter for ${name}`,
          required: true,
        };
      }
    }

    return result;
  }

  /**
   * Chuyển đổi sang định dạng mảng input_params cho ToolConfigSchema
   */
  static toInputParamsList(config: ToolInputParams): Array<{
    name: string;
    description: string;
    type: 'string' | 'number' | 'boolean' | 'select';
    required: boolean;
    default_value?: unknown;
  }> {
    return Object.entries(config).map(([name, def]) => ({
      name,
      description: def.description,
      type: def.type,
      required: def.required ?? true,
      default_value: def.default_value,
    }));
  }
}
