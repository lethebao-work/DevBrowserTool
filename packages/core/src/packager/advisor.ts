/**
 * Advisor / Overlay Packager — Chế độ Đóng gói Gợi ý Thao tác (Mục 5.3)
 *
 * Nhiệm vụ:
 * 1. Đóng gói Tool ở dạng trợ lý ảo chỉ dẫn trực tiếp trên màn hình website (Advisor/Overlay HUD).
 * 2. Chỉ thị vị trí cần thao tác tiếp theo qua bounding-box spotlight và tooltip hướng dẫn.
 * 3. Lắng nghe và trích xuất (extract) hành vi tương tác của người dùng để tự động chuyển bước.
 *
 * RANH GIỚI BẤT BIẾN (Mục 5.3):
 * - CHỈ dùng extract + hiển thị overlay.
 * - TUYỆT ĐỐI KHÔNG tự động thực hiện bất kỳ action thay đổi trạng thái (click, fill, patch_runtime, call_api)
 *   thay cho người dùng. Người dùng luôn là người trực tiếp ra quyết định và bấm chuột/gõ phím.
 */

import type { ToolConfig, Action, ResourceNode } from '../map/schema.js';

export interface AdvisoryStep {
  step_number: number;
  total_steps: number;
  intent: string;
  description: string;
  target_selector?: string;
  input_placeholder?: string;
  is_extract_only: boolean;
}

export interface AdvisorBundle {
  filename: string;
  code: string;
  steps: AdvisoryStep[];
}

export class AdvisorPackager {
  /**
   * Chuyển đổi danh sách Actions thành các bước chỉ dẫn (Advisory Steps) an toàn (Mục 5.3).
   * Mọi action (dù là click hay fill) đều được chuyển thành dạng chỉ dẫn trực quan, KHÔNG tự thực thi.
   */
  static extractAdvisorySteps(config: ToolConfig): AdvisoryStep[] {
    const nodeMap = new Map<string, ResourceNode>();
    for (const node of config.map_snapshot.nodes) {
      nodeMap.set(node.id, node);
    }

    const steps: AdvisoryStep[] = [];
    const total = config.actions.length;

    for (let i = 0; i < total; i++) {
      const act = config.actions[i];
      const node = act.node_ref ? nodeMap.get(act.node_ref) : undefined;
      const intent = node?.intent || act.description || `Hành động bước ${i + 1}`;

      let selector = '';
      if (node && node.variants.length > 0) {
        selector = node.variants[0].value_formula;
      } else if (act.params['selector']) {
        selector = String(act.params['selector']);
      }

      let description = act.description || '';
      if (!description) {
        switch (act.type) {
          case 'click':
            description = `Nhấp chuột vào phần tử [${intent}]`;
            break;
          case 'fill':
            description = `Nhập giá trị vào ô [${intent}]`;
            break;
          case 'navigate':
            description = `Điều hướng tới trang: ${act.params['url'] || ''}`;
            break;
          case 'extract':
            description = `Quan sát và đối chiếu thông tin từ [${intent}]`;
            break;
          default:
            description = `Thực hiện thao tác: ${intent}`;
            break;
        }
      }

      steps.push({
        step_number: i + 1,
        total_steps: total,
        intent,
        description,
        target_selector: selector || undefined,
        input_placeholder: act.params['value'] ? String(act.params['value']) : undefined,
        is_extract_only: act.type === 'extract',
      });
    }

    return steps;
  }

