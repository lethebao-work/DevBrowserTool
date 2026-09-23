/**
 * ToolAgentPlanner — Bộ Lập Kế Hoạch AI Thiết Kế Tool Bằng Prompt (Mục 5 & Mục 10)
 *
 * Nhiệm vụ:
 * 1. Tiếp nhận Prompt tự nhiên từ người dùng (ví dụ: "Tự động điền form đặt pizza và bấm submit").
 * 2. Đối chiếu tài nguyên trong Resource Graph của MapFile (các trường inputs, buttons, endpoints).
 * 3. Bóc tách ý đồ, ánh xạ thành chuỗi ActionCompileSpec và trích xuất biến tham số hóa.
 * 4. Đề xuất 2 phương án kiến trúc cụ thể (Chrome Extension MV3 vs Advisor HUD Overlay)
 *    để người dùng xem xét, trao đổi và chốt trước khi build.
 */

import type { MapFile, ResourceNode, ActionType, OnFailure } from '../map/schema.js';
import type { ActionCompileSpec } from './compiler.js';

export interface PlannedParameter {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  defaultValue: string;
  description: string;
}

export interface ProposedPlan {
  id: string;
  packageType: 'chrome_extension' | 'advisor_overlay' | 'userscript' | 'agent_script';
  title: string;
  badge: string;
  description: string;
  pros: string[];
  recommended: boolean;
}

export interface SmartPreset {
  id: string;
  icon: string;
  title: string;
  description: string;
  prompt: string;
  toolName: string;
  packageType: 'chrome_extension' | 'advisor_overlay';
  paramValues: Record<string, string>;
  actionSummary: string[];
}

export interface AgentPlannerResult {
  toolName: string;
  summary: string;
  domain: string;
  matchedNodes: Array<{
    nodeId: string;
    intent: string;
    actionType: ActionType;
    paramKey?: string;
  }>;
  parameters: PlannedParameter[];
  actionSpecs: ActionCompileSpec[];
  proposals: ProposedPlan[];
}

