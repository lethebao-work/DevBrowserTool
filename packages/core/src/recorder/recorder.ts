/**
 * Demo Recorder Controller (Mục 3.2)
 *
 * Điều phối phiên ghi demo người dùng trên tab trình duyệt:
 * - Hiển thị tín hiệu "chế độ ghi" rõ ràng (viền đỏ/cam + banner cảnh báo, Mục 3.2)
 * - Khoá tab (lockTab) tránh race condition giữa agent và người dùng (Mục 3.2)
 * - Mở khoá tab (unlockTab) khi xin demo
 * - Thu thập sự kiện click, fill, navigate
 * - Cơ chế xin xác nhận hành động phi-UI (call_api, patch_runtime, Mục 3.2)
 */

import { randomUUID } from 'node:crypto';
import type { BrowserAdapter } from '../actions/primitives.js';
import { extractResourceNodesFromEvents } from './extractor.js';
import type {
  ExtractedDemoResult,
  NonUiActionRequest,
  RecordedEvent,
  RecordingSession,
  RrwebEvent,
  SessionReplayExport,
} from './types.js';

export class DemoRecorder {
  private readonly browser: BrowserAdapter;
  private currentSession: RecordingSession | null = null;
  private nonUiRequests: NonUiActionRequest[] = [];

  constructor(browser: BrowserAdapter) {
    this.browser = browser;
  }

