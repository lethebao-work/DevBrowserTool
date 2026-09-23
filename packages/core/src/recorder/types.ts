/**
 * Demo Recorder Types (Mục 3.2)
 *
 * Định nghĩa cấu trúc sự kiện thu thập được khi người dùng demo:
 * - Click, Fill, Navigate
 * - Metadata ngữ nghĩa: Accessibility role, name, aria-label
 * - Trạng thái khoá tab (tab lock) và xác nhận phi-UI (non-UI actions)
 */

import type { ResourceNode, Variant } from '../map/schema.js';

export interface DomElementSnapshot {
  tagName: string;
  id: string | null;
  className: string | null;
  role: string | null;
  ariaLabel: string | null;
  textContent: string | null;
  placeholder: string | null;
  name: string | null;
  inputType: string | null;
  selector: string;
  xpath?: string;
}

export type RecordedEventType = 'click' | 'fill' | 'navigate';

export interface RecordedEvent {
  id: string;
  type: RecordedEventType;
  timestamp: number;
  target?: DomElementSnapshot;
  value?: string; // cho fill
  url?: string;   // cho navigate
}

export interface RrwebEvent {
  type: number;
  data: unknown;
  timestamp: number;
}

export interface RecordingSession {
  sessionId: string;
  domain: string;
  startedAt: number;
  stoppedAt: number | null;
  status: 'recording' | 'locked' | 'stopped';
  events: RecordedEvent[];
  rrwebEvents?: RrwebEvent[];
}

export interface NonUiActionRequest {
  id: string;
  actionType: 'call_api' | 'patch_runtime';
  details: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    target?: string;
    description?: string;
  };
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ExtractedDemoResult {
  nodes: ResourceNode[];
  variantsByNodeId: Record<string, Variant[]>;
  summary: {
    totalEvents: number;
    clicks: number;
    fills: number;
    navigates: number;
  };
}

export interface SessionReplayExport {
  sessionId: string;
  domain: string;
  startedAt: number;
  stoppedAt: number | null;
  eventsCount: number;
  rrwebEventsCount: number;
  events: RecordedEvent[];
  rrwebEvents: RrwebEvent[];
}