  /**
   * Sinh mã JavaScript đóng gói dạng Advisor Userscript / Overlay Widget (Mục 5.3).
   * Mã nhúng này vẽ spotlight + tooltip HUD và theo dõi sự kiện DOM của người dùng.
   */
  static generateAdvisorScript(config: ToolConfig): string {
    const steps = this.extractAdvisorySteps(config);
    const stepsJson = JSON.stringify(steps, null, 2);

    return `// ==UserScript==
// @name         ${config.name} (Advisor Mode)
// @namespace    https://devbrowsertool.local/advisor
// @version      1.0.0
// @description  ${config.description} — Chế độ chỉ dẫn tương tác trực quan (Advisor/Overlay HUD)
// @match        *://${config.target_domain}/*
// @grant        none
// ==/UserScript==

/**
 * DEV BROWSER TOOL — ADVISOR / OVERLAY HUD RUNTIME (Mục 5.3)
 * TUYỆT ĐỐI KHÔNG tự động click hay nhập liệu. Chỉ quan sát và hiển thị hướng dẫn.
 */
(() => {
  if (window.__dbt_advisor_active) return;
  window.__dbt_advisor_active = true;

  const steps = ${stepsJson};
  let currentStepIndex = 0;

  // 1. Tạo Container HUD (Spotlight & Tooltip)
  const hudContainer = document.createElement('div');
  hudContainer.id = 'dbt-advisor-hud';
  hudContainer.style.cssText = \`
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 360px;
    background: rgba(15, 23, 42, 0.95);
    color: #f8fafc;
    border: 1px solid rgba(56, 189, 248, 0.4);
    border-radius: 12px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    padding: 18px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647;
    backdrop-filter: blur(8px);
    transition: all 0.3s ease;
  \`;

  const spotlightBox = document.createElement('div');
  spotlightBox.id = 'dbt-advisor-spotlight';
  spotlightBox.style.cssText = \`
    position: absolute;
    pointer-events: none;
    border: 2px dashed #38bdf8;
    background: rgba(56, 189, 248, 0.15);
    border-radius: 6px;
    z-index: 2147483646;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    display: none;
  \`;
  document.body.appendChild(spotlightBox);
  document.body.appendChild(hudContainer);

  function renderStep(index) {
    if (index >= steps.length) {
      hudContainer.innerHTML = \`
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
          <span style="font-size: 20px;">🎉</span>
          <strong style="color: #4ade80; font-size: 15px;">Hoàn thành tất cả các bước!</strong>
        </div>
        <p style="margin: 0; font-size: 13px; color: #94a3b8;">Bạn đã hoàn tất quy trình thao tác theo kịch bản Advisor.</p>
        <button id="dbt-close-hud" style="margin-top: 12px; width: 100%; padding: 8px; background: #334155; border: none; border-radius: 6px; color: #fff; cursor: pointer;">Đóng Trợ Lý</button>
      \`;
      spotlightBox.style.display = 'none';
      document.getElementById('dbt-close-hud')?.addEventListener('click', () => {
        hudContainer.remove();
        spotlightBox.remove();
      });
      return;
    }

    const step = steps[index];
    hudContainer.innerHTML = \`
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #38bdf8; font-weight: 700;">
          Bước \${step.step_number} / \${step.total_steps}
        </span>
        <span style="font-size: 11px; background: #1e293b; padding: 2px 8px; border-radius: 9999px; color: #94a3b8;">Advisor Mode</span>
      </div>
      <div style="font-size: 14px; font-weight: 600; margin-bottom: 6px; color: #f1f5f9;">
        \${step.intent}
      </div>
      <div style="font-size: 12.5px; color: #cbd5e1; line-height: 1.4; margin-bottom: 12px;">
        \${step.description}
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="dbt-skip-step" style="flex: 1; padding: 6px 12px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #cbd5e1; font-size: 12px; cursor: pointer;">Bỏ qua bước này</button>
        <button id="dbt-next-step" style="flex: 1; padding: 6px 12px; background: #0284c7; border: none; border-radius: 6px; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer;">Đã làm xong →</button>
      </div>
    \`;

    document.getElementById('dbt-skip-step')?.addEventListener('click', () => {
      currentStepIndex++;
      renderStep(currentStepIndex);
    });

    document.getElementById('dbt-next-step')?.addEventListener('click', () => {
      currentStepIndex++;
      renderStep(currentStepIndex);
    });

    // 2. Định vị Spotlight quanh phần tử mục tiêu (chỉ hiển thị, TUYỆT ĐỐI KHÔNG click)
    if (step.target_selector) {
      try {
        const el = document.querySelector(step.target_selector);
        if (el) {
          const rect = el.getBoundingClientRect();
          spotlightBox.style.display = 'block';
          spotlightBox.style.top = (rect.top + window.scrollY - 4) + 'px';
          spotlightBox.style.left = (rect.left + window.scrollX - 4) + 'px';
          spotlightBox.style.width = (rect.width + 8) + 'px';
          spotlightBox.style.height = (rect.height + 8) + 'px';

          // Lắng nghe sự kiện người dùng tự thao tác thật
          const autoAdvanceHandler = () => {
            el.removeEventListener('click', autoAdvanceHandler);
            el.removeEventListener('change', autoAdvanceHandler);
            currentStepIndex++;
            renderStep(currentStepIndex);
          };
          el.addEventListener('click', autoAdvanceHandler, { once: true });
          el.addEventListener('change', autoAdvanceHandler, { once: true });
          return;
        }
      } catch {}
    }
    spotlightBox.style.display = 'none';
  }

  // Khởi động bước đầu tiên
  renderStep(0);
})();
`;
  }

  /**
   * Đóng gói hoàn chỉnh artifact Advisor Bundle.
   */
  static buildAdvisorBundle(config: ToolConfig): AdvisorBundle {
    const safeDomain = config.target_domain.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${safeDomain}.advisor.user.js`;
    const code = this.generateAdvisorScript(config);
    const steps = this.extractAdvisorySteps(config);

    return {
      filename,
      code,
      steps,
    };
  }
}