  /**
   * Bắt đầu phiên ghi demo.
   * Hiển thị banner và viền đổi màu trên tab (Mục 3.2).
   * Tự động khởi tạo bộ thu nhận rrweb (DOM mutation & interaction stream) (Mục 1.8).
   */
  async startRecording(
    domain: string,
    options: { enableRrweb?: boolean } = { enableRrweb: true },
  ): Promise<RecordingSession> {
    const sessionId = randomUUID();
    const session: RecordingSession = {
      sessionId,
      domain,
      startedAt: Date.now(),
      stoppedAt: null,
      status: 'recording',
      events: [],
      rrwebEvents: [],
    };

    this.currentSession = session;
    const enableRrweb = options.enableRrweb ?? true;

    // Inject listener script và visual indicator vào trang web
    await this.browser.evaluate(`
      (() => {
        window.__DBT_RECORDED_EVENTS__ = [];
        window.__DBT_RRWEB_EVENTS__ = [];
        window.__DBT_RECORDING_ACTIVE__ = true;
        const enableRrweb = ${enableRrweb};

        // 1. Tín hiệu "chế độ ghi" rõ ràng (Mục 3.2)
        let indicator = document.getElementById('__dbt_recording_indicator__');
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.id = '__dbt_recording_indicator__';
          indicator.style.cssText = \`
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 36px;
            background: linear-gradient(90deg, #ff4757, #ff6b81);
            color: white;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2147483647;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            pointer-events: none;
          \`;
          indicator.innerHTML = '🔴 DevBrowserTool — Đang trong Chế độ Ghi Demo (Vui lòng thực hiện thao tác mẫu)';
          document.body.appendChild(indicator);

          // Đổi màu viền trang web
          document.documentElement.style.outline = '4px solid #ff4757';
          document.documentElement.style.outlineOffset = '-4px';
        }

        // 2. Helper trích xuất thông tin phần tử
        function getElementSnapshot(el) {
          if (!el || el === document || el === document.body) return null;
          
          let selector = el.tagName.toLowerCase();
          if (el.id) {
            selector = '#' + el.id;
          } else if (el.className && typeof el.className === 'string') {
            selector = el.tagName.toLowerCase() + '.' + el.className.trim().split(/\\s+/)[0];
          }

          return {
            tagName: el.tagName,
            id: el.id || null,
            className: typeof el.className === 'string' ? el.className : null,
            role: el.getAttribute('role') || el.tagName.toLowerCase(),
            ariaLabel: el.getAttribute('aria-label') || null,
            textContent: (el.textContent || '').trim().slice(0, 100) || null,
            placeholder: el.getAttribute('placeholder') || null,
            name: el.getAttribute('name') || null,
            inputType: el.getAttribute('type') || null,
            selector,
          };
        }

        // 3. Khởi tạo rrweb stream nếu được bật (Mục 1.8)
        if (enableRrweb) {
          // Meta Event (Type 4)
          window.__DBT_RRWEB_EVENTS__.push({
            type: 4,
            data: {
              href: window.location.href,
              width: window.innerWidth,
              height: window.innerHeight,
            },
            timestamp: Date.now(),
          });

          // FullSnapshot Event (Type 2)
          window.__DBT_RRWEB_EVENTS__.push({
            type: 2,
            data: {
              node: {
                tagName: 'html',
                childNodesCount: document.body ? document.body.children.length : 0,
                title: document.title,
              },
              initialOffset: {
                top: window.scrollY,
                left: window.scrollX,
              },
            },
            timestamp: Date.now(),
          });

          // MutationObserver theo dõi DOM mutations (Type 3 - IncrementalSnapshot)
          if (window.MutationObserver) {
            window.__dbt_mutationObserver__ = new MutationObserver((mutations) => {
              if (!window.__DBT_RECORDING_ACTIVE__) return;
              const mutationData = mutations.slice(0, 20).map((m) => ({
                type: m.type,
                targetSelector: m.target?.nodeType === 1 ? (m.target.id ? '#' + m.target.id : m.target.nodeName) : null,
                addedNodesCount: m.addedNodes?.length || 0,
                removedNodesCount: m.removedNodes?.length || 0,
                attributeName: m.attributeName || null,
              }));

              window.__DBT_RRWEB_EVENTS__.push({
                type: 3,
                data: {
                  source: 0, // Mutation
                  mutations: mutationData,
                },
                timestamp: Date.now(),
              });
            });

            window.__dbt_mutationObserver__.observe(document.body || document.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });
          }
        }

        // 4. Listener bắt sự kiện Click
        window.__dbt_clickHandler__ = (e) => {
          if (!window.__DBT_RECORDING_ACTIVE__) return;
          const target = e.target;
          if (target?.id === '__dbt_recording_indicator__' || target?.id === '__dbt_tab_lock__') return;

          const snapshot = getElementSnapshot(target);
          if (snapshot) {
            window.__DBT_RECORDED_EVENTS__.push({
              id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              type: 'click',
              timestamp: Date.now(),
              target: snapshot,
            });

            if (enableRrweb) {
              window.__DBT_RRWEB_EVENTS__.push({
                type: 3,
                data: {
                  source: 2, // MouseInteraction
                  type: 2,   // Click
                  x: e.clientX,
                  y: e.clientY,
                  targetSelector: snapshot.selector,
                },
                timestamp: Date.now(),
              });
            }
          }
        };
        window.addEventListener('click', window.__dbt_clickHandler__, true);

        // 5. Listener bắt sự kiện Fill / Input
        window.__dbt_inputHandler__ = (e) => {
          if (!window.__DBT_RECORDING_ACTIVE__) return;
          const target = e.target;
          if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return;

          const snapshot = getElementSnapshot(target);
          if (snapshot) {
            window.__DBT_RECORDED_EVENTS__.push({
              id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              type: 'fill',
              timestamp: Date.now(),
              target: snapshot,
              value: target.value,
            });

            if (enableRrweb) {
              window.__DBT_RRWEB_EVENTS__.push({
                type: 3,
                data: {
                  source: 5, // Input
                  text: target.value,
                  targetSelector: snapshot.selector,
                },
                timestamp: Date.now(),
              });
            }
          }
        };
        window.addEventListener('change', window.__dbt_inputHandler__, true);
      })()
    `);

    return session;
  }

  /**
   * Khoá tab — ngăn người dùng thao tác ngoài lúc được yêu cầu (Mục 3.2).
   */
  async lockTab(): Promise<void> {
    if (this.currentSession) {
      this.currentSession.status = 'locked';
    }

    await this.browser.evaluate(`
      (() => {
        let lock = document.getElementById('__dbt_tab_lock__');
        if (!lock) {
          lock = document.createElement('div');
          lock.id = '__dbt_tab_lock__';
          lock.style.cssText = \`
            position: fixed;
            top: 36px;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.15);
            backdrop-filter: blur(1px);
            z-index: 2147483646;
            cursor: not-allowed;
            display: flex;
            align-items: center;
            justify-content: center;
          \`;
          const badge = document.createElement('div');
          badge.style.cssText = \`
            background: rgba(30, 30, 30, 0.85);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            font-family: sans-serif;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          \`;
          badge.innerText = '🔒 Tab đã bị khoá để tránh xung đột thao tác với AI Agent';
          lock.appendChild(badge);
          document.body.appendChild(lock);
        }
      })()
    `);
  }

