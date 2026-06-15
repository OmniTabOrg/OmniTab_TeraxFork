import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppIcon, Settings01Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { NotificationBell } from "@/modules/agents";
import { type Tab, TabBar } from "@/modules/tabs";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewWindow: () => void;
  onNewPreview: () => void;
  onClose: (id: number) => void;
  /** Promote a preview (transient) tab to persistent. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  onTabDragStart?: (id: number) => string | null;
  onTabDragMove?: (
    raw: string,
    target: { targetId: number | null; edge: "before" | "after" } | null,
  ) => boolean | void;
  onTabDragEnd?: (raw: string, detached: boolean) => void;
  tabDragActive?: boolean;
  externalTabDragHover?: {
    targetId: number | null;
    edge: "before" | "after";
    preview: {
      title: string;
      x: number;
      y: number;
    };
  } | null;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onOpenSettings: () => void;
};

const COMPACT_WIDTH = 720;
const WINDOW_CHROME_INTERACTIVE_SELECTOR =
  "button, input, textarea, select, a, [role='tab'], [data-tab-id], [data-no-drag]";

function isWindowChromeInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    !!target.closest(WINDOW_CHROME_INTERACTIVE_SELECTOR)
  );
}

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewWindow,
  onNewPreview,
  onClose,
  onPin,
  onRename,
  onTabDragStart,
  onTabDragMove,
  onTabDragEnd,
  tabDragActive,
  externalTabDragHover,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenSettings,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  const startWindowDrag = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (tabDragActive || e.button !== 0) return;
      if (isWindowChromeInteractiveTarget(e.target)) {
        return;
      }
      const window = getCurrentWindow();
      if (e.detail > 1) {
        e.preventDefault();
        if (e.detail === 2) {
          void window.toggleMaximize().catch((err) => {
            console.warn("[omnitab] window maximize toggle failed:", err);
          });
        }
        return;
      }
      void window.startDragging().catch((err) => {
        console.warn("[omnitab] window drag failed:", err);
      });
    },
    [tabDragActive],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w < COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenSettings}
      title="Settings"
    >
      <AppIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
    </Button>
  );

  return (
    <div
      ref={rootRef}
      className={`relative flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      {IS_MAC && !tabDragActive && (
        <div
          data-tauri-drag-region
          onPointerDown={startWindowDrag}
          className="absolute inset-y-0 left-0 w-20"
        />
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        {!IS_MAC && (
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
        )}
      </div>

      {!IS_MAC && <span className="mx-1 h-5 w-px shrink-0 bg-border" />}

      <div
        className="flex h-full min-w-0 flex-1 items-center"
        data-omnitab-tab-drop-zone
        onPointerDown={startWindowDrag}
      >
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={onSelect}
          onNew={onNew}
          onNewWindow={onNewWindow}
          onNewPreview={onNewPreview}
          onClose={onClose}
          onPin={onPin}
          onRename={onRename}
          onTabDragStart={onTabDragStart}
          onTabDragMove={onTabDragMove}
          onTabDragEnd={onTabDragEnd}
          tabDragActive={tabDragActive}
          externalDropTarget={
            externalTabDragHover
              ? {
                  targetId: externalTabDragHover.targetId,
                  edge: externalTabDragHover.edge,
                }
              : null
          }
          externalDragPreview={externalTabDragHover?.preview ?? null}
          compact={compact}
        />
      </div>

      {IS_MAC && (
        <>
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
          {settingsButton}
        </>
      )}

      {!IS_MAC && settingsButton}

      {USE_CUSTOM_WINDOW_CONTROLS && <WindowControls />}
    </div>
  );
}
