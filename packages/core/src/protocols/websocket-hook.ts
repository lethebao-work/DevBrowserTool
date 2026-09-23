/**
 * WebSocket Hook & Real-time Channel Manager (Mục 3.1, 3.4, 3.5)
 *
 * Cho phép:
 * 1. Hook window.WebSocket an toàn qua cơ chế namespace chung (Mục 6.2)
 * 2. Giám sát incoming/outgoing frames (Text & Binary ArrayBuffer)
 * 3. Lọc message theo kênh/URL phục vụ thu thập state thời gian thực
 */

import type { BrowserAdapter } from '../actions/primitives.js';

export interface WebSocketFrame {
  id: string;
  socket_url: string;
  direction: 'sent' | 'received';
  type: 'text' | 'binary';
  data_text?: string;
  data_binary_base64?: string;
  byte_length: number;
  timestamp: number;
}

export interface WebSocketChannelStatus {
  url: string;
  ready_state: number; // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED
  messages_count: number;
  last_activity: number;
}

export class WebSocketHookManager {
  /**
   * Cài đặt hook vào window.WebSocket trong browser context.
   * Dùng namespace `window.__devBrowserTool_ws__` để lưu trữ frame buffers.
   */
  static async installHook(browser: BrowserAdapter): Promise<{ success: boolean; message: string }> {
    return await browser.evaluate<{ success: boolean; message: string }>(`
      (() => {
        try {
          if (window.__devBrowserTool_ws__) {
            return { success: true, message: 'WebSocket hook already installed.' };
          }

          const state = {
            sockets: new Map(),
            frames: [],
            max_frames: 200,
          };
          window.__devBrowserTool_ws__ = state;

          const OriginalWebSocket = window.WebSocket;
          if (!OriginalWebSocket) {
            return { success: false, message: 'window.WebSocket not available in this page context.' };
          }

          function WrappedWebSocket(url, protocols) {
            const ws = protocols !== undefined ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
            const socketUrl = typeof url === 'string' ? url : (url.href || String(url));
            const socketInfo = { url: socketUrl, instance: ws, ready_state: ws.readyState };
            state.sockets.set(ws, socketInfo);

            function recordFrame(direction, eventData) {
              const now = Date.now();
              const frameId = 'ws_' + now + '_' + Math.random().toString(36).substring(2, 7);
              
              if (typeof eventData === 'string') {
                state.frames.push({
                  id: frameId,
                  socket_url: socketUrl,
                  direction,
                  type: 'text',
                  data_text: eventData,
                  byte_length: eventData.length,
                  timestamp: now,
                });
              } else if (eventData instanceof ArrayBuffer || ArrayBuffer.isView(eventData)) {
                const u8 = eventData instanceof ArrayBuffer ? new Uint8Array(eventData) : new Uint8Array(eventData.buffer);
                let binaryStr = '';
                const len = Math.min(u8.length, 5000); // Giới hạn kích thước snapshot
                for (let i = 0; i < len; i++) {
                  binaryStr += String.fromCharCode(u8[i]);
                }
                const b64 = btoa(binaryStr);
                state.frames.push({
                  id: frameId,
                  socket_url: socketUrl,
                  direction,
                  type: 'binary',
                  data_binary_base64: b64,
                  byte_length: u8.byteLength,
                  timestamp: now,
                });
              }

              if (state.frames.length > state.max_frames) {
                state.frames.shift();
              }
            }

            // Hook incoming messages
            ws.addEventListener('message', (event) => {
              recordFrame('received', event.data);
            });

            // Hook outgoing send
            const originalSend = ws.send.bind(ws);
            ws.send = function(data) {
              recordFrame('sent', data);
              try {
                if (ws.readyState === OriginalWebSocket.OPEN) {
                  return originalSend(data);
                }
              } catch {
                // Nuốt lỗi send khi socket đang mock hoặc chưa kịp open
              }
            };

            return ws;
          }

          // Kế thừa prototype và hằng số
          WrappedWebSocket.prototype = OriginalWebSocket.prototype;
          WrappedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
          WrappedWebSocket.OPEN = OriginalWebSocket.OPEN;
          WrappedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
          WrappedWebSocket.CLOSED = OriginalWebSocket.CLOSED;

          window.WebSocket = WrappedWebSocket;

          return { success: true, message: 'WebSocket hook installed successfully.' };
        } catch (err) {
          return { success: false, message: err instanceof Error ? err.message : String(err) };
        }
      })()
    `);
  }

  /**
   * Lấy danh sách các WebSocket frames đã ghi nhận được.
   */
  static async getFrames(
    browser: BrowserAdapter,
    filter?: { socket_url?: string; direction?: 'sent' | 'received'; type?: 'text' | 'binary' },
  ): Promise<WebSocketFrame[]> {
    const rawFrames = await browser.evaluate<WebSocketFrame[]>(`
      (() => {
        if (!window.__devBrowserTool_ws__) return [];
        return window.__devBrowserTool_ws__.frames;
      })()
    `);

    if (!Array.isArray(rawFrames)) return [];

    return rawFrames.filter(frame => {
      if (filter?.socket_url && !frame.socket_url.includes(filter.socket_url)) return false;
      if (filter?.direction && frame.direction !== filter.direction) return false;
      if (filter?.type && frame.type !== filter.type) return false;
      return true;
    });
  }

  /**
   * Lấy danh sách active websocket connections.
   */
  static async getActiveChannels(browser: BrowserAdapter): Promise<WebSocketChannelStatus[]> {
    return await browser.evaluate<WebSocketChannelStatus[]>(`
      (() => {
        if (!window.__devBrowserTool_ws__) return [];
        const result = [];
        for (const [ws, info] of window.__devBrowserTool_ws__.sockets.entries()) {
          result.push({
            url: info.url,
            ready_state: ws.readyState,
            messages_count: window.__devBrowserTool_ws__.frames.filter(f => f.socket_url === info.url).length,
            last_activity: Date.now(),
          });
        }
        return result;
      })()
    `);
  }
}
