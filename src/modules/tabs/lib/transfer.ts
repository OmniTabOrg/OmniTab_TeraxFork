import type { Tab } from "./useTabs";

export const TAB_DRAG_MIME = "application/x-omnitab-tab";
export const TAB_DRAG_TEXT = "omnitab-tab";
export const TAB_TRANSFER_EVENT = "omnitab:tab-transfer";
export const TAB_TRANSFER_READY_EVENT = "omnitab:tab-transfer-ready";
export const TAB_TRANSFER_ACCEPTED_EVENT = "omnitab:tab-transfer-accepted";
export const TAB_DRAG_STARTED_EVENT = "omnitab:tab-drag-started";
export const TAB_DRAG_ENDED_EVENT = "omnitab:tab-drag-ended";
export const TAB_DRAG_HOVER_EVENT = "omnitab:tab-drag-hover";
export const TAB_DRAG_RELEASE_EVENT = "omnitab:tab-drag-release";

export type TabDropEdge = "before" | "after";

export type TabTransferPayload = {
  schema: 1;
  transferId: string;
  sourceWindow: string;
  sourceTabId: number;
  tab: Tab;
  targetTabId?: number | null;
  targetEdge?: TabDropEdge;
  replaceTargetTabs?: boolean;
};

export type TabTransferAccepted = {
  transferId: string;
  targetWindow: string;
};

export type TabTransferReady = {
  label: string;
};

export type TabDragSignal = {
  transferId: string;
  sourceWindow: string;
};

export type TabDragReleaseSignal = {
  transferId: string;
};

export type TabDragHoverSignal = {
  transferId: string;
  sourceWindow: string;
  targetWindow: string | null;
  targetTabId: number | null;
  targetEdge: TabDropEdge;
  point: { x: number; y: number };
  title: string;
};

export type TabStripRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TabStripTabRect = TabStripRect & {
  id: number;
};

export type TabStripMetrics = {
  windowLabel: string;
  strip: TabStripRect;
  tabs: TabStripTabRect[];
};

export function parseTabTransferPayload(
  raw: string,
): TabTransferPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TabTransferPayload>;
    if (parsed.schema !== 1) return null;
    if (typeof parsed.transferId !== "string") return null;
    if (typeof parsed.sourceWindow !== "string") return null;
    if (typeof parsed.sourceTabId !== "number") return null;
    if (
      parsed.targetTabId !== undefined &&
      parsed.targetTabId !== null &&
      typeof parsed.targetTabId !== "number"
    ) {
      return null;
    }
    if (
      parsed.targetEdge !== undefined &&
      parsed.targetEdge !== "before" &&
      parsed.targetEdge !== "after"
    ) {
      return null;
    }
    if (!parsed.tab || typeof parsed.tab !== "object") return null;
    return parsed as TabTransferPayload;
  } catch {
    return null;
  }
}
