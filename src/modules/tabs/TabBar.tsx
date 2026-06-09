import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import type { TabDropEdge } from "./lib/transfer";
import {
  Cancel01Icon,
  Clock01Icon,
  ComputerTerminal02Icon,
  BrowserIcon,
  GitCompareIcon,
  Globe02Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  ServerStack02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { labelFor } from "./lib/tabLabel";
import type { EditorTab, Tab } from "./lib/useTabs";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewWindow: () => void;
  onNewPreview: () => void;
  onClose: (id: number) => void;
  /** Pin (promote) a preview tab to persistent on double-click. */
  onPin: (id: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  onTabDragStart?: (id: number) => string | null;
  onTabDragMove?: (
    raw: string,
    target: { targetId: number | null; edge: TabDropEdge } | null,
  ) => boolean | void;
  onTabDragEnd?: (raw: string, detached: boolean) => void;
  tabDragActive?: boolean;
  externalDropTarget?: {
    targetId: number | null;
    edge: TabDropEdge;
  } | null;
  externalDragPreview?: {
    title: string;
    x: number;
    y: number;
  } | null;
  compact?: boolean;
};

type PointerDragState = {
  pointerId: number;
  tabId: number;
  title: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  raw: string | null;
  element: HTMLElement;
};

type DragPreview = {
  tabId: number;
  title: string;
  x: number;
  y: number;
};

const TAB_DRAG_THRESHOLD_PX = 5;

export function TabBar({
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
  externalDropTarget,
  externalDragPreview,
  compact,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<PointerDragState | null>(null);
  const bodyDragStyleRef = useRef<{
    cursor: string;
    userSelect: string;
  } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{
    targetId: number | null;
    edge: TabDropEdge;
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  // Horizontal wheel scroll without holding shift.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active tab visible after selection / open.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  const applyBodyDragStyle = useCallback(() => {
    if (bodyDragStyleRef.current) return;
    bodyDragStyleRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  }, []);

  const restoreBodyDragStyle = useCallback(() => {
    const prev = bodyDragStyleRef.current;
    if (!prev) return;
    document.body.style.cursor = prev.cursor;
    document.body.style.userSelect = prev.userSelect;
    bodyDragStyleRef.current = null;
  }, []);

  const dropTargetAtPoint = useCallback(
    (
      x: number,
      y: number,
    ): { targetId: number | null; edge: TabDropEdge } | null => {
      const strip = stripRef.current;
      if (!strip) return null;
      const stripRect = strip.getBoundingClientRect();
      if (
        x < stripRect.left ||
        x > stripRect.right ||
        y < stripRect.top ||
        y > stripRect.bottom
      ) {
        return null;
      }
      const tabEls = Array.from(
        strip.querySelectorAll<HTMLElement>("[data-tab-id]"),
      ).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      for (const tabEl of tabEls) {
        const id = Number(tabEl.dataset.tabId);
        if (!Number.isFinite(id)) continue;
        const rect = tabEl.getBoundingClientRect();
        if (x < rect.left + rect.width / 2) {
          return { targetId: id, edge: "before" };
        }
      }
      return { targetId: null, edge: "after" };
    },
    [],
  );

  const effectiveDropTarget = dragStateRef.current?.raw
    ? dragOver
    : (externalDropTarget ?? dragOver);
  const effectiveDragPreview = dragPreview ?? externalDragPreview ?? null;
  const showDropIndicators =
    !dragStateRef.current?.raw &&
    (tabDragActive || effectiveDragPreview !== null);

  const resetPointerDrag = useCallback(() => {
    const state = dragStateRef.current;
    if (state?.element.hasPointerCapture(state.pointerId)) {
      state.element.releasePointerCapture(state.pointerId);
    }
    dragStateRef.current = null;
    setDragOver(null);
    setDragPreview(null);
    restoreBodyDragStyle();
  }, [restoreBodyDragStyle]);

  const finishPointerDrag = useCallback(
    (detached: boolean) => {
      const state = dragStateRef.current;
      if (!state) return;
      const raw = state.raw;
      resetPointerDrag();
      if (raw) onTabDragEnd?.(raw, detached);
    },
    [onTabDragEnd, resetPointerDrag],
  );

  const startPointerDrag = useCallback(
    (state: PointerDragState) => {
      const raw = onTabDragStart?.(state.tabId);
      if (!raw) {
        resetPointerDrag();
        return false;
      }
      state.raw = raw;
      applyBodyDragStyle();
      setDragPreview({
        tabId: state.tabId,
        title: state.title,
        x: state.currentX,
        y: state.currentY,
      });
      return true;
    },
    [applyBodyDragStyle, onTabDragStart, resetPointerDrag],
  );

  useEffect(() => {
    if (tabDragActive || !dragStateRef.current?.raw) return;
    resetPointerDrag();
  }, [resetPointerDrag, tabDragActive]);

  useEffect(() => {
    if (tabDragActive || externalDropTarget || externalDragPreview) return;
    setDragOver(null);
  }, [externalDragPreview, externalDropTarget, tabDragActive]);

  useEffect(() => resetPointerDrag, [resetPointerDrag]);

  const handleTabPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>, tab: Tab) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.closest("[data-tab-close]")) {
        return;
      }
      const element = e.currentTarget;
      element.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        pointerId: e.pointerId,
        tabId: tab.id,
        title: labelFor(tab),
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        raw: null,
        element,
      };
      onSelect(tab.id);
    },
    [onSelect],
  );

  const handleTabPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      state.currentX = e.clientX;
      state.currentY = e.clientY;

      if (!state.raw) {
        const distance = Math.hypot(
          e.clientX - state.startX,
          e.clientY - state.startY,
        );
        if (distance < TAB_DRAG_THRESHOLD_PX) return;
        if (!startPointerDrag(state)) return;
      }

      e.preventDefault();
      setDragPreview({
        tabId: state.tabId,
        title: state.title,
        x: e.clientX,
        y: e.clientY,
      });
      const target = dropTargetAtPoint(e.clientX, e.clientY);
      setDragOver(target);
      if (state.raw && onTabDragMove?.(state.raw, target)) {
        resetPointerDrag();
      }
    },
    [dropTargetAtPoint, onTabDragMove, resetPointerDrag, startPointerDrag],
  );

  const handleTabPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      if (!state.raw) {
        resetPointerDrag();
        return;
      }
      e.preventDefault();
      finishPointerDrag(dropTargetAtPoint(e.clientX, e.clientY) === null);
    },
    [dropTargetAtPoint, finishPointerDrag, resetPointerDrag],
  );

  const handleTabPointerCancel = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      finishPointerDrag(true);
    },
    [finishPointerDrag],
  );

  const handleTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, id: number) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      onSelect(id);
    },
    [onSelect],
  );

  return (
    <div
      ref={stripRef}
      data-omnitab-tab-strip
      data-omnitab-tab-drop-zone
      onPointerMove={(e) => {
        if (!tabDragActive || dragStateRef.current?.raw) return;
        setDragOver(dropTargetAtPoint(e.clientX, e.clientY));
      }}
      onPointerLeave={() => {
        if (!dragStateRef.current?.raw) setDragOver(null);
      }}
      className="flex min-w-0 flex-1 items-center overflow-hidden"
    >
      <div
        ref={scrollRef}
        role="tablist"
        aria-orientation="horizontal"
        className="flex h-7 min-w-0 shrink items-center gap-0.5 overflow-hidden bg-transparent p-0"
      >
        {tabs.map((t) => {
          const isPreview = t.kind === "editor" && (t as EditorTab).preview;
          const isActive = t.id === activeId;
          let tabNode: ReactNode;

          // While renaming, render a non-button cell so the <input> remains
          // focusable and selectable across WebKit/Tauri.
          if (editingId === t.id && t.kind === "terminal") {
            tabNode = (
              <div
                data-tab-id={t.id}
                className={cn(
                  "flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md bg-accent text-xs text-foreground",
                  compact ? "px-1.5" : "px-2",
                )}
              >
                <TabIcon tab={t} />
                <TabRenameInput
                  initial={labelFor(t)}
                  onCommit={(value) => {
                    onRename(t.id, value);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            );
          } else {
            const trigger = (
              <div
                role="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                data-tab-id={t.id}
                onPointerDown={(e) => handleTabPointerDown(e, t)}
                onPointerMove={handleTabPointerMove}
                onPointerUp={handleTabPointerUp}
                onPointerCancel={handleTabPointerCancel}
                onClick={() => onSelect(t.id)}
                onKeyDown={(e) => handleTabKeyDown(e, t.id)}
                onDoubleClick={() => isPreview && onPin(t.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose(t.id);
                  }
                }}
                onMouseDown={(e) => {
                  if (e.button === 1) e.preventDefault();
                }}
                className={cn(
                  "group flex h-7 min-w-0 shrink cursor-default items-center justify-between gap-1.5 rounded-md text-xs transition-colors hover:text-foreground/80",
                  dragPreview?.tabId === t.id && "opacity-45",
                  isActive
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground",
                  compact ? "px-1.5" : tabs.length === 1 ? "px-2" : "ps-2 pe-1",
                )}
              >
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 truncate",
                    compact ? "max-w-48" : "max-w-80",
                  )}
                >
                  <TabIcon tab={t} />
                  {/* Preview tabs use italic to signal the transient state,
                      matching the visual convention from VSCode. */}
                  <span className={cn("truncate", isPreview && "italic")}>
                    {labelFor(t)}
                  </span>
                  {t.kind === "editor" && t.dirty ? (
                    <span
                      aria-label="Unsaved changes"
                      className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                    />
                  ) : null}
                </span>
                <button
                  type="button"
                  data-tab-close
                  aria-label="Close tab"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-accent hover:opacity-100 group-hover:opacity-60"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={11}
                    strokeWidth={2}
                  />
                </button>
              </div>
            );

            tabNode =
              t.kind !== "terminal" ? (
                trigger
              ) : (
                <ContextMenu>
                  <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-36"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <ContextMenuItem onSelect={() => setEditingId(t.id)}>
                      <HugeiconsIcon
                        icon={PencilEdit02Icon}
                        size={14}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">Rename</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={() => onClose(t.id)}>
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={14}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">Close</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
          }

          return (
            <Fragment key={t.id}>
              <DropIndicator
                active={effectiveDropTarget?.targetId === t.id}
                visible={showDropIndicators}
                windowDragEnabled={!tabDragActive}
              />
              {tabNode}
            </Fragment>
          );
        })}
        <DropIndicator
          active={effectiveDropTarget?.targetId === null}
          visible={showDropIndicators}
          windowDragEnabled={!tabDragActive}
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="New tab"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuItem onSelect={() => onNew()}>
            <HugeiconsIcon
              icon={ComputerTerminal02Icon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Terminal</span>
            <span className="text-xs text-muted-foreground">
              {fmtShortcut(MOD_KEY, "T")}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNewWindow()}>
            <HugeiconsIcon icon={BrowserIcon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Window</span>
            <span className="text-xs text-muted-foreground">
              {fmtShortcut(MOD_KEY, "W")}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNewPreview()}>
            <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
            <span className="flex-1">Browser</span>
            <span className="text-xs text-muted-foreground">
              {fmtShortcut(MOD_KEY, "P")}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div
        data-tauri-drag-region={!tabDragActive ? true : undefined}
        className="h-full min-w-2 flex-1"
      />
      {effectiveDragPreview && (
        <div
          className="pointer-events-none fixed z-50 max-w-72 truncate rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg"
          style={{
            left: effectiveDragPreview.x + 10,
            top: effectiveDragPreview.y + 10,
          }}
        >
          {effectiveDragPreview.title}
        </div>
      )}
    </div>
  );
}

