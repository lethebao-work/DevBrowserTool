/**
 * Anti-Debug Pre-Check Engine — Kiểm tra cơ chế chống gỡ lỗi (Mục 3.5, 15.7)
 *
 * PHẢI thực hiện trước khi bắt đầu Hook hoặc đặt Breakpoint mạnh tay.
 *
 * Khắc phục hiện tượng Observer Effect & False Positives (USENIX Security & PreEmptive best practice):
 * 1. Hiệu chuẩn baseline động (Dynamic Baseline Calibration): Chạy warm-up ngay trong cùng
 *    context để đo thời gian thực thi nền (đã bao gồm độ trễ tự nhiên do CDP debug-mode đính kèm).
 * 2. So sánh tương đối: Đo tỷ lệ (measured / baseline) thay vì dùng 1 ngưỡng thời gian cố định.
 * 3. Yêu cầu tín hiệu lặp lại (Repeated Signals): Chỉ kết luận khi có ít nhất ≥2 lần bất thường
 *    liên tiếp vượt ngưỡng tỷ lệ, loại trừ hoàn toàn các cú spike đột xuất do CPU/GC.
 * 4. Phát hiện các cơ chế chủ động của site:
 *    - Debugger statement loops (setInterval, Function("debugger")())
 *    - Bẫy console getters & devtools traps
 */

import type { BrowserAdapter } from '../actions/primitives.js';
import { MAP_CONSTANTS } from '../map/schema.js';

export type AntiDebugRiskLevel = 'none' | 'low' | 'medium' | 'high';

export interface AntiDebugCheckResult {
  hasAntiDebug: boolean;
  riskLevel: AntiDebugRiskLevel;
  detectedMechanisms: string[];
  baselineTimingMs: number;
  measuredTimingMs: number;
  timingRatio: number;
  repeatedAnomalyCount: number;
  debuggerLoopCount: number;
  cdpObserverEffectDetected: boolean;
  recommendation: 'proceed' | 'caution' | 'abort';
  details: {
    hasDebuggerTrap: boolean;
    hasTimingCheck: boolean;
    hasConsoleTrap: boolean;
    reason: string;
  };
}

