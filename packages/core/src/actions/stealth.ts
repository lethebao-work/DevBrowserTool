/**
 * Anti-Detection Nhóm 1 Nâng Cao — Stealth Actions (Mục 8.1 & Mục 3.7)
 *
 * Nhiệm vụ:
 * 1. Giảm thiểu các dấu hiệu hành vi máy móc thông thường (robotic automation signatures).
 * 2. Sinh quỹ đạo chuột cong tự nhiên theo đường cong Bézier bậc 3 (Humanized Bézier Mouse Trajectory).
 * 3. Mô phỏng nhịp gõ phím sinh học theo phân phối Log-normal (Human Typing Cadence).
 * 4. Cuộn trang có quán tính (Inertial Smooth Scrolling) với gia tốc/giảm tốc và vi rung tự nhiên.
 * 5. Điều chỉnh độ trễ ngẫu nhiên (Gaussian Jitter) tỷ lệ thuận với importance_score của website.
 *
 * RANH GIỚI TUYỆT ĐỐI (Mục 2 nguyên tắc 3, Mục 8.1, Mục 8.2):
 * - CHỈ hỗ trợ Nhóm 1 (giả lập hành vi phụ trợ tự nhiên của con người).
 * - TUYỆT ĐỐI KHÔNG hỗ trợ Nhóm 2 (chủ động phá vỡ/vô hiệu hoá cơ chế bảo vệ/khoá của site).
 */

import type { BrowserAdapter } from './primitives.js';
import { MAP_CONSTANTS } from '../map/schema.js';

export interface Point {
  x: number;
  y: number;
}

export interface MousePathStep extends Point {
  delayMs: number;
}

export interface KeystrokeStep {
  char: string;
  delayMs: number;
}

export interface ScrollStep {
  deltaY: number;
  delayMs: number;
}

export class StealthEngine {
  /**
   * Sinh số ngẫu nhiên theo phân phối chuẩn xấp xỉ (Box-Muller transform).
   */
  static gaussianRandom(mean: number = 0, stdev: number = 1): number {
    let u = 1 - Math.random();
    let v = Math.random();
    let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return mean + z * stdev;
  }

  /**
   * Tính độ trễ ngẫu nhiên thích ứng theo importance_score của site (Mục 3.7 & 8.1).
   * Site quan trọng càng cao thì độ trễ phụ trợ và độ phân tán càng lớn.
   */
  static calculateAdaptiveDelay(
    baseMs: number = MAP_CONSTANTS.STEALTH_JITTER_BASE_MS,
    importanceScore: number = 0.5
  ): number {
    const clampedScore = Math.max(0, Math.min(1, importanceScore));
    const factor = 1 + clampedScore * 1.2;
    const jitter = Math.abs(this.gaussianRandom(0, baseMs * 0.4));
    return Math.round(baseMs * factor + jitter);
  }

  /**
   * Sinh quỹ đạo chuột cong Bézier bậc 3 từ điểm P0 tới P3 (Mục 8.1).
   * - 2 điểm điều khiển P1, P2 lệch ngẫu nhiên vuông góc với đường nối P0-P3.
   * - Vận tốc mô phỏng định luật Fitts: tăng tốc ở đầu, đạt đỉnh ở giữa, giảm tốc chậm khi tới gần mục tiêu.
   */
  static generateBezierPath(
    start: Point,
    target: Point,
    stepsCount: number = MAP_CONSTANTS.STEALTH_MOUSE_BEZIER_STEPS
  ): MousePathStep[] {
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5 || stepsCount <= 1) {
      return [{ x: target.x, y: target.y, delayMs: 10 }];
    }

    // Góc vuông với vector di chuyển để tạo độ uốn cong tự nhiên
    const normalX = -dy / (distance || 1);
    const normalY = dx / (distance || 1);

    // Độ lệch ngẫu nhiên của 2 điểm điều khiển (control points)
    const curveMagnitude1 = (Math.random() - 0.5) * distance * 0.4;
    const curveMagnitude2 = (Math.random() - 0.5) * distance * 0.4;

    const p1: Point = {
      x: start.x + dx * 0.3 + normalX * curveMagnitude1,
      y: start.y + dy * 0.3 + normalY * curveMagnitude1,
    };