export class ToolAgentPlanner {
  /**
   * Phân tích Prompt dựa trên Resource Graph của Map và đề xuất các phương án tạo Tool.
   */
  static analyzeAndPropose(map: MapFile, prompt: string): AgentPlannerResult {
    const domain = map.domain;
    const cleanPrompt = prompt.toLowerCase().trim();

    // 1. Phân loại các nodes có trong Resource Graph của Map
    const inputNodes: ResourceNode[] = [];
    const buttonNodes: ResourceNode[] = [];
    const endpointNodes: ResourceNode[] = [];

    for (const node of map.base_nodes) {
      if (node.type === 'endpoint') {
        endpointNodes.push(node);
      } else if (node.type === 'dom_element') {
        const intentLower = node.intent.toLowerCase();
        const idLower = node.id.toLowerCase();
        const selector = node.variants[0]?.value_formula?.toLowerCase() || '';

        if (
          intentLower.includes('nút') ||
          intentLower.includes('button') ||
          intentLower.includes('submit') ||
          idLower.includes('button') ||
          idLower.includes('submit') ||
          selector.includes('button') ||
          selector.includes('type="submit"')
        ) {
          buttonNodes.push(node);
        } else {
          inputNodes.push(node);
        }
      }
    }

    // 2. Đối chiếu ý đồ người dùng và các nodes khớp được
    const matchedNodes: Array<{
      nodeId: string;
      intent: string;
      actionType: ActionType;
      paramKey?: string;
    }> = [];

    const parameters: PlannedParameter[] = [];
    const actionSpecs: ActionCompileSpec[] = [];

    // Danh sách từ khóa nhận diện các trường thường gặp
    const knownFields: Record<string, { label: string; defaultVal: string }> = {
      custname: { label: 'Tên Khách Hàng', defaultVal: 'Alice Walker' },
      name: { label: 'Họ và Tên', defaultVal: 'Alice Walker' },
      player: { label: 'Tên Người Chơi', defaultVal: 'ProGamer' },
      user: { label: 'Tên Người Dùng', defaultVal: 'ProGamer' },
      username: { label: 'Tên Đăng Nhập', defaultVal: 'ProGamer' },
      custtel: { label: 'Số Điện Thoại', defaultVal: '+1-202-555-0143' },
      tel: { label: 'Số Điện Thoại', defaultVal: '+1-202-555-0143' },
      phone: { label: 'Số Điện Thoại', defaultVal: '+1-202-555-0143' },
      custemail: { label: 'Email Liên Hệ', defaultVal: 'alice@example.com' },
      email: { label: 'Email Liên Hệ', defaultVal: 'alice@example.com' },
      comments: { label: 'Ghi Chú Đơn Hàng', defaultVal: 'Giao hàng tận nơi' },
      comment: { label: 'Nội Dung Bình Luận', defaultVal: 'Rất hài lòng' },
      note: { label: 'Ghi Chú', defaultVal: 'Thao tác tự động' },
      tag: { label: 'Thẻ Clan / Tag', defaultVal: 'PRO' },
      room: { label: 'Mã Phòng', defaultVal: '1234' },
      search: { label: 'Từ Khóa Tìm Kiếm', defaultVal: 'Game Hot' },
      size: { label: 'Kích Cỡ', defaultVal: 'medium' },
      topping: { label: 'Topping', defaultVal: 'cheese' },
    };

    // Kiểm tra xem prompt có yêu cầu trường cụ thể hay toàn bộ form
    const promptWantsAll = cleanPrompt.includes('toàn bộ') || cleanPrompt.includes('tất cả') || cleanPrompt.includes('mọi trường');

    // Lọc các input thực sự phù hợp với prompt
    let candidateInputNodes = inputNodes;
    if (!promptWantsAll && inputNodes.length > 1) {
      const promptMatchedInputs = inputNodes.filter(node => {
        const idLower = node.id.toLowerCase();
        const intentLower = node.intent.toLowerCase();
        const selectorLower = (node.variants[0]?.value_formula || '').toLowerCase();

        const isToggleOrCheckbox = idLower.includes('toggle') || idLower.includes('checkbox') || selectorLower.includes('type="checkbox"');
        if (isToggleOrCheckbox && !cleanPrompt.includes('toggle') && !cleanPrompt.includes('bật') && !cleanPrompt.includes('tắt')) {
          return false;
        }

        // Kiểm tra xem prompt có chứa từ khóa của node này không
        const words = intentLower.replace(/^(trường|ô nhập liệu|ô nhập)\s+/i, '').split(/[\s\-_\/]+/);
        const hasKeywordMatch = words.some(w => w.length >= 2 && cleanPrompt.includes(w));
        const hasIdMatch = cleanPrompt.includes(idLower.replace(/^node-input-/, ''));
        const hasSpecificConcept =
          (cleanPrompt.includes('tên') && (idLower.includes('name') || idLower.includes('player') || idLower.includes('t_n') || intentLower.includes('tên'))) ||
          (cleanPrompt.includes('email') && (idLower.includes('email') || intentLower.includes('email'))) ||
          ((cleanPrompt.includes('số điện thoại') || cleanPrompt.includes('phone') || cleanPrompt.includes('tel')) && (idLower.includes('tel') || idLower.includes('phone'))) ||
          ((cleanPrompt.includes('ghi chú') || cleanPrompt.includes('comment') || cleanPrompt.includes('note')) && (idLower.includes('comment') || idLower.includes('note') || intentLower.includes('ghi chú'))) ||
          ((cleanPrompt.includes('tìm kiếm') || cleanPrompt.includes('search')) && (idLower.includes('search') || intentLower.includes('tìm kiếm')));

        return hasKeywordMatch || hasIdMatch || hasSpecificConcept;
      });

      if (promptMatchedInputs.length > 0) {
        candidateInputNodes = promptMatchedInputs;
      } else {
        // Nếu không khớp từ khóa cụ thể nào, chỉ giữ lại các text input chính (loại bỏ toggle/checkbox/range bí mật)
        const primaryInputs = inputNodes.filter(node => {
          const id = node.id.toLowerCase();
          const selector = (node.variants[0]?.value_formula || '').toLowerCase();
          return !id.includes('toggle') && !id.includes('checkbox') && !selector.includes('type="checkbox"') && !id.includes('range');
        });
        if (primaryInputs.length > 0) {
          candidateInputNodes = primaryInputs.slice(0, 3);
        }
      }
    }

    for (const node of candidateInputNodes) {
      const idLower = node.id.toLowerCase();
      const selector = node.variants[0]?.value_formula?.toLowerCase() || '';
      const intentLower = node.intent.toLowerCase();

      // Rút trích tên trường kỹ thuật (field key) chính xác
      let fieldKey = '';
      const nameAttrMatch = selector.match(/name=["']?([^"'\]]+)["']?/i);
      if (nameAttrMatch && nameAttrMatch[1]) {
        fieldKey = nameAttrMatch[1];
      } else {
        const idClean = node.id.replace(/^node-[a-z]+-/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        fieldKey = idClean;
      }

      // Chuẩn hóa mapping nhãn và giá trị mặc định
      const matchedKey = Object.keys(knownFields).find(k => fieldKey.toLowerCase().includes(k)) || fieldKey;
      const fieldMeta = knownFields[matchedKey] || {
        label: node.intent.replace(/^Trường\s+/, '').replace(/^Ô nhập\s+/, '').replace(/^Ô nhập liệu\s+/, ''),
        defaultVal: 'Dữ liệu mẫu',
      };

      const paramKey = fieldKey;
      parameters.push({
        key: paramKey,
        label: fieldMeta.label,
        type: 'string',
        defaultValue: fieldMeta.defaultVal,
        description: `Giá trị tự động điền cho ${fieldMeta.label}`,
      });

      matchedNodes.push({
        nodeId: node.id,
        intent: `Điền ${fieldMeta.label}`,
        actionType: 'fill',
        paramKey,
      });

      actionSpecs.push({
        intent: node.intent,
        type: 'fill',
        params: { value: `{{${paramKey}}}` },
        on_failure: 'stop',
      });
    }

    // Chọn nút hành động (Ưu tiên nút được nhắc đến trong Prompt)
    let selectedButton = buttonNodes.find(b => {
      const txt = b.intent.toLowerCase().replace(/^nút\s+/i, '');
      const words = txt.split(/[\s\-_\/]+/);
      return words.some(w => w.length > 2 && cleanPrompt.includes(w));
    });

    if (!selectedButton) {
      selectedButton = buttonNodes.find(b => {
        const txt = b.intent.toLowerCase();
        return (
          txt.includes('chơi đơn') ||
          txt.includes('chơi') ||
          txt.includes('cửa hàng') ||
          txt.includes('submit') ||
          txt.includes('order') ||
          txt.includes('gửi') ||
          txt.includes('đặt') ||
          txt.includes('tiếp tục')
        );
      });
    }

    if (!selectedButton && buttonNodes.length > 0) {
      selectedButton = buttonNodes[0];
    }

    if (selectedButton) {
      matchedNodes.push({
        nodeId: selectedButton.id,
        intent: selectedButton.intent,
        actionType: 'click',
      });

      actionSpecs.push({
        intent: selectedButton.intent,
        type: 'click',
        params: {},
        on_failure: 'stop',
      });
    }

    // Nếu không có input nào mà có endpoints, tạo action call_api
    if (actionSpecs.length === 0 && endpointNodes.length > 0) {
      for (const ep of endpointNodes) {
        actionSpecs.push({
          intent: ep.intent,
          type: 'call_api',
          params: {},
          on_failure: 'stop',
        });
        matchedNodes.push({
          nodeId: ep.id,
          intent: ep.intent,
          actionType: 'call_api',
        });
      }
    }

    // 3. Đặt tên Tool chuẩn hóa
    const domainClean = domain.replace(/[^a-zA-Z0-9]/g, '');
    let toolName = `${domainClean}_AutoFlow_Tool`;
    if (cleanPrompt.includes('đặt') || cleanPrompt.includes('order') || cleanPrompt.includes('pizza')) {
      toolName = `${domainClean}_Order_Tool`;
    } else if (cleanPrompt.includes('login') || cleanPrompt.includes('đăng nhập')) {
      toolName = `${domainClean}_Login_Tool`;
    }

    // 4. Sinh bản tóm tắt phân tích của Agent
    const summary =
      `Đã phân tích Prompt: "${prompt}". ` +
      `AI Agent khớp được ${matchedNodes.length} tài nguyên tương tác trên domain ${domain} ` +
      `(${parameters.length} ô nhập liệu và ${selectedButton ? 1 : 0} nút thao tác). ` +
      `Chuỗi hành động hoàn chỉnh gồm ${actionSpecs.length} bước tuần tự.`;

    // 5. Đề xuất 2 phương án kiến trúc
    const proposals: ProposedPlan[] = [
      {
        id: 'chrome_extension',
        packageType: 'chrome_extension',
        title: 'Phương Án 1: Chrome Extension MV3 Độc Lập',
        badge: 'Khuyên Dùng',
        recommended: true,
        description:
          'Đóng gói thành Tiện ích mở rộng Chrome hoàn chỉnh (Manifest V3, Content Script & Popup). ' +
          'Cài đặt 1 click vào trình duyệt Chrome thật, tự động điền form và gửi dữ liệu ngay trên tab đang mở.',
        pros: [
          'Chạy trực tiếp 100% trong Chrome không cần backend Node.js',
          'Có giao diện Popup trực quan để đổi tham số nhanh',
          'Tương thích hoàn toàn với chính sách bảo mật Manifest V3',
        ],
      },
      {
        id: 'advisor_overlay',
        packageType: 'advisor_overlay',
        title: 'Phương Án 2: Advisor HUD Overlay (Chạy Nền Tự Động)',
        badge: 'Resilience 5-Bước',
        recommended: false,
        description:
          'Tự động hoá trực tiếp qua ExecutionEngine với giao diện HUD giám sát thời gian thực. ' +
          'Ứng dụng vòng lặp 5 bước (Resolve ➔ Verify ➔ Act ➔ Confirm ➔ Fallback) chống gãy hỏng khi website đổi giao diện.',
        pros: [
          'Tự động chuyển đổi sang Variant dự phòng khi web đổi CSS/ID',
          'Tích hợp Circuit Breaker tự ngắt khẩn cấp bảo vệ dữ liệu',
          'Giám sát từng micro-step trực quan qua Live HUD',
        ],
      },
    ];

    return {
      toolName,
      summary,
      domain,
      matchedNodes,
      parameters,
      actionSpecs,
      proposals,
    };
  }

  /**
   * Tự động phân tích Resource Graph để sinh ra các Preset công cụ mẫu sẵn dùng (1-click)
   */
  static generateSmartPresets(map: MapFile): SmartPreset[] {
    const presets: SmartPreset[] = [];
    const domainClean = map.domain.replace(/[^a-zA-Z0-9]/g, '');

    const inputNodes = map.base_nodes.filter(
      n => n.type === 'dom_element' && !n.intent.toLowerCase().includes('nút') && !n.intent.toLowerCase().includes('button')
    );
    const buttonNodes = map.base_nodes.filter(
      n =>
        n.type === 'dom_element' &&
        (n.intent.toLowerCase().includes('nút') ||
          n.intent.toLowerCase().includes('button') ||
          n.variants[0]?.value_formula?.includes('button'))
    );
    const endpointNodes = map.base_nodes.filter(n => n.type === 'endpoint');

    // Preset 1: Auto-Fill & Click Primary Action (Game / Form Flow)
    if (inputNodes.length > 0 && buttonNodes.length > 0) {
      const primaryInput = inputNodes[0];
      const primaryBtn = buttonNodes[0];
      const paramKey = primaryInput.id.replace(/^node-[a-z]+-/, '').replace(/[^a-zA-Z0-9_]/g, '_');
      const isGame = map.domain.includes('openfront') || primaryInput.intent.toLowerCase().includes('người chơi');

      presets.push({
        id: 'preset_autofill_action',
        icon: isGame ? '🎮' : '⚡',
        title: isGame ? 'Tự Động Đổi Tên & Vào Trận' : 'Tự Động Điền Biểu Mẫu & Gửi',
        description: isGame
          ? `Tự động gõ tên người chơi và nhấn nút ${primaryBtn.intent.replace(/^nút\s+/i, '')} ngay lập tức.`
          : `Tự động hoàn thành các trường thông tin và nhấn nút gửi.`,
        prompt: isGame
          ? `Tự động đổi tên người chơi thành ProPlayerVN và bấm nút ${primaryBtn.intent.replace(/^nút\s+/i, '')}`
          : `Tự động điền thông tin biểu mẫu và bấm ${primaryBtn.intent.replace(/^nút\s+/i, '')}`,
        toolName: `${domainClean}_AutoAction`,
        packageType: 'chrome_extension',
        paramValues: { [paramKey]: isGame ? 'ProPlayerVN' : 'Dữ liệu mẫu' },
        actionSummary: [`Điền ${primaryInput.intent}`, `Nhấn ${primaryBtn.intent}`],
      });
    }

    // Preset 2: Store / Navigation Flow (Cửa hàng / Khám phá)
    const storeBtn = buttonNodes.find(
      b =>
        b.intent.toLowerCase().includes('cửa hàng') ||
        b.intent.toLowerCase().includes('store') ||
        b.intent.toLowerCase().includes('shop')
    );
    if (storeBtn) {
      presets.push({
        id: 'preset_store_navigator',
        icon: '🛍️',
        title: 'Mở Cửa Hàng & Xem Gói Vật Phẩm',
        description: 'Tự động click mở modal Cửa hàng và kiểm tra các gói ưu đãi trên hệ thống.',
        prompt: 'Mở tab Cửa hàng để kiểm tra các gói vật phẩm',
        toolName: `${domainClean}_StoreViewer`,
        packageType: 'chrome_extension',
        paramValues: {},
        actionSummary: [`Nhấn ${storeBtn.intent}`, 'Xác thực hiển thị modal Cửa hàng'],
      });
    }

    // Preset 3: Leaderboard / Ranking / Search
    const rankBtn = buttonNodes.find(
      b =>
        b.intent.toLowerCase().includes('bảng xếp hạng') ||
        b.intent.toLowerCase().includes('xếp hạng') ||
        b.intent.toLowerCase().includes('leaderboard')
    );
    if (rankBtn) {
      presets.push({
        id: 'preset_leaderboard',
        icon: '🏆',
        title: 'Tra Cứu Bảng Xếp Hạng Game',
        description: 'Tự động mở danh sách xếp hạng top người chơi và thông số thi đấu.',
        prompt: 'Mở xem Bảng xếp hạng người chơi',
        toolName: `${domainClean}_Leaderboard`,
        packageType: 'advisor_overlay',
        paramValues: {},
        actionSummary: [`Nhấn ${rankBtn.intent}`, 'Theo dõi dữ liệu xếp hạng thời gian thực'],
      });
    }

    // Preset 4: API Endpoint Inspector
    if (endpointNodes.length > 0) {
      const topApi = endpointNodes[0];
      presets.push({
        id: 'preset_api_monitor',
        icon: '📡',
        title: 'Giám Sát & Gọi API Nền',
        description: `Tự động kết nối và trích xuất dữ liệu từ ${endpointNodes.length} API endpoints ngầm của hệ thống.`,
        prompt: `Giám sát dữ liệu từ API ${topApi.intent}`,
        toolName: `${domainClean}_ApiMonitor`,
        packageType: 'advisor_overlay',
        paramValues: {},
        actionSummary: [`Gọi ${topApi.intent}`, `Phân tích phản hồi từ ${map.domain}`],
      });
    }

    return presets;
  }
}