  /**
   * Mở khoá tab — cho phép người dùng thao tác demo (Mục 3.2).
   */
  async unlockTab(): Promise<void> {
    if (this.currentSession && this.currentSession.status === 'locked') {
      this.currentSession.status = 'recording';
    }

    await this.browser.evaluate(`
      (() => {
        const lock = document.getElementById('__dbt_tab_lock__');
        if (lock) lock.remove();
      })()
    `);
  }

  /**
   * Dừng phiên ghi demo và thu thập toàn bộ các sự kiện đã ghi cùng rrweb event stream.
   */
  async stopRecording(): Promise<RecordingSession> {
    if (!this.currentSession) {
      throw new Error('No active recording session.');
    }

    // Đọc sự kiện và rrweb events từ trang
    const dump = await this.browser.evaluate<{
      events: RecordedEvent[];
      rrwebEvents: RrwebEvent[];
    }>(`
      (() => {
        window.__DBT_RECORDING_ACTIVE__ = false;

        // Dọn dẹp indicator và lock
        const indicator = document.getElementById('__dbt_recording_indicator__');
        if (indicator) indicator.remove();
        const lock = document.getElementById('__dbt_tab_lock__');
        if (lock) lock.remove();
        document.documentElement.style.outline = '';

        // Dừng MutationObserver
        if (window.__dbt_mutationObserver__) {
          window.__dbt_mutationObserver__.disconnect();
          delete window.__dbt_mutationObserver__;
        }

        // Gỡ listeners
        if (window.__dbt_clickHandler__) {
          window.removeEventListener('click', window.__dbt_clickHandler__, true);
        }
        if (window.__dbt_inputHandler__) {
          window.removeEventListener('change', window.__dbt_inputHandler__, true);
        }

        return {
          events: window.__DBT_RECORDED_EVENTS__ || [],
          rrwebEvents: window.__DBT_RRWEB_EVENTS__ || [],
        };
      })()
    `);

    this.currentSession.events = dump?.events || [];
    this.currentSession.rrwebEvents = dump?.rrwebEvents || [];
    this.currentSession.stoppedAt = Date.now();
    this.currentSession.status = 'stopped';

    const result = { ...this.currentSession };
    this.currentSession = null;
    return result;
  }

  /**
   * Xuất session replay ở định dạng chuẩn phục vụ replay visual & debug (Mục 1.8).
   */
  exportSessionReplay(session: RecordingSession): SessionReplayExport {
    return {
      sessionId: session.sessionId,
      domain: session.domain,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
      eventsCount: session.events.length,
      rrwebEventsCount: session.rrwebEvents?.length || 0,
      events: session.events,
      rrwebEvents: session.rrwebEvents || [],
    };
  }

  /**
   * Xin xác nhận cho hành động phi-UI (call_api, patch_runtime, Mục 3.2).
   * Hiển thị thông số chi tiết để người dùng xem và bấm xác nhận/từ chối.
   */
  async requestNonUiActionApproval(
    actionType: 'call_api' | 'patch_runtime',
    details: NonUiActionRequest['details'],
  ): Promise<boolean> {
    const requestId = randomUUID();
    const req: NonUiActionRequest = {
      id: requestId,
      actionType,
      details,
      timestamp: Date.now(),
      status: 'pending',
    };

    this.nonUiRequests.push(req);

    // Hiển thị modal xác nhận trong browser context (Mục 3.2)
    const approved = await this.browser.evaluate<boolean>(`
      (() => {
        const detailsJson = ${JSON.stringify(JSON.stringify(details, null, 2))};
        const action = ${JSON.stringify(actionType)};
        return window.confirm(
          '[DevBrowserTool] Xác nhận hành động phi-UI (' + action + '):\\n\\n' + detailsJson + '\\n\\nBạn có đồng ý cho phép thực thi không?'
        );
      })()
    `);

    req.status = approved ? 'approved' : 'rejected';
    return approved;
  }

  /**
   * Chuyển đổi các sự kiện đã ghi thành ResourceNode và Variants (Mục 3.3).
   */
  extractMapNodes(session: RecordingSession): ExtractedDemoResult {
    return extractResourceNodesFromEvents(session.events);
  }

  /** Lấy phiên ghi hiện tại */
  getCurrentSession(): RecordingSession | null {
    return this.currentSession;
  }
}

