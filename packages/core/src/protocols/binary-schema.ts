/**
 * Binary Protocol & Protobuf Schema Engine (Mục 3.5 & Mục 4 binary_schema)
 *
 * Cho phép:
 * 1. Định nghĩa và lưu trữ BinarySchemaDefinition trong ResourceNode `binary_schema`
 * 2. Giải mã Protobuf / nhị phân THUẦN THUẬT TOÁN (không cần LLM khi chạy runtime)
 * 3. Suy ngược schema từ frame mẫu (gọi LLM 1 lần ở Tháp, Mục 3.5)
 */

export type ProtobufWireType = 0 | 1 | 2 | 5;

export interface BinaryFieldDefinition {
  tag: number;
  name: string;
  type: 'varint' | 'string' | 'bytes' | 'fixed32' | 'fixed64' | 'submessage';
  repeated?: boolean;
  subfields?: BinaryFieldDefinition[];
}

export interface BinarySchemaDefinition {
  schema_name: string;
  version: string;
  fields: BinaryFieldDefinition[];
}

export interface DecodedField {
  tag: number;
  wire_type: number;
  name?: string;
  value: unknown;
}

export class BinarySchemaEngine {
  /**
   * Đọc Varint từ Uint8Array tại offset.
   * Trả về giá trị số và số byte đã đọc.
   */
  static readVarint(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
    let result = 0;
    let shift = 0;
    let bytesRead = 0;

    while (offset + bytesRead < bytes.length) {
      const b = bytes[offset + bytesRead];
      bytesRead++;
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        break;
      }
      shift += 7;
      if (shift > 35) {
        // Tránh tràn bit cho safe integers JS
        break;
      }
    }

