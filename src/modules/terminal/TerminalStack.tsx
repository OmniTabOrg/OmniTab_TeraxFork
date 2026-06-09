import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KEY_SEP } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  getBindingTokens,
  SHORTCUTS,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";
import { MAX_PANES_PER_TAB, type Tab } from "@/modules/tabs";
import {
  GridViewIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import { useEffect, useMemo, useRef } from "react";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";
import { leafIds } from "./lib/panes";

type Props = {
  tabs: Tab[];
  activeId: number;
  /** Register/unregister handle by leaf id (not tab id). */
  registerHandle: (leafId: number, handle: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: SearchAddon) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
  onFocusLeaf: (tabId: number, leafId: number) => void;
  onToggleSidebar: () => void;
  onSplit: (dir: "row" | "col") => void;
};

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

export function TerminalStack({
  tabs,
  activeId,
  registerHandle,
  onSearchReady,
  onCwd,
  onExit,
  onFocusLeaf,
  onToggleSidebar,
  onSplit,
}: Props) {
  const terminals = useMemo(
    () => tabs.filter((t) => t.kind === "terminal"),
    [tabs],
  );

  const registerRef = useRef(registerHandle);
  const searchReadyRef = useRef(onSearchReady);
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  useEffect(() => {
    registerRef.current = registerHandle;
  }, [registerHandle]);
  useEffect(() => {
    searchReadyRef.current = onSearchReady;
  }, [onSearchReady]);
  useEffect(() => {
    cwdRef.current = onCwd;
  }, [onCwd]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  const bundles = useRef(new Map<number, Bundle>());
  const getBundle = (leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: (h) => registerRef.current(leafId, h),
        onSearch: (addon) => searchReadyRef.current(leafId, addon),
        onCwd: (cwd) => cwdRef.current(leafId, cwd),
        onExit: (code) => exitRef.current(leafId, code),
      };
      bundles.current.set(leafId, b);
    }
    return b;
  };

  useEffect(() => {
    const live = new Set<number>();
    for (const t of terminals)
      for (const id of leafIds(t.paneTree)) live.add(id);
    for (const id of bundles.current.keys()) {
      if (!live.has(id)) bundles.current.delete(id);
    }
  }, [terminals]);

  return (
    <div className="relative h-full w-full">
      {terminals.map((t) => {
        const tabVisible = t.id === activeId;
        return (
          <div
            key={t.id}
            className="absolute inset-0"
            style={{
              visibility: tabVisible ? "visible" : "hidden",
              pointerEvents: tabVisible ? "auto" : "none",
            }}
            aria-hidden={!tabVisible}
          >
            <div className="flex h-full min-h-0 flex-col">
              <TerminalTabToolbar
                canSplit={leafIds(t.paneTree).length < MAX_PANES_PER_TAB}
                onToggleSidebar={onToggleSidebar}
                onSplit={onSplit}
              />
              <div className="min-h-0 flex-1">
                <PaneTreeView
                  node={t.paneTree}
                  tabVisible={tabVisible}
                  activeLeafId={t.activeLeafId}
                  onFocusLeaf={(leafId) => onFocusLeaf(t.id, leafId)}
                  getBundle={getBundle}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TerminalTabToolbar({
  canSplit,
  onToggleSidebar,
  onSplit,
}: {
  canSplit: boolean;
  onToggleSidebar: () => void;
  onSplit: (dir: "row" | "col") => void;
}) {
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);

  const tokensFor = (id: ShortcutId): string => {
    const shortcut = SHORTCUTS.find((s) => s.id === id);
    if (!shortcut) return "";
    const bindings = userShortcuts[id] || shortcut.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join(KEY_SEP);
  };

  const splitRightTokens = tokensFor("pane.splitRight");
  const splitDownTokens = tokensFor("pane.splitDown");

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/50 bg-card/70 px-1.5">
      <Button
        onClick={onToggleSidebar}
        title="Toggle sidebar"
        variant="ghost"
        size="icon-xs"
        className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={SidebarLeftIcon} size={15} strokeWidth={1.75} />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Split terminal"
            disabled={!canSplit}
          >
            <HugeiconsIcon icon={GridViewIcon} size={14} strokeWidth={1.75} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuItem onSelect={() => onSplit("row")}>
            <HugeiconsIcon
              icon={LayoutTwoColumnIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Split right</span>
            {splitRightTokens && (
              <span className="text-xs text-muted-foreground">
                {splitRightTokens}
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSplit("col")}>
            <HugeiconsIcon
              icon={LayoutTwoRowIcon}
              size={14}
              strokeWidth={1.75}
            />
            <span className="flex-1">Split down</span>
            {splitDownTokens && (
              <span className="text-xs text-muted-foreground">
                {splitDownTokens}
              </span>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