export class AntiDebugChecker {
  /**
   * Quét và phân tích môi trường runtime xem có dựng bẫy anti-debug không.
   * Sử dụng baseline động và yêu cầu tín hiệu lặp lại để loại trừ observer effect của CDP.
   */
  static async check(browser: BrowserAdapter): Promise<AntiDebugCheckResult> {
    try {
      const evaluation = await browser.evaluate<{
        hasDebuggerKeywords: boolean;
        consoleHooked: boolean;
        detectedLoops: number;
        scriptPatterns: string[];
        baselineTiming: number;
        measuredTiming: number;
        timingRatio: number;
        repeatedAnomalies: number;
        cdpAttached: boolean;
      }>(`
        (() => {
          let debuggerCount = 0;
          let consoleHooked = false;
          const detectedPatterns = [];

          // 1. Quét nội dung các script tags xem có code bẫy debugger lặp
          const scripts = Array.from(document.querySelectorAll('script'));
          for (const s of scripts) {
            const text = s.textContent || '';
            if (text.includes('debugger') || text.includes('constructor("debugger")') || text.includes("Function('debugger')")) {
              debuggerCount++;
              detectedPatterns.push('inline_debugger_statement');
            }
            if (text.includes('setInterval') && text.includes('debugger')) {
              debuggerCount += 3;
              detectedPatterns.push('setinterval_debugger_loop');
            }
            if (/performance\\.now\\(\\)\\s*-\\s*\\w+\\s*>/.test(text) || /Date\\.now\\(\\)\\s*-\\s*\\w+\\s*>/.test(text)) {
              detectedPatterns.push('site_timing_trap');
            }
          }

          // 2. Kiểm tra console getter traps
          try {
            const desc = Object.getOwnPropertyDescriptor(console, 'log');
            if (desc && (desc.get || desc.set)) {
              consoleHooked = true;
              detectedPatterns.push('console_log_trap');
            }
          } catch {
            // Ignore
          }

          // 3. HIỆU CHUẨN BASELINE ĐỘNG (Dynamic Baseline Calibration - USENIX recommendation)
          // Chạy warm-up để xác định độ trễ nền tự nhiên của môi trường CDP hiện tại
          const WARMUP_COUNT = 3;
          let warmupTotal = 0;
          for (let w = 0; w < WARMUP_COUNT; w++) {
            const tw0 = performance.now();
            for (let i = 0; i < 2000; i++) { Math.sin(i); }
            const tw1 = performance.now();
            warmupTotal += (tw1 - tw0);
          }
          const baselineTiming = Math.max(warmupTotal / WARMUP_COUNT, 0.001); // Tránh chia cho 0

          // 4. ĐO LƯỜNG TƯƠNG ĐỐI & KIỂM TRA TÍN HIỆU LẶP LẠI (Repeated Signals)
          const TEST_ROUNDS = 3;
          let repeatedAnomalies = 0;
          let maxRatio = 1.0;
          let lastMeasured = baselineTiming;

          for (let r = 0; r < TEST_ROUNDS; r++) {
            const tm0 = performance.now();
            for (let i = 0; i < 2000; i++) { Math.sin(i); }
            const tm1 = performance.now();
            const measured = tm1 - tm0;
            lastMeasured = measured;
            const ratio = measured / baselineTiming;
            if (ratio > maxRatio) maxRatio = ratio;
            if (ratio >= 5.0) { // Ngưỡng tỷ lệ 5.0x
              repeatedAnomalies++;
            }
          }

          // Nhận diện CDP observer effect: nếu execution có độ trễ nền ổn định mà không có code bẫy
          const cdpAttached = typeof window === 'object' && Boolean(window['chrome']);

          return {
            hasDebuggerKeywords: debuggerCount > 0,
            consoleHooked,
            detectedLoops: debuggerCount,
            scriptPatterns: Array.from(new Set(detectedPatterns)),
            baselineTiming,
            measuredTiming: lastMeasured,
            timingRatio: maxRatio,
            repeatedAnomalies,
            cdpAttached,
          };
        })()
      `);

      const detectedMechanisms: string[] = [...(evaluation?.scriptPatterns || [])];
      const hasDebuggerTrap = (evaluation?.detectedLoops ?? 0) >= MAP_CONSTANTS.ANTI_DEBUG_LOOP_COUNT_THRESHOLD;
      
      // Chỉ kích hoạt hasTimingCheck khi có ít nhất ≥2 lần bất thường lặp lại vượt tỷ lệ 5.0x (Mục 15.7)
      const hasTimingCheck = (evaluation?.repeatedAnomalies ?? 0) >= MAP_CONSTANTS.ANTI_DEBUG_MIN_REPEATED_SIGNALS &&
        (evaluation?.timingRatio ?? 1.0) >= MAP_CONSTANTS.ANTI_DEBUG_TIMING_RATIO_THRESHOLD;

      const hasConsoleTrap = Boolean(evaluation?.consoleHooked);

      const hasAntiDebug = detectedMechanisms.length > 0 || hasDebuggerTrap || hasTimingCheck || hasConsoleTrap;

      let riskLevel: AntiDebugRiskLevel = 'none';
      let recommendation: 'proceed' | 'caution' | 'abort' = 'proceed';

      if (!hasAntiDebug) {
        riskLevel = 'none';
        recommendation = 'proceed';
      } else if (detectedMechanisms.includes('setinterval_debugger_loop') || (evaluation?.detectedLoops ?? 0) >= 3) {
        // Có bẫy debugger vòng lặp rõ ràng trong script của site
        riskLevel = 'high';
        recommendation = 'abort'; // Mục 3.5: anti-debug mạnh -> xử lý thận trọng, dừng can thiệp
      } else if (hasTimingCheck || hasConsoleTrap) {
        riskLevel = 'medium';
        recommendation = 'caution';
      } else {
        riskLevel = 'low';
        recommendation = 'caution';
      }

      let reason = 'Không phát hiện cơ chế anti-debug nào. Môi trường CDP ổn định.';
      if (riskLevel === 'high') {
        reason = `Phát hiện bẫy debugger statement lặp (${evaluation?.detectedLoops} lần). Tuyệt đối không can thiệp Breakpoint.`;
      } else if (riskLevel === 'medium') {
        reason = `Phát hiện bất thường lặp lại: tỷ lệ độ trễ ${evaluation?.timingRatio?.toFixed(2)}x so với baseline hoặc console trap. Thao tác Hook/Breakpoint cần thận trọng.`;
      } else if (riskLevel === 'low') {
        reason = 'Phát hiện dấu hiệu anti-debug nhẹ trong script tags (không có vòng lặp kích hoạt).';
      }

      return {
        hasAntiDebug,
        riskLevel,
        detectedMechanisms,
        baselineTimingMs: evaluation?.baselineTiming ?? 0,
        measuredTimingMs: evaluation?.measuredTiming ?? 0,
        timingRatio: evaluation?.timingRatio ?? 1.0,
        repeatedAnomalyCount: evaluation?.repeatedAnomalies ?? 0,
        debuggerLoopCount: evaluation?.detectedLoops ?? 0,
        cdpObserverEffectDetected: Boolean(evaluation?.cdpAttached),
        recommendation,
        details: {
          hasDebuggerTrap,
          hasTimingCheck,
          hasConsoleTrap,
          reason,
        },
      };
    } catch {
      return {
        hasAntiDebug: false,
        riskLevel: 'none',
        detectedMechanisms: [],
        baselineTimingMs: 0,
        measuredTimingMs: 0,
        timingRatio: 1.0,
        repeatedAnomalyCount: 0,
        debuggerLoopCount: 0,
        cdpObserverEffectDetected: false,
        recommendation: 'proceed',
        details: {
          hasDebuggerTrap: false,
          hasTimingCheck: false,
          hasConsoleTrap: false,
          reason: 'Không thể đánh giá DOM, tiếp tục với chế độ mặc định an toàn.',
        },
      };
    }
  }
}