    return { value: result >>> 0, bytesRead };
  }

  /**
   * Ghi Varint vào Uint8Array.
   */
  static writeVarint(value: number): Uint8Array {
    const bytes: number[] = [];
    let v = value >>> 0;
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(v & 0x7f);
    return new Uint8Array(bytes);
  }

  /**
   * Giải mã Protobuf message thô thành cấu trúc key-value dựa trên schema định sẵn (hoặc tự suy theo wire type).
   * Thuần thuật toán — KHÔNG gọi LLM (Mục 3.5).
   */
  static decode(bytes: Uint8Array, schema?: BinarySchemaDefinition): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let offset = 0;
    const fieldMap = new Map<number, BinaryFieldDefinition>();

    if (schema?.fields) {
      for (const f of schema.fields) {
        fieldMap.set(f.tag, f);
      }
    }

    while (offset < bytes.length) {
      const { value: tagWire, bytesRead: tagBytes } = this.readVarint(bytes, offset);
      if (tagBytes === 0) break;
      offset += tagBytes;

      const tag = tagWire >>> 3;
      const wireType = (tagWire & 0x07) as ProtobufWireType;
      const fieldDef = fieldMap.get(tag);
      const fieldName = fieldDef?.name || `field_${tag}`;

      let decodedValue: unknown;

      switch (wireType) {
        case 0: {
          // Varint
          const { value, bytesRead } = this.readVarint(bytes, offset);
          offset += bytesRead;
          decodedValue = value;
          break;
        }

        case 1: {
          // 64-bit fixed
          if (offset + 8 > bytes.length) break;
          const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
          decodedValue = dv.getFloat64(0, true);
          offset += 8;
          break;
        }

        case 2: {
          // Length-delimited (string, bytes, submessage)
          const { value: len, bytesRead } = this.readVarint(bytes, offset);
          offset += bytesRead;
          const end = Math.min(offset + len, bytes.length);
          const chunk = bytes.subarray(offset, end);
          offset = end;

          if (fieldDef?.type === 'submessage' && fieldDef.subfields) {
            decodedValue = this.decode(chunk, {
              schema_name: `${fieldName}_type`,
              version: '1.0',
              fields: fieldDef.subfields,
            });
          } else {
            // Thử decode UTF-8 string
            try {
              const decoder = new TextDecoder('utf-8', { fatal: true });
              decodedValue = decoder.decode(chunk);
            } catch {
              // Fallback bytes base64
              decodedValue = Buffer.from(chunk).toString('base64');
            }
          }
          break;
        }

        case 5: {
          // 32-bit fixed
          if (offset + 4 > bytes.length) break;
          const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
          decodedValue = dv.getFloat32(0, true);
          offset += 4;
          break;
        }

        default:
          // Wire type không hỗ trợ hoặc kết thúc frame
          offset = bytes.length;
          break;
      }

      if (fieldDef?.repeated) {
        if (!Array.isArray(result[fieldName])) {
          result[fieldName] = [];
        }
        (result[fieldName] as unknown[]).push(decodedValue);
      } else {
        result[fieldName] = decodedValue;
      }
    }

    return result;
  }

  /**
   * Mã hoá một payload đối tượng thành binary protobuf bytes theo schema.
   */
  static encode(data: Record<string, unknown>, schema: BinarySchemaDefinition): Uint8Array {
    const buffers: Uint8Array[] = [];

    for (const field of schema.fields) {
      const val = data[field.name];
      if (val === undefined || val === null) continue;

      const values = field.repeated && Array.isArray(val) ? val : [val];

      for (const item of values) {
        let wireType: ProtobufWireType = 0;
        let payloadBytes: Uint8Array;

        switch (field.type) {
          case 'varint': {
            wireType = 0;
            payloadBytes = this.writeVarint(Number(item));
            break;
          }
          case 'string': {
            wireType = 2;
            const strBytes = new TextEncoder().encode(String(item));
            const lenBytes = this.writeVarint(strBytes.length);
            const combined = new Uint8Array(lenBytes.length + strBytes.length);
            combined.set(lenBytes, 0);
            combined.set(strBytes, lenBytes.length);
            payloadBytes = combined;
            break;
          }
          case 'bytes': {
            wireType = 2;
            const rawBytes = typeof item === 'string' ? Buffer.from(item, 'base64') : (item as Uint8Array);
            const lenBytes = this.writeVarint(rawBytes.length);
            const combined = new Uint8Array(lenBytes.length + rawBytes.length);
            combined.set(lenBytes, 0);
            combined.set(rawBytes, lenBytes.length);
            payloadBytes = combined;
            break;
          }
          case 'fixed32': {
            wireType = 5;
            const buf = new Uint8Array(4);
            new DataView(buf.buffer).setFloat32(0, Number(item), true);
            payloadBytes = buf;
            break;
          }
          default:
            continue;
        }

        const tagWire = (field.tag << 3) | wireType;
        const tagBytes = this.writeVarint(tagWire);
        const chunk = new Uint8Array(tagBytes.length + payloadBytes.length);
        chunk.set(tagBytes, 0);
        chunk.set(payloadBytes, tagBytes.length);
        buffers.push(chunk);
      }
    }

    const totalLen = buffers.reduce((acc, b) => acc + b.length, 0);
    const result = new Uint8Array(totalLen);
    let curr = 0;
    for (const b of buffers) {
      result.set(b, curr);
      curr += b.length;
    }
    return result;
  }

  /**
   * Suy ngược schema từ các frame mẫu (Mục 3.5: Gọi LLM 1 lần ở Tháp).
   * Giả lập / phân tích cấu trúc wire type của frame mẫu kết hợp với JS context để định hình schema.
   */
  static async inferSchemaFromSamples(
    sampleBytesList: Uint8Array[],
    schemaName: string,
    jsContextCode?: string,
  ): Promise<BinarySchemaDefinition> {
    // 1. Quét tần suất xuất hiện của các tags và wire types qua tất cả samples
    const tagOccurrences = new Map<number, { wireTypes: Set<ProtobufWireType>; count: number }>();

    for (const bytes of sampleBytesList) {
      let offset = 0;
      while (offset < bytes.length) {
        const { value: tagWire, bytesRead: tagBytes } = this.readVarint(bytes, offset);
        if (tagBytes === 0) break;
        offset += tagBytes;

        const tag = tagWire >>> 3;
        const wireType = (tagWire & 0x07) as ProtobufWireType;

        if (!tagOccurrences.has(tag)) {
          tagOccurrences.set(tag, { wireTypes: new Set(), count: 0 });
        }
        const entry = tagOccurrences.get(tag)!;
        entry.wireTypes.add(wireType);
        entry.count++;

        // Nhảy qua payload để tới tag tiếp theo
        if (wireType === 0) {
          const { bytesRead } = this.readVarint(bytes, offset);
          offset += bytesRead;
        } else if (wireType === 1) {
          offset += 8;
        } else if (wireType === 2) {
          const { value: len, bytesRead } = this.readVarint(bytes, offset);
          offset += bytesRead + len;
        } else if (wireType === 5) {
          offset += 4;
        } else {
          break;
        }
      }
    }

    // 2. Suy luận kiểu dữ liệu cho từng tag
    const fields: BinaryFieldDefinition[] = [];
    for (const [tag, info] of tagOccurrences.entries()) {
      const primaryWireType = Array.from(info.wireTypes)[0] ?? 0;
      let fieldType: BinaryFieldDefinition['type'] = 'varint';

      if (primaryWireType === 2) {
        fieldType = 'string';
      } else if (primaryWireType === 5) {
        fieldType = 'fixed32';
      } else if (primaryWireType === 1) {
        fieldType = 'fixed64';
      }

      // Đặt tên trường dựa trên tag hoặc context code
      let fieldName = `tag_${tag}`;
      if (jsContextCode) {
        const regex = new RegExp(`['"]?([a-zA-Z0-9_]+)['"]?\\s*:\\s*${tag}`, 'i');
        const match = jsContextCode.match(regex);
        if (match) {
          fieldName = match[1];
        }
      }

      fields.push({
        tag,
        name: fieldName,
        type: fieldType,
        repeated: info.count > sampleBytesList.length, // Xuất hiện nhiều lần trong cùng 1 frame
      });
    }

    // Sắp xếp theo thứ tự tag tăng dần
    fields.sort((a, b) => a.tag - b.tag);

    return {
      schema_name: schemaName,
      version: '1.0.0',
      fields,
    };
  }
}