    const p2: Point = {
      x: start.x + dx * 0.7 + normalX * curveMagnitude2,
      y: start.y + dy * 0.7 + normalY * curveMagnitude2,
    };

    const path: MousePathStep[] = [];

    for (let i = 1; i <= stepsCount; i++) {
      const t = i / stepsCount;

      // Cubic Bézier formula
      const oneMinusT = 1 - t;
      const x =
        Math.pow(oneMinusT, 3) * start.x +
        3 * Math.pow(oneMinusT, 2) * t * p1.x +
        3 * oneMinusT * Math.pow(t, 2) * p2.x +
        Math.pow(t, 3) * target.x;

      const y =
        Math.pow(oneMinusT, 3) * start.y +
        3 * Math.pow(oneMinusT, 2) * t * p1.y +
        3 * oneMinusT * Math.pow(t, 2) * p2.y +
        Math.pow(t, 3) * target.y;

      // Timing profile: nhanh ở giữa, chậm ở hai đầu (ease-in-out)
      // Base delay từ 6ms đến 25ms mỗi bước
      const speedFactor = Math.sin(t * Math.PI); // Đỉnh ở giữa
      const stepDelay = Math.round(20 - speedFactor * 12 + Math.random() * 4);

      path.push({
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        delayMs: Math.max(4, stepDelay),
      });
    }

    // Đảm bảo điểm cuối cùng chính xác là target
    path[path.length - 1].x = target.x;
    path[path.length - 1].y = target.y;