function DropIndicator({
  active,
  visible,
  windowDragEnabled,
}: {
  active: boolean;
  visible: boolean;
  windowDragEnabled: boolean;
}) {
  return (
    <span
      aria-hidden
      data-tauri-drag-region={windowDragEnabled ? true : undefined}
      className="flex h-7 w-2 shrink-0 items-center justify-center"
    >
      <span
        className={cn(
          "h-5 w-0.5 rounded-full transition-colors transition-opacity",
          active
            ? "bg-primary opacity-100"
            : visible
              ? "bg-border/50 opacity-70"
              : "bg-transparent opacity-0",
        )}
      />
    </span>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const url = fileIconUrl(tab.title);
    return url ? <img src={url} alt="" className="size-3.5 shrink-0" /> : null;
  }
  if (tab.kind === "preview") {
    return (
      <HugeiconsIcon
        icon={Globe02Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "ai-diff") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "git-history") {
    return (
      <HugeiconsIcon
        icon={Clock01Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "hosts-sftp") {
    return (
      <HugeiconsIcon
        icon={ServerStack02Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={14}
      strokeWidth={2}
      className="shrink-0"
    />
  );
}

function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Guards against a trailing blur re-resolving an edit that Enter/Escape
  // already finished (Escape must never commit).
  const done = useRef(false);

  useEffect(() => {
    // Focus on the next frame so it runs after the context menu restores focus
    // to its trigger when closing; a synchronous focus would be stolen.
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  // explicit = the user pressed Enter, which pins even the unchanged label. A
  // plain blur with no change must not freeze the cwd-derived default into a
  // custom title.
  const commit = (value: string, explicit: boolean) => {
    if (!explicit && value.trim() === initial.trim()) finish(onCancel);
    else finish(() => onCommit(value));
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Rename tab"
      className={cn(
        "w-28 min-w-0 rounded-sm bg-background px-1 text-xs text-foreground",
        "outline-none ring-1 ring-border focus:ring-ring",
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value, true);
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => {
        // Switching windows/apps blurs the input; keep the edit open instead
        // of resolving it on the way out.
        if (!document.hasFocus()) return;
        commit(e.currentTarget.value, false);
      }}
    />
  );
}