    return path;
  }

  /**
   * Sinh chuỗi nhịp gõ phím mô phỏng con người (Log-normal distribution) (Mục 8.1).
   * - Khoảng cách gõ dao động sinh học trong [STEALTH_TYPING_MIN_DELAY_MS, STEALTH_TYPING_MAX_DELAY_MS].
   * - Có khoảng nghỉ tự nhiên sau dấu cách hoặc dấu câu (cognitive pauses).
   */
  static generateTypingCadence(text: string): KeystrokeStep[] {
    const steps: KeystrokeStep[] = [];
    const minDelay = MAP_CONSTANTS.STEALTH_TYPING_MIN_DELAY_MS;
    const maxDelay = MAP_CONSTANTS.STEALTH_TYPING_MAX_DELAY_MS;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Phân phối Log-normal ngẫu nhiên quanh trung vị 100ms
      const normalVal = this.gaussianRandom(0, 0.4);
      let delay = Math.round(100 * Math.exp(normalVal));
      delay = Math.max(minDelay, Math.min(maxDelay, delay));

      // Thêm khoảng dừng nhận thức (cognitive pause) sau dấu cách hoặc dấu ngắt câu
      if ([' ', ',', '.', '!', '?', ';', '\n'].includes(char) && Math.random() < 0.35) {
        delay += Math.round(150 + Math.random() * 250);
      }

      steps.push({ char, delayMs: delay });
    }

    return steps;
  }

  /**
   * Sinh các bước cuộn trang mượt có quán tính (Inertial Smooth Scrolling) (Mục 8.1).
   * - Chia tổng quãng đường scroll thành nhiều bước nhỏ có gia tốc và giảm tốc.
   * - Kèm vi rung jitter ngẫu nhiên nhỏ mô phỏng con lăn chuột vật lý.
   */
  static generateInertialScrollSteps(totalDeltaY: number, numSteps: number = 15): ScrollStep[] {
    if (Math.abs(totalDeltaY) < 10 || numSteps <= 1) {
      return [{ deltaY: totalDeltaY, delayMs: 20 }];
    }

    const steps: ScrollStep[] = [];
    let accumulated = 0;

    for (let i = 1; i <= numSteps; i++) {
      const t = i / numSteps;
      // Hàm smooth-step: 3t^2 - 2t^3 (ease-in-out)
      const easedProgress = 3 * t * t - 2 * t * t * t;
      const targetAccumulated = totalDeltaY * easedProgress;
      let stepDelta = targetAccumulated - accumulated;

      // Vi rung chuột vật lý nhẹ (±1px)
      if (i < numSteps) {
        const microJitter = (Math.random() - 0.5) * 2;
        stepDelta += microJitter;
      }

      accumulated += stepDelta;
      const stepDelay = Math.round(16 + Math.sin(t * Math.PI) * 10 + Math.random() * 5);

      steps.push({
        deltaY: Math.round(stepDelta),
        delayMs: Math.max(8, stepDelay),
      });
    }

    // Điều chỉnh bước cuối để khớp chính xác tổng deltaY
    const finalDelta = steps.reduce((sum, s) => sum + s.deltaY, 0);
    const diff = totalDeltaY - finalDelta;
    if (diff !== 0 && steps.length > 0) {
      steps[steps.length - 1].deltaY += diff;
    }

    return steps;
  }

  // ==========================================================================
  // HIGH-LEVEL HUMANIZED PRIMITIVES (Thực thi qua BrowserAdapter)
  // ==========================================================================

  /**
   * Di chuyển chuột theo quỹ đạo Bézier cong và click tự nhiên (Mục 8.1).
   */
  static async humanizedClick(
    browser: BrowserAdapter,
    targetX: number,
    targetY: number,
    importanceScore: number = 0.5
  ): Promise<void> {
    // 1. Lấy vị trí chuột hiện tại (nếu có, hoặc mặc định từ toạ độ ngẫu nhiên)
    const currentPos = await browser.evaluate<Point>(`
      (() => {
        return {
          x: window['__dbt_last_mouse_x'] ?? Math.floor(Math.random() * 200 + 50),
          y: window['__dbt_last_mouse_y'] ?? Math.floor(Math.random() * 200 + 50),
        };
      })()
    `).catch(() => ({ x: 100, y: 100 }));

    // 2. Sinh đường cong Bézier
    const path = this.generateBezierPath(currentPos, { x: targetX, y: targetY });

    // 3. Di chuyển chuột qua từng điểm trên quỹ đạo
    for (const pt of path) {
      await browser.evaluate(`
        (() => {
          window['__dbt_last_mouse_x'] = ${pt.x};
          window['__dbt_last_mouse_y'] = ${pt.y};
        })()
      `).catch(() => {});
      if (pt.delayMs > 0) {
        await new Promise(r => setTimeout(r, pt.delayMs));
      }
    }

    // 4. Độ trễ trước khi nhấn phím chuột (pre-click pause)
    const preClickDelay = this.calculateAdaptiveDelay(60, importanceScore);
    await new Promise(r => setTimeout(r, preClickDelay));

    // 5. Thực hiện click qua dispatch MouseEvent tự nhiên
    await browser.evaluate(`
      (() => {
        const el = document.elementFromPoint(${targetX}, ${targetY});
        if (el) {
          const opts = { bubbles: true, cancelable: true, view: window, clientX: ${targetX}, clientY: ${targetY} };
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
        }
      })()
    `);

    // 6. Độ trễ sau click (post-click pause)
    const postClickDelay = this.calculateAdaptiveDelay(80, importanceScore);
    await new Promise(r => setTimeout(r, postClickDelay));
  }

  /**
   * Gõ phím vào phần tử input theo nhịp độ sinh học con người (Mục 8.1).
   */
  static async humanizedType(
    browser: BrowserAdapter,
    selector: string,
    text: string,
    importanceScore: number = 0.5
  ): Promise<void> {
    const cadence = this.generateTypingCadence(text);

    // Focus vào input trước
    await browser.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el && el instanceof HTMLElement) {
          el.focus();
        }
      })()
    `);

    // Độ trễ suy nghĩ trước khi gõ
    const preTypeDelay = this.calculateAdaptiveDelay(120, importanceScore);
    await new Promise(r => setTimeout(r, preTypeDelay));

    // Gõ từng ký tự
    for (const step of cadence) {
      await browser.evaluate(`
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
            el.value += ${JSON.stringify(step.char)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await new Promise(r => setTimeout(r, step.delayMs));
    }
  }

  /**
   * Cuộn trang mượt quán tính (Mục 8.1).
   */
  static async humanizedScroll(
    browser: BrowserAdapter,
    totalDeltaY: number,
    importanceScore: number = 0.5
  ): Promise<void> {
    const steps = this.generateInertialScrollSteps(totalDeltaY);

    for (const step of steps) {
      await browser.evaluate(`
        window.scrollBy({ top: ${step.deltaY}, left: 0, behavior: 'instant' });
      `);
      await new Promise(r => setTimeout(r, step.delayMs));
    }

    const settleDelay = this.calculateAdaptiveDelay(100, importanceScore);
    await new Promise(r => setTimeout(r, settleDelay));
  }
}
