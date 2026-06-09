import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { AgentNotificationsBridge } from "@/modules/agents";
import { firePendingReviewForSession } from "@/modules/agents/lib/review";
import { useManagedAgentsStore } from "@/modules/agents/store/managedAgentsStore";
import { Toaster } from "@/components/ui/sonner";
import {
  AgentRunBridge,
  AiInputBar,
  AiInputBarConnect,
  AiMiniWindow,
  getAllKeys,
  getAllCustomEndpointKeys,
  hasAnyKey,
  LocalAgentNotificationsBridge,
  SelectionAskAi,
  useChatStore,
} from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { redactSensitive } from "@/modules/ai/lib/redact";
import { native } from "@/modules/ai/lib/native";
import { useAgentsStore } from "@/modules/ai/store/agentsStore";
import { useSnippetsStore } from "@/modules/ai/store/snippetsStore";
import {
  AiDiffStack,
  EditorStack,
  GitDiffStack,
  NewEditorDialog,
  type EditorPaneHandle,
} from "@/modules/editor";
import {
  GitHistoryStack,
  type GitHistorySearchHandle,
} from "@/modules/git-history";
import {
  buildSshCommand,
  HostDialog,
  HostsPanel,
  isSshPasswordPrompt,
  readSelectedSource,
  sourceForHost,
  useHostsStore,
  writeSelectedSource,
  type HostSourceValue,
  type HostProfile,
} from "@/modules/hosts";
import { getHostPassword } from "@/modules/hosts/lib/passwords";
import { getLaunchDir } from "@/lib/launchDir";
import { quoteShellArg } from "@/lib/shellQuote";
import { useZoom } from "@/lib/useZoom";
import { type FileExplorerHandle } from "@/modules/explorer";
import {
  CommandPalette,
  createCommandPaletteActions,
} from "@/modules/command-palette";
import {
  listenFsChanged,
  parentDir,
  watchAdd,
  watchRemove,
} from "@/modules/explorer/lib/watch";
import { Header } from "@/modules/header";
import { MarkdownStack } from "@/modules/markdown";
import { PreviewStack, type PreviewPaneHandle } from "@/modules/preview";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  onKeysChanged,
  setThemeId as persistThemeId,
} from "@/modules/settings/store";
import {
  ShortcutsDialog,
  useGlobalShortcuts,
  type ShortcutHandlers,
  type ShortcutId,
} from "@/modules/shortcuts";
import { SidebarRail, type SidebarViewId } from "@/modules/sidebar";
import { SourceControlPanel, useSourceControl } from "@/modules/source-control";
import { StatusBar } from "@/modules/statusbar";
import {
  TAB_DRAG_ENDED_EVENT,
  TAB_DRAG_HOVER_EVENT,
  TAB_DRAG_STARTED_EVENT,
  TAB_TRANSFER_ACCEPTED_EVENT,
  TAB_TRANSFER_EVENT,
  TAB_TRANSFER_READY_EVENT,
  parseTabTransferPayload,
  useTabs,
  useWindowTitle,
  useWorkspaceCwd,
  type Tab,
  type TabDragHoverSignal,
  type TabDragSignal,
  type TabDropEdge,
  type TabStripMetrics,
  type TabTransferAccepted,
  type TabTransferPayload,
  type TabTransferReady,
} from "@/modules/tabs";
import { labelFor } from "@/modules/tabs/lib/tabLabel";
import {
  clearFocusedTerminal,
  detachSessionForTransfer,
  disposeSession,
  findLeafCwd,
  getSessionPtyId,
  hasLeaf,
  leafHasForegroundProcess,
  leafIds,
  respawnSession,
  TerminalHostToolbar,
  TerminalStack,
  whenSessionReady,
  writeToSession,
  type TerminalPaneHandle,
  type PaneNode,
  useTerminalFileDrop,
} from "@/modules/terminal";
import { ThemeProvider } from "@/modules/theme";
import {
  listCustomThemes,
  saveCustomTheme,
} from "@/modules/theme/customThemes";
import {
  isThemeFilePath,
  onThemeEdit,
  parseThemeFile,
  starterTheme,
  themeFilePath,
  writeThemeFile,
} from "@/modules/theme/themeFiles";
import { UpdaterDialog } from "@/modules/updater";
import {
  currentWorkspaceEnv,
  getWslHome,
  LOCAL_WORKSPACE,
  useWorkspaceEnvStore,
  type WorkspaceEnv,
} from "@/modules/workspace";
import { openMainWindow } from "@/modules/windows";
import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { homeDir } from "@tauri-apps/api/path";
import { cursorPosition } from "@tauri-apps/api/window";
import {
  getAllWebviewWindows,
  getCurrentWebviewWindow,
} from "@tauri-apps/api/webviewWindow";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

type TuiWaitResult = "ready" | "gone" | "timeout";

async function waitForSshPasswordPrompt(
  readBuf: () => string | null,
  sendPassword: () => boolean,
  timeoutMs = 30000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buf = readBuf();
    if (buf === null) return;
    if (isSshPasswordPrompt(buf)) {
      sendPassword();
      return;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function waitForClaudeTuiReady(
  readBuf: () => string | null,
  timeoutMs = 8000,
): Promise<TuiWaitResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const buf = readBuf();
    if (buf === null) return "gone";
    if (buf.includes("shortcuts") || buf.includes("? for")) return "ready";
    await new Promise((r) => setTimeout(r, 120));
  }
  return "timeout";
}

function dirname(path: string | null): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE_KEY = "omnitab.sidebar.width";

function clampSidebarWidth(width: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

function readSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampSidebarWidth(parsed)
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function randomTransferId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

type PhysicalPoint = { x: number; y: number };

type ResolvedTabDropTarget = {
  windowLabel: string;
  targetId: number | null;
  edge: TabDropEdge;
};

type ExternalTabDragHover = {
  transferId: string;
  targetId: number | null;
  edge: TabDropEdge;
  preview: {
    title: string;
    x: number;
    y: number;
  };
};

type DetachedTabDragState = {
  transferId: string;
  originWindow: string;
  grabOffset: { x: number; y: number };
  floatingWindow: boolean;
  nativeWindowDrag: boolean;
};

type PendingDetachedTabDragWindow = {
  transferId: string;
  label: string;
};

type PendingDetachedTabDragHandoff = {
  transferId: string;
  targetWindow: string;
};

type PrewarmedDetachedTabDragWindow = {
  transferId: string;
  label: string | null;
  promise: Promise<string>;
  used: boolean;
};

const TAB_STRIP_SELECTOR = "[data-omnitab-tab-strip]";
const DETACHED_TAB_GRAB_OFFSET = { x: 140, y: 14 };

function rectContainsPoint(
  rect: { x: number; y: number; width: number; height: number },
  point: PhysicalPoint,
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function resolveTabDropTarget(
  point: PhysicalPoint,
  metrics: TabStripMetrics[],
  liveLabels: Set<string>,
): ResolvedTabDropTarget | null {
  for (const metric of metrics) {
    if (!liveLabels.has(metric.windowLabel)) continue;
    if (!rectContainsPoint(metric.strip, point)) continue;
    const tabs = metric.tabs
      .filter(
        (tab) =>
          tab.width > 0 &&
          tab.height > 0 &&
          tab.x + tab.width >= metric.strip.x &&
          tab.x <= metric.strip.x + metric.strip.width,
      )
      .sort((a, b) => a.x - b.x);
    if (tabs.length === 0) {
      return {
        windowLabel: metric.windowLabel,
        targetId: null,
        edge: "after",
      };
    }
    for (const tab of tabs) {
      if (point.x < tab.x + tab.width / 2) {
        return {
          windowLabel: metric.windowLabel,
          targetId: tab.id,
          edge: "before",
        };
      }
    }
    return {
      windowLabel: metric.windowLabel,
      targetId: null,
      edge: "after",
    };
  }
  return null;
}

function tabPrimaryCwd(tab: Tab): string | null {
  if (tab.kind !== "terminal") return null;
  return findLeafCwd(tab.paneTree, tab.activeLeafId) ?? tab.cwd ?? null;
}

function tabWithPtyIds(tab: Tab): Tab {
  if (tab.kind !== "terminal") return tab;
  const withPtyIds = (node: PaneNode): PaneNode => {
    if (node.kind === "leaf") {
      const ptyId = getSessionPtyId(node.id);
      return ptyId === null ? node : { ...node, ptyId };
    }
    return { ...node, children: node.children.map(withPtyIds) };
  };
  return { ...tab, paneTree: withPtyIds(tab.paneTree) };
}

export default function App() {
  const {
    tabs,
    activeId,
    setActiveId,
    newTab,
    newAgentTab,
    newHostShellTab,
    openFileTab,
    pinTab,
    newPreviewTab,
    newMarkdownTab,
    openAiDiffTab,
    closeAiDiffTab,
    openGitDiffTab,
    openCommitHistoryTab,
    openCommitFileDiffTab,
    closeTab,
    removeTabWithoutDisposing,
    moveTab,
    adoptTransferredTab,
    updateTab,
    selectByIndex,
    setLeafCwd,
    focusPane,
    focusNextPaneInTab,
    closeActivePane,
    closePaneByLeaf,
    resetWorkspace,
  } = useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined);

  // Mirror `tabs` into a ref so callbacks scheduled with `setTimeout`
  // (e.g. cdInNewTab) read the latest pane state instead of a stale closure.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const currentWindowRef = useRef(getCurrentWebviewWindow());
  const currentWindowLabel = currentWindowRef.current.label;
  const pendingTransfersRef = useRef(
    new Map<
      string,
      {
        tabId: number;
        payload: TabTransferPayload;
      }
    >(),
  );
  const pendingNewWindowTransfersRef = useRef(
    new Map<string, TabTransferPayload>(),
  );
  const acceptedTransfersRef = useRef(new Set<string>());
  const finishingTransfersRef = useRef(new Set<string>());
  const [tabDragActive, setTabDragActive] = useState(false);
  const tabDragActiveRef = useRef(false);
  const activeDragTransferIdRef = useRef<string | null>(null);
  const focusedTabDragTargetRef = useRef<string | null>(null);
  const detachedTabDragRef = useRef<DetachedTabDragState | null>(null);
  const openingDetachedTabDragRef = useRef<string | null>(null);
  const pendingDetachedTabDragWindowRef =
    useRef<PendingDetachedTabDragWindow | null>(null);
  const pendingDetachedTabDragHandoffRef =
    useRef<PendingDetachedTabDragHandoff | null>(null);
  const prewarmedDetachedTabDragWindowRef =
    useRef<PrewarmedDetachedTabDragWindow | null>(null);
  const [externalTabDragHover, setExternalTabDragHover] =
    useState<ExternalTabDragHover | null>(null);
  const externalTabDragHoverRef = useRef<ExternalTabDragHover | null>(null);

  const activeTerminalTab = useMemo(() => {
    const t = tabs.find((x) => x.id === activeId);
    return t && t.kind === "terminal" ? t : null;
  }, [tabs, activeId]);
  const activeLeafId = activeTerminalTab?.activeLeafId ?? null;

  const terminalRefs = useRef<Map<number, TerminalPaneHandle>>(new Map());
  const editorRefs = useRef<Map<number, EditorPaneHandle>>(new Map());
  const previewRefs = useRef<Map<number, PreviewPaneHandle>>(new Map());
  const [, setActiveEditorHandle] = useState<EditorPaneHandle | null>(null);
  const [, setGitHistoryHandle] = useState<GitHistorySearchHandle | null>(null);
  const { zoomIn, zoomOut, zoomReset } = useZoom();
  useTerminalFileDrop();
  const explorerRef = useRef<FileExplorerHandle>(null);
  const explorerReturnFocusRef = useRef<HTMLElement | null>(null);

  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarWidthRef = useRef(readSidebarWidth());
  const sidebarWidthWriteTimerRef = useRef(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarViewByTerminalTab, setSidebarViewByTerminalTab] = useState<
    Record<number, SidebarViewId>
  >({});
  const activeTerminalTabId = activeTerminalTab?.id ?? null;
  const sidebarView =
    activeTerminalTabId !== null
      ? (sidebarViewByTerminalTab[activeTerminalTabId] ?? "explorer")
      : "explorer";
  const setActiveTerminalSidebarView = useCallback(
    (view: SidebarViewId) => {
      if (activeTerminalTabId === null) return;
      setSidebarViewByTerminalTab((current) =>
        current[activeTerminalTabId] === view
          ? current
          : { ...current, [activeTerminalTabId]: view },
      );
    },
    [activeTerminalTabId],
  );
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);
  const cycleSidebarView = useCallback(
    (view: SidebarViewId) => {
      if (sidebarCollapsed) {
        setSidebarCollapsed(false);
        if (view !== sidebarView) setActiveTerminalSidebarView(view);
        return;
      }
      if (view === sidebarView) {
        setSidebarCollapsed(true);
        return;
      }
      setActiveTerminalSidebarView(view);
    },
    [setActiveTerminalSidebarView, sidebarCollapsed, sidebarView],
  );
  const persistSidebarWidth = useCallback((next: number) => {
    sidebarWidthRef.current = next;
    if (sidebarWidthWriteTimerRef.current) {
      window.clearTimeout(sidebarWidthWriteTimerRef.current);
    }
    sidebarWidthWriteTimerRef.current = window.setTimeout(() => {
      sidebarWidthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
    }, 200);
  }, []);
  useEffect(() => {
    return () => {
      if (sidebarWidthWriteTimerRef.current) {
        window.clearTimeout(sidebarWidthWriteTimerRef.current);
      }
    };
  }, []);

  const toggleExplorerFocus = useCallback(() => {
    const explorer = explorerRef.current;
    if (sidebarView !== "explorer" || sidebarCollapsed) {
      if (sidebarCollapsed) setSidebarCollapsed(false);
      if (sidebarView !== "explorer")
        setActiveTerminalSidebarView("explorer");
      const active = document.activeElement;
      explorerReturnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      requestAnimationFrame(() => explorerRef.current?.focus());
      return;
    }
    if (!explorer) return;
    if (explorer.isFocused()) {
      const target = explorerReturnFocusRef.current;
      explorerReturnFocusRef.current = null;
      if (target && document.body.contains(target)) {
        target.focus();
      } else {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    const active = document.activeElement;
    explorerReturnFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    explorer.focus();
  }, [setActiveTerminalSidebarView, sidebarCollapsed, sidebarView]);

  const [home, setHome] = useState<string | null>(null);
  const [pendingCloseTab, setPendingCloseTab] = useState<number | null>(null);
  const [pendingTerminalCloseTab, setPendingTerminalCloseTab] = useState<
    number | null
  >(null);
  const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
  const setWorkspaceEnv = useWorkspaceEnvStore((s) => s.setEnv);
  const [launchCwd, setLaunchCwd] = useState<string | null>(null);
  const [launchCwdResolved, setLaunchCwdResolved] = useState(false);
  const [pendingDeleteTabs, setPendingDeleteTabs] = useState<number[] | null>(
    null,
  );
  useEffect(() => {
    homeDir()
      .then(async (p) => {
        const normalized = p.replace(/\\/g, "/");
        setHome(normalized);
        try {
          await native.workspaceAuthorize(normalized);
        } catch {
          // Bootstrap already authorizes home from Rust; ignore.
        }
      })
      .catch(() => setHome(null));
  }, []);

  const switchWorkspace = useCallback(
    async (env: WorkspaceEnv) => {
      if (
        env.kind === workspaceEnv.kind &&
        (env.kind === "local" ||
          (workspaceEnv.kind === "wsl" && env.distro === workspaceEnv.distro))
      ) {
        return;
      }
      const dirty = tabsRef.current.some((t) => t.kind === "editor" && t.dirty);
      if (dirty) {
        window.alert(
          "Save or close unsaved editor tabs before switching workspace.",
        );
        return;
      }

      let nextHome: string | null = null;
      try {
        if (env.kind === "wsl") {
          nextHome = await getWslHome(env.distro);
        } else {
          nextHome = (await homeDir()).replace(/\\/g, "/");
        }
      } catch (e) {
        window.alert(String(e));
        return;
      }

      for (const id of liveLeavesRef.current) disposeSession(id);
      terminalRefs.current.clear();
      editorRefs.current.clear();
      previewRefs.current.clear();
      setActiveEditorHandle(null);
      setWorkspaceEnv(env.kind === "local" ? LOCAL_WORKSPACE : env);
      setHome(nextHome);
      setLaunchCwd(nextHome);
      if (nextHome) {
        try {
          await native.workspaceAuthorize(nextHome);
        } catch {
          // Non-fatal — git panel will surface "not authorized" if needed.
        }
      }
      resetWorkspace(nextHome ?? undefined);
    },
    [workspaceEnv, setWorkspaceEnv, resetWorkspace],
  );
  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null))
      .finally(() => setLaunchCwdResolved(true));
  }, []);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newEditorOpen, setNewEditorOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [selectedHostSource, setSelectedHostSource] =
    useState<HostSourceValue>(readSelectedSource);
  const [creatingHost, setCreatingHost] = useState(false);
  const [editingHost, setEditingHost] = useState<HostProfile | null>(null);
  const miniOpen = useChatStore((s) => s.mini.open);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const openMini = useChatStore((s) => s.openMini);
  const focusInput = useChatStore((s) => s.focusInput);
  const openPanel = useChatStore((s) => s.openPanel);
  const panelOpen = useChatStore((s) => s.panelOpen);
  const apiKeys = useChatStore((s) => s.apiKeys);
  const setApiKeys = useChatStore((s) => s.setApiKeys);
  const setCustomEndpointKeys = useChatStore((s) => s.setCustomEndpointKeys);
  const setSelectedModelId = useChatStore((s) => s.setSelectedModelId);
  const setLive = useChatStore((s) => s.setLive);
  const respondToApproval = useChatStore((s) => s.respondToApproval);
  const hosts = useHostsStore((s) => s.hosts);
  const hostsHydrated = useHostsStore((s) => s.hydrated);

  useEffect(() => {
    if (activeSessionId) firePendingReviewForSession(activeSessionId);
  }, [activeSessionId]);
  const lmstudioModelId = usePreferencesStore((s) => s.lmstudioModelId);
  const lmstudioBaseURL = usePreferencesStore((s) => s.lmstudioBaseURL);
  const mlxModelId = usePreferencesStore((s) => s.mlxModelId);
  const mlxBaseURL = usePreferencesStore((s) => s.mlxBaseURL);
  const ollamaModelId = usePreferencesStore((s) => s.ollamaModelId);
  const ollamaBaseURL = usePreferencesStore((s) => s.ollamaBaseURL);
  const openaiCompatibleModelId = usePreferencesStore(
    (s) => s.openaiCompatibleModelId,
  );
  const openaiCompatibleBaseURL = usePreferencesStore(
    (s) => s.openaiCompatibleBaseURL,
  );
  const customEndpoints = usePreferencesStore((s) => s.customEndpoints);
  const hasLocalModel =
    (lmstudioBaseURL.trim().length > 0 && lmstudioModelId.trim().length > 0) ||
    (mlxBaseURL.trim().length > 0 && mlxModelId.trim().length > 0) ||
    (ollamaBaseURL.trim().length > 0 && ollamaModelId.trim().length > 0) ||
    (openaiCompatibleBaseURL.trim().length > 0 &&
      openaiCompatibleModelId.trim().length > 0) ||
    customEndpoints.some(
      (e) => e.baseURL.trim().length > 0 && e.modelId.trim().length > 0,
    );
  const hasComposer = hasAnyKey(apiKeys) || hasLocalModel;

  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const [keysLoaded, setKeysLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const reload = () => {
      void getAllKeys().then((keys) => {
        if (!alive) return;
        setApiKeys(keys);
        setKeysLoaded(true);
      });
      if (!prefsHydrated) return;
      void getAllCustomEndpointKeys(
        usePreferencesStore.getState().customEndpoints,
      ).then((epKeys) => {
        if (!alive) return;
        setCustomEndpointKeys(epKeys);
      });
    };
    reload();
    const unlistenP = onKeysChanged(reload);
    return () => {
      alive = false;
      void unlistenP.then((fn) => fn());
    };
  }, [setApiKeys, setCustomEndpointKeys, prefsHydrated]);

  // Hydrate the cross-window preference store and mirror the default model
  // into chatStore so the dropdown reflects what the user picked in Settings.
  const initPrefs = usePreferencesStore((s) => s.init);
  const prefDefaultModel = usePreferencesStore((s) => s.defaultModelId);
  useEffect(() => {
    void initPrefs();
  }, [initPrefs]);
  useEffect(() => {
    if (!prefsHydrated) return;
    setSelectedModelId(prefDefaultModel);
  }, [prefsHydrated, prefDefaultModel, setSelectedModelId]);

  const hydrateSessions = useChatStore((s) => s.hydrateSessions);
  useEffect(() => {
    void hydrateSessions();
    void useAgentsStore.getState().hydrate();
    void useSnippetsStore.getState().hydrate();
    void useHostsStore.getState().hydrate();
  }, [hydrateSessions]);

  const activeTab = tabs.find((t) => t.id === activeId);
  const isTerminalTab = activeTab?.kind === "terminal";
  const isEditorTab = activeTab?.kind === "editor";
  const isPreviewTab = activeTab?.kind === "preview";
  const isMarkdownTab = activeTab?.kind === "markdown";
  const isAiDiffTab = activeTab?.kind === "ai-diff";
  const isGitDiffTab =
    activeTab?.kind === "git-diff" || activeTab?.kind === "git-commit-file";
  const isGitHistoryTab = activeTab?.kind === "git-history";

  // When an AI diff is approved (write_file applied to disk), reload any
  // open editor tabs for that path so the user sees the new content. We
  // track which approvalIds we've already handled to fire the reload only
  // once per applied diff.
  const appliedDiffsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind !== "ai-diff") continue;
      if (t.status !== "approved") continue;
      if (appliedDiffsRef.current.has(t.approvalId)) continue;
      appliedDiffsRef.current.add(t.approvalId);
      for (const e of tabs) {
        if (e.kind !== "editor") continue;
        if (e.path !== t.path) continue;
        editorRefs.current.get(e.id)?.reload();
      }
    }
  }, [tabs]);

  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source === "editor") return;
          const normalizedPath = event.payload.path.replace(/\\/g, "/");
          const currentTabs = tabsRef.current;
          for (const t of currentTabs) {
            if (t.kind !== "editor") continue;
            if (t.path.replace(/\\/g, "/") === normalizedPath) {
              editorRefs.current.get(t.id)?.reload();
            }
          }
        },
      );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  const editorWatchRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const want = new Set<string>();
    for (const t of tabs) if (t.kind === "editor") want.add(parentDir(t.path));
    const prev = editorWatchRef.current;
    const toAdd = [...want].filter((d) => !prev.has(d));
    const toRemove = [...prev].filter((d) => !want.has(d));
    watchAdd(toAdd);
    watchRemove(toRemove);
    editorWatchRef.current = want;
  }, [tabs]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listenFsChanged((paths) => {
      const changed = new Set(paths.map((p) => p.replace(/\\/g, "/")));
      for (const t of tabsRef.current) {
        if (t.kind !== "editor") continue;
        if (changed.has(t.path.replace(/\\/g, "/"))) {
          editorRefs.current.get(t.id)?.reload();
        }
      }
    }).then((un) => {
      if (alive) unlisten = un;
      else un();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // Theme editing: a custom theme is materialized to a real file and edited in
  // the code editor. Saving it re-ingests into the runtime store + applies live.
  useEffect(() => {
    type FileWrittenPayload = { path: string; source?: string };
    const unlistenPromise =
      getCurrentWebviewWindow().listen<FileWrittenPayload>(
        "fs:file-written",
        (event) => {
          if (event.payload.source !== "editor") return;
          if (!isThemeFilePath(event.payload.path)) return;
          void (async () => {
            try {
              const res = await invoke<{ kind: string; content?: string }>(
                "fs_read_file",
                { path: event.payload.path, workspace: currentWorkspaceEnv() },
              );
              if (res.kind !== "text" || typeof res.content !== "string")
                return;
              const parsed = parseThemeFile(res.content);
              if (!parsed.ok) {
                console.warn("[omnitab] theme not applied:", parsed.error);
                return;
              }
              await saveCustomTheme(parsed.theme);
            } catch (e) {
              console.warn("[omnitab] theme ingest failed:", e);
            }
          })();
        },
      );
    return () => {
      void unlistenPromise.then((un) => un());
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    void onThemeEdit(async (req) => {
      const theme =
        req.action === "create"
          ? starterTheme()
          : (await listCustomThemes()).find((t) => t.id === req.id);
      if (!theme) return;
      if (req.action === "create") await saveCustomTheme(theme);
      const path = await themeFilePath(theme.id);
      const open = tabsRef.current.some(
        (t) => t.kind === "editor" && t.path === path,
      );
      if (!open) await writeThemeFile(theme);
      void persistThemeId(theme.id);
      openFileTab(path);
      void getCurrentWebviewWindow().setFocus();
    }).then((fn) => {
      if (alive) unsub = fn;
      else fn();
    });
    return () => {
      alive = false;
      unsub?.();
    };
  }, [openFileTab]);

  const { explorerRoot, inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    launchCwd ?? home,
  );

  useWindowTitle(activeTab, explorerRoot);

  useEffect(() => {
    setActiveEditorHandle(editorRefs.current.get(activeId) ?? null);
  }, [activeId]);

  const handleSearchReady = useCallback(() => {}, []);

  const closeCurrentWindow = useCallback(() => {
    void currentWindowRef.current.close().catch((e) => {
      console.error("[omnitab] window close failed:", e);
    });
  }, []);

  const updateExternalTabDragHover = useCallback(
    (hover: ExternalTabDragHover | null) => {
      externalTabDragHoverRef.current = hover;
      setExternalTabDragHover(hover);
    },
    [],
  );

  const closePrewarmedDetachedWindow = useCallback((transferId: string) => {
    const prewarmed = prewarmedDetachedTabDragWindowRef.current;
    if (!prewarmed || prewarmed.transferId !== transferId || prewarmed.used) {
      return;
    }
    prewarmedDetachedTabDragWindowRef.current = null;
    void prewarmed.promise
      .then(async (label) => {
        const windows = await getAllWebviewWindows();
        await windows
          .find((w) => w.label === label)
          ?.close()
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  const setGlobalTabDragActive = useCallback(
    (transferId: string | null, active: boolean) => {
      activeDragTransferIdRef.current = active ? transferId : null;
      tabDragActiveRef.current = active;
      setTabDragActive(active);
      if (!active) {
        focusedTabDragTargetRef.current = null;
        detachedTabDragRef.current = null;
        openingDetachedTabDragRef.current = null;
        pendingDetachedTabDragWindowRef.current = null;
        pendingDetachedTabDragHandoffRef.current = null;
        prewarmedDetachedTabDragWindowRef.current = null;
        updateExternalTabDragHover(null);
      }
    },
    [updateExternalTabDragHover],
  );

  const startGlobalTabDrag = useCallback(
    (payload: TabTransferPayload, raw: string) => {
      setGlobalTabDragActive(payload.transferId, true);
      void invoke("tab_drag_start", {
        transferId: payload.transferId,
        payload: raw,
      });
      void emit<TabDragSignal>(TAB_DRAG_STARTED_EVENT, {
        transferId: payload.transferId,
        sourceWindow: currentWindowLabel,
      });
    },
    [currentWindowLabel, setGlobalTabDragActive],
  );

  const endGlobalTabDrag = useCallback(
    (transferId: string) => {
      closePrewarmedDetachedWindow(transferId);
      if (activeDragTransferIdRef.current === transferId) {
        setGlobalTabDragActive(null, false);
      }
      void invoke("tab_drag_end", { transferId });
      void emit<TabDragSignal>(TAB_DRAG_ENDED_EVENT, {
        transferId,
        sourceWindow: currentWindowLabel,
      });
    },
    [closePrewarmedDetachedWindow, currentWindowLabel, setGlobalTabDragActive],
  );

  const handoffDetachedTabDrag = useCallback(
    async (
      payload: TabTransferPayload,
      target: ResolvedTabDropTarget,
    ): Promise<boolean> => {
      const detached = detachedTabDragRef.current;
      if (!detached || detached.transferId !== payload.transferId) {
        return false;
      }
      if (
        pendingDetachedTabDragHandoffRef.current?.transferId ===
          payload.transferId &&
        pendingDetachedTabDragHandoffRef.current.targetWindow ===
          target.windowLabel
      ) {
        return true;
      }
      pendingDetachedTabDragHandoffRef.current = {
        transferId: payload.transferId,
        targetWindow: target.windowLabel,
      };
      const targetedPayload: TabTransferPayload = {
        ...payload,
        sourceWindow: currentWindowLabel,
        targetTabId: target.targetId,
        targetEdge: target.edge,
        replaceTargetTabs: false,
        detachedDrag: {
          originWindow: detached.originWindow,
          grabOffset: detached.grabOffset,
          floatingWindow: false,
        },
      };
      try {
        await emitTo<TabTransferPayload>(
          target.windowLabel,
          TAB_TRANSFER_EVENT,
          targetedPayload,
        );
        return true;
      } catch (e) {
        pendingDetachedTabDragHandoffRef.current = null;
        console.warn("[omnitab] detached tab handoff failed:", e);
        return false;
      }
    },
    [currentWindowLabel],
  );

  const publishTabDragHover = useCallback(
    async (payload: TabTransferPayload) => {
      try {
        const [cursor, storedMetrics, allWindows] = await Promise.all([
          cursorPosition(),
          invoke<TabStripMetrics[]>("tab_drag_metrics"),
          getAllWebviewWindows(),
        ]);
        const point: PhysicalPoint = { x: cursor.x, y: cursor.y };
        const liveLabels = new Set(allWindows.map((w) => w.label));
        const detachedDrag =
          detachedTabDragRef.current?.transferId === payload.transferId
            ? detachedTabDragRef.current
            : null;
        const metricsForDrop = detachedDrag?.floatingWindow
          ? storedMetrics.filter(
              (metric) => metric.windowLabel !== currentWindowLabel,
            )
          : storedMetrics;
        const tabStripLabels = new Set(
          metricsForDrop
            .map((metric) => metric.windowLabel)
            .filter((label) => liveLabels.has(label)),
        );
        const windowContainsPoint = async (
          win: (typeof allWindows)[number],
        ) => {
          const [position, size] = await Promise.all([
            win.outerPosition(),
            win.outerSize(),
          ]);
          return rectContainsPoint(
            {
              x: position.x,
              y: position.y,
              width: size.width,
              height: size.height,
            },
            point,
          );
        };
        const currentWindow = allWindows.find(
          (w) => w.label === currentWindowLabel,
        );
        const insideCurrentWindow = currentWindow
          ? await windowContainsPoint(currentWindow)
          : false;
        if (detachedDrag?.floatingWindow) {
          focusedTabDragTargetRef.current = null;
          const target = resolveTabDropTarget(
            point,
            metricsForDrop,
            liveLabels,
          );
          if (target) {
            await handoffDetachedTabDrag(payload, target);
            return;
          }
          const signal: TabDragHoverSignal = {
            transferId: payload.transferId,
            sourceWindow: payload.sourceWindow,
            targetWindow: null,
            targetTabId: null,
            targetEdge: "after",
            point,
            title: labelFor(payload.tab),
          };
          void emit<TabDragHoverSignal>(TAB_DRAG_HOVER_EVENT, signal);
          return;
        }
        if (insideCurrentWindow) {
          focusedTabDragTargetRef.current = null;
        } else {
          const focusTargets = await Promise.all(
            allWindows
              .filter(
                (w) =>
                  w.label !== currentWindowLabel && tabStripLabels.has(w.label),
              )
              .map(async (w) => {
                const [visible, contains] = await Promise.all([
                  w.isVisible().catch(() => true),
                  windowContainsPoint(w),
                ]);
                return visible && contains ? w : null;
              }),
          );
          const focusTarget = focusTargets.find((w) => w !== null);
          if (!focusTarget) {
            focusedTabDragTargetRef.current = null;
          } else if (focusedTabDragTargetRef.current !== focusTarget.label) {
            focusedTabDragTargetRef.current = focusTarget.label;
            void focusTarget.setFocus().catch((e) => {
              console.warn("[omnitab] tab drag target focus failed:", e);
            });
          }
        }
        const target = resolveTabDropTarget(point, metricsForDrop, liveLabels);
        if (
          (!detachedDrag || !detachedDrag.floatingWindow) &&
          target?.windowLabel === currentWindowLabel &&
          payload.sourceWindow === currentWindowLabel
        ) {
          moveTab(payload.sourceTabId, target.targetId, target.edge);
        }
        const signal: TabDragHoverSignal = {
          transferId: payload.transferId,
          sourceWindow: payload.sourceWindow,
          targetWindow: target?.windowLabel ?? null,
          targetTabId: target?.targetId ?? null,
          targetEdge: target?.edge ?? "after",
          point,
          title: labelFor(payload.tab),
        };
        void emit<TabDragHoverSignal>(TAB_DRAG_HOVER_EVENT, signal);
      } catch (e) {
        console.warn("[omnitab] tab drag hover failed:", e);
      }
    },
    [currentWindowLabel, handoffDetachedTabDrag, moveTab],
  );

  const applyTabDragHover = useCallback(
    async (signal: TabDragHoverSignal) => {
      if (activeDragTransferIdRef.current !== signal.transferId) return;
      if (signal.targetWindow !== currentWindowLabel) {
        if (externalTabDragHoverRef.current?.transferId === signal.transferId) {
          updateExternalTabDragHover(null);
        }
        return;
      }
      try {
        const [innerPosition, scaleFactor] = await Promise.all([
          currentWindowRef.current.innerPosition(),
          currentWindowRef.current.scaleFactor(),
        ]);
        if (activeDragTransferIdRef.current !== signal.transferId) return;
        if (signal.targetWindow !== currentWindowLabel) return;
        updateExternalTabDragHover({
          transferId: signal.transferId,
          targetId: signal.targetTabId,
          edge: signal.targetEdge,
          preview: {
            title: signal.title,
            x: (signal.point.x - innerPosition.x) / scaleFactor,
            y: (signal.point.y - innerPosition.y) / scaleFactor,
          },
        });
      } catch (e) {
        console.warn("[omnitab] tab drag hover display failed:", e);
      }
    },
    [currentWindowLabel, updateExternalTabDragHover],
  );

  useEffect(() => {
    const isTabDropZone = (target: EventTarget | null) =>
      !!(target as HTMLElement | null)?.closest?.(
        "[data-omnitab-tab-drop-zone]",
      );

    const onDragOver = (e: DragEvent) => {
      if (!tabDragActiveRef.current || isTabDropZone(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };

    const onDrop = (e: DragEvent) => {
      if (!tabDragActiveRef.current || isTabDropZone(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, []);

  const disposeLastTabAndCloseWindow = useCallback(
    (tab: Tab) => {
      editorRefs.current.delete(tab.id);
      previewRefs.current.delete(tab.id);
      if (tab.kind === "terminal") {
        for (const leafId of leafIds(tab.paneTree)) disposeSession(leafId);
      }
      closeCurrentWindow();
    },
    [closeCurrentWindow],
  );

  const disposeTab = useCallback(
    (id: number) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      // Terminal-leaf-keyed maps are pruned by the effect below as the pane
      // tree changes; only the tab-id-keyed handles need explicit cleanup here.
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      if (tabsRef.current.length <= 1) {
        disposeLastTabAndCloseWindow(tab);
        return;
      }
      closeTab(id);
    },
    [closeTab, disposeLastTabAndCloseWindow],
  );

  const detachTransferredTab = useCallback(
    (id: number) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      editorRefs.current.delete(id);
      previewRefs.current.delete(id);
      if (tab.kind === "terminal") {
        for (const leafId of leafIds(tab.paneTree)) {
          detachSessionForTransfer(leafId);
        }
      }
      if (tabsRef.current.length <= 1) {
        closeCurrentWindow();
        return;
      }
      removeTabWithoutDisposing(id);
    },
    [closeCurrentWindow, removeTabWithoutDisposing],
  );

  const prepareTabTransfer = useCallback(
    (id: number): string | null => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return null;
      if (tab.kind === "editor" && tab.dirty) {
        window.alert("Save or close unsaved editor tabs before moving them.");
        return null;
      }
      const transferId = randomTransferId();
      const payload: TabTransferPayload = {
        schema: 1,
        transferId,
        sourceWindow: currentWindowLabel,
        sourceTabId: id,
        tab: tabWithPtyIds(tab),
      };
      const raw = JSON.stringify(payload);
      pendingTransfersRef.current.set(transferId, { tabId: id, payload });
      if (tabsRef.current.length > 1) {
        const cwd = tabPrimaryCwd(payload.tab) ?? inheritedCwdForNewTab();
        const prewarmed: PrewarmedDetachedTabDragWindow = {
          transferId,
          label: null,
          used: false,
          promise: openMainWindow(cwd, {
            detachedDrag: true,
            deferShow: true,
          }),
        };
        prewarmed.promise
          .then((label) => {
            if (
              prewarmedDetachedTabDragWindowRef.current?.transferId ===
              transferId
            ) {
              prewarmed.label = label;
            } else if (!prewarmed.used) {
              void getAllWebviewWindows()
                .then((windows) =>
                  windows.find((w) => w.label === label)?.close(),
                )
                .catch(() => {});
            }
          })
          .catch((e) => {
            if (
              prewarmedDetachedTabDragWindowRef.current?.transferId ===
              transferId
            ) {
              prewarmedDetachedTabDragWindowRef.current = null;
            }
            console.warn("[omnitab] prewarm detached tab window failed:", e);
          });
        prewarmedDetachedTabDragWindowRef.current = prewarmed;
      }
      startGlobalTabDrag(payload, raw);
      return raw;
    },
    [currentWindowLabel, inheritedCwdForNewTab, startGlobalTabDrag],
  );

  const acceptTransferredTab = useCallback(
    (
      payload: TabTransferPayload,
      targetId: number | null,
      edge: TabDropEdge,
    ) => {
      if (payload.sourceWindow === currentWindowLabel) {
        moveTab(payload.sourceTabId, targetId, edge);
        pendingTransfersRef.current.delete(payload.transferId);
        endGlobalTabDrag(payload.transferId);
        return;
      }
      if (acceptedTransfersRef.current.has(payload.transferId)) return;
      acceptedTransfersRef.current.add(payload.transferId);
      const adoptedId = adoptTransferredTab(
        payload.tab,
        targetId,
        edge,
        payload.replaceTargetTabs === true,
      );
      if (payload.detachedDrag) {
        const ownerPayload: TabTransferPayload = {
          ...payload,
          sourceWindow: currentWindowLabel,
          sourceTabId: adoptedId,
          targetTabId: undefined,
          targetEdge: undefined,
          replaceTargetTabs: false,
          detachedDrag: undefined,
        };
        pendingTransfersRef.current.set(payload.transferId, {
          tabId: adoptedId,
          payload: ownerPayload,
        });
        if (payload.detachedDrag.floatingWindow !== false) {
          detachedTabDragRef.current = {
            transferId: payload.transferId,
            originWindow: payload.detachedDrag.originWindow,
            grabOffset: payload.detachedDrag.grabOffset,
            floatingWindow: true,
            nativeWindowDrag: true,
          };
          void currentWindowRef.current
            .show()
            .then(() => currentWindowRef.current.startDragging())
            .catch((e) => {
              const current = detachedTabDragRef.current;
              if (current?.transferId === payload.transferId) {
                current.nativeWindowDrag = false;
              }
              console.warn("[omnitab] detached tab window drag failed:", e);
            });
        } else {
          detachedTabDragRef.current = {
            transferId: payload.transferId,
            originWindow: payload.detachedDrag.originWindow,
            grabOffset: payload.detachedDrag.grabOffset,
            floatingWindow: false,
            nativeWindowDrag: false,
          };
        }
        startGlobalTabDrag(ownerPayload, JSON.stringify(ownerPayload));
      }
      void currentWindowRef.current.setFocus().catch((e) => {
        console.warn("[omnitab] accepted tab transfer focus failed:", e);
      });
      void emitTo<TabTransferAccepted>(
        payload.sourceWindow,
        TAB_TRANSFER_ACCEPTED_EVENT,
        { transferId: payload.transferId, targetWindow: currentWindowLabel },
      );
    },
    [
      adoptTransferredTab,
      currentWindowLabel,
      endGlobalTabDrag,
      moveTab,
      startGlobalTabDrag,
    ],
  );

  const detachedWindowGrabOffsetForTab = useCallback(
    async (
      tabId: number,
      point: PhysicalPoint,
    ): Promise<{ x: number; y: number }> => {
      const strip = document.querySelector<HTMLElement>(TAB_STRIP_SELECTOR);
      const tabEl = strip?.querySelector<HTMLElement>(
        `[data-tab-id="${tabId}"]`,
      );
      if (!strip || !tabEl) return DETACHED_TAB_GRAB_OFFSET;

      try {
        const [outerPosition, innerPosition, scaleFactor] = await Promise.all([
          currentWindowRef.current.outerPosition(),
          currentWindowRef.current.innerPosition(),
          currentWindowRef.current.scaleFactor(),
        ]);
        const stripRect = strip.getBoundingClientRect();
        const tabRect = tabEl.getBoundingClientRect();
        const tabScreenX = innerPosition.x + tabRect.left * scaleFactor;
        const tabScreenY = innerPosition.y + tabRect.top * scaleFactor;
        const offsetInsideTab = {
          x: Math.max(
            0,
            Math.min(tabRect.width * scaleFactor, point.x - tabScreenX),
          ),
          y: Math.max(
            0,
            Math.min(tabRect.height * scaleFactor, point.y - tabScreenY),
          ),
        };
        return {
          x:
            innerPosition.x -
            outerPosition.x +
            stripRect.left * scaleFactor +
            offsetInsideTab.x,
          y:
            innerPosition.y -
            outerPosition.y +
            stripRect.top * scaleFactor +
            offsetInsideTab.y,
        };
      } catch (e) {
        console.warn("[omnitab] detached tab grab offset failed:", e);
        return DETACHED_TAB_GRAB_OFFSET;
      }
    },
    [],
  );

  const completeTabDragAtPointer = useCallback(
    async (payload: TabTransferPayload): Promise<boolean> => {
      if (!pendingTransfersRef.current.has(payload.transferId)) return true;
      let point: PhysicalPoint;
      let metrics: TabStripMetrics[];
      let liveLabels: Set<string>;
      let windows: Awaited<ReturnType<typeof getAllWebviewWindows>>;
      try {
        const [cursor, storedMetrics, allWindows] = await Promise.all([
          cursorPosition(),
          invoke<TabStripMetrics[]>("tab_drag_metrics"),
          getAllWebviewWindows(),
        ]);
        point = { x: cursor.x, y: cursor.y };
        metrics = storedMetrics;
        windows = allWindows;
        liveLabels = new Set(allWindows.map((w) => w.label));
      } catch (e) {
        console.warn("[omnitab] tab drag hit-test failed:", e);
        return false;
      }
      const metricsForDrop =
        detachedTabDragRef.current?.transferId === payload.transferId &&
        detachedTabDragRef.current.floatingWindow
          ? metrics.filter(
              (metric) => metric.windowLabel !== currentWindowLabel,
            )
          : metrics;
      const target = resolveTabDropTarget(point, metricsForDrop, liveLabels);
      if (!target) return false;
      const targetedPayload: TabTransferPayload = {
        ...payload,
        targetTabId: target.targetId,
        targetEdge: target.edge,
      };
      if (target.windowLabel === currentWindowLabel) {
        acceptTransferredTab(targetedPayload, target.targetId, target.edge);
        return true;
      }
      try {
        await emitTo<TabTransferPayload>(
          target.windowLabel,
          TAB_TRANSFER_EVENT,
          targetedPayload,
        );
        void windows.find((w) => w.label === target.windowLabel)?.setFocus();
        return true;
      } catch (e) {
        console.warn("[omnitab] tab transfer emit failed:", e);
        return false;
      }
    },
    [acceptTransferredTab, currentWindowLabel],
  );

  const detachTabIntoNewWindow = useCallback(
    async (
      payload: TabTransferPayload,
      options: {
        continueDrag?: boolean;
        point?: PhysicalPoint;
        grabOffset?: { x: number; y: number };
      } = {},
    ): Promise<boolean> => {
      const pending = pendingTransfersRef.current.get(payload.transferId);
      if (!pending) return true;
      const cwd = tabPrimaryCwd(pending.payload.tab) ?? inheritedCwdForNewTab();
      const grabOffset = options.continueDrag
        ? (options.grabOffset ?? DETACHED_TAB_GRAB_OFFSET)
        : undefined;
      const nextPayload: TabTransferPayload = {
        ...pending.payload,
        replaceTargetTabs: true,
        detachedDrag:
          options.continueDrag && grabOffset
            ? {
                originWindow: currentWindowLabel,
                grabOffset,
                floatingWindow: true,
              }
            : undefined,
      };
      let label: string;
      try {
        const prewarmed =
          options.continueDrag &&
          prewarmedDetachedTabDragWindowRef.current?.transferId ===
            payload.transferId &&
          !prewarmedDetachedTabDragWindowRef.current.used
            ? prewarmedDetachedTabDragWindowRef.current
            : null;
        if (prewarmed) {
          prewarmed.used = true;
          label = prewarmed.label ?? (await prewarmed.promise);
        } else {
          label = await openMainWindow(
            cwd,
            options.point && grabOffset
              ? {
                  position: {
                    x: Math.round(options.point.x - grabOffset.x),
                    y: Math.round(options.point.y - grabOffset.y),
                  },
                  detachedDrag: true,
                }
              : {},
          );
        }
        if (options.point && grabOffset) {
          await invoke("tab_drag_set_window_position", {
            label,
            x: Math.round(options.point.x - grabOffset.x),
            y: Math.round(options.point.y - grabOffset.y),
          }).catch(() => {});
        }
      } catch (e) {
        console.error("[omnitab] open transfer window failed:", e);
        return false;
      }
      if (options.continueDrag) {
        pendingDetachedTabDragWindowRef.current = {
          transferId: payload.transferId,
          label,
        };
        if (openingDetachedTabDragRef.current === payload.transferId) {
          openingDetachedTabDragRef.current = null;
        }
      }
      pendingNewWindowTransfersRef.current.set(label, nextPayload);
      if (options.continueDrag) {
        void emitTo<TabTransferPayload>(label, TAB_TRANSFER_EVENT, nextPayload);
      }
      return true;
    },
    [currentWindowLabel, inheritedCwdForNewTab],
  );

  const maybeDetachTabIntoDragWindow = useCallback(
    async (
      payload: TabTransferPayload,
      point?: PhysicalPoint,
    ): Promise<boolean> => {
      if (detachedTabDragRef.current?.transferId === payload.transferId) {
        return false;
      }
      if (
        pendingDetachedTabDragWindowRef.current?.transferId ===
          payload.transferId ||
        openingDetachedTabDragRef.current === payload.transferId
      ) {
        return true;
      }
      openingDetachedTabDragRef.current = payload.transferId;
      const detachPoint: PhysicalPoint =
        point ??
        (await cursorPosition().then((cursor) => ({
          x: cursor.x,
          y: cursor.y,
        })));
      const grabOffset = await detachedWindowGrabOffsetForTab(
        payload.sourceTabId,
        detachPoint,
      );
      return detachTabIntoNewWindow(payload, {
        continueDrag: true,
        point: detachPoint,
        grabOffset,
      }).then((opened) => {
        if (!opened) openingDetachedTabDragRef.current = null;
        return opened;
      });
    },
    [detachTabIntoNewWindow, detachedWindowGrabOffsetForTab],
  );

  const moveDetachedDragWindow = useCallback(
    async (payload: TabTransferPayload): Promise<void> => {
      const detached = detachedTabDragRef.current;
      if (
        !detached ||
        detached.transferId !== payload.transferId ||
        !detached.floatingWindow ||
        detached.nativeWindowDrag
      ) {
        return;
      }
      const cursor = await cursorPosition();
      await invoke("tab_drag_set_window_position", {
        label: currentWindowLabel,
        x: Math.round(cursor.x - detached.grabOffset.x),
        y: Math.round(cursor.y - detached.grabOffset.y),
      }).catch((e) => {
        console.warn("[omnitab] detached tab drag window move failed:", e);
      });
    },
    [currentWindowLabel],
  );

  const finishTabDragAtPointer = useCallback(
    async (payload: TabTransferPayload, detached: boolean) => {
      if (!pendingTransfersRef.current.has(payload.transferId)) return;
      if (finishingTransfersRef.current.has(payload.transferId)) return;
      finishingTransfersRef.current.add(payload.transferId);

      const handled = await completeTabDragAtPointer(payload);
      if (handled) {
        return;
      }

      if (!detached) {
        pendingTransfersRef.current.delete(payload.transferId);
        endGlobalTabDrag(payload.transferId);
        return;
      }

      if (detachedTabDragRef.current?.transferId === payload.transferId) {
        pendingTransfersRef.current.delete(payload.transferId);
        endGlobalTabDrag(payload.transferId);
        return;
      }

      if (
        pendingDetachedTabDragWindowRef.current?.transferId ===
        payload.transferId
      ) {
        return;
      }

      const opened = await detachTabIntoNewWindow(payload);
      if (!opened) {
        pendingTransfersRef.current.delete(payload.transferId);
        endGlobalTabDrag(payload.transferId);
      }
    },
    [completeTabDragAtPointer, detachTabIntoNewWindow, endGlobalTabDrag],
  );

  const handleTabDragEnd = useCallback(
    (raw: string, detached: boolean) => {
      const payload = parseTabTransferPayload(raw);
      if (!payload || payload.sourceWindow !== currentWindowLabel) return;
      void finishTabDragAtPointer(payload, detached);
    },
    [currentWindowLabel, finishTabDragAtPointer],
  );

  const handleTabDragMove = useCallback(
    (
      raw: string,
      target: { targetId: number | null; edge: TabDropEdge } | null,
    ): boolean => {
      const payload = parseTabTransferPayload(raw);
      if (!payload || payload.sourceWindow !== currentWindowLabel) {
        return false;
      }
      if (target) {
        if (
          detachedTabDragRef.current?.transferId !== payload.transferId &&
          pendingDetachedTabDragWindowRef.current?.transferId !==
            payload.transferId
        ) {
          moveTab(payload.sourceTabId, target.targetId, target.edge);
        }
        return false;
      }
      if (tabsRef.current.length <= 1) {
        openingDetachedTabDragRef.current = null;
        pendingDetachedTabDragWindowRef.current = null;
        detachedTabDragRef.current = {
          transferId: payload.transferId,
          originWindow: currentWindowLabel,
          grabOffset: DETACHED_TAB_GRAB_OFFSET,
          floatingWindow: true,
          nativeWindowDrag: true,
        };
        void cursorPosition()
          .then((cursor) =>
            detachedWindowGrabOffsetForTab(payload.sourceTabId, {
              x: cursor.x,
              y: cursor.y,
            }),
          )
          .then((grabOffset) => {
            const current = detachedTabDragRef.current;
            if (current?.transferId === payload.transferId) {
              current.grabOffset = grabOffset;
            }
          })
          .catch(() => {});
        void currentWindowRef.current.startDragging().catch((e) => {
          const current = detachedTabDragRef.current;
          if (current?.transferId === payload.transferId) {
            current.nativeWindowDrag = false;
          }
          console.warn("[omnitab] single-tab window drag failed:", e);
        });
        void publishTabDragHover(payload);
        return true;
      }
      void cursorPosition()
        .then((cursor) =>
          maybeDetachTabIntoDragWindow(payload, {
            x: cursor.x,
            y: cursor.y,
          }),
        )
        .catch((e) => {
          console.warn("[omnitab] tab detach from strip failed:", e);
        });
      return true;
    },
    [
      currentWindowLabel,
      detachedWindowGrabOffsetForTab,
      maybeDetachTabIntoDragWindow,
      moveTab,
      publishTabDragHover,
    ],
  );

  useEffect(() => {
    if (!tabDragActive) return;
    let disposed = false;
    let running = false;

    const currentPayload = () => {
      const transferId = activeDragTransferIdRef.current;
      if (!transferId) return null;
      return pendingTransfersRef.current.get(transferId)?.payload ?? null;
    };

    const onMove = () => {
      const payload = currentPayload();
      if (!payload || !detachedTabDragRef.current) return;
      if (running) return;
      running = true;
      void (async () => {
        try {
          if (disposed) return;
          await moveDetachedDragWindow(payload);
          if (disposed) return;
          await publishTabDragHover(payload);
        } finally {
          running = false;
        }
      })();
    };

    const onRelease = () => {
      const payload = currentPayload();
      if (!payload) return;
      void finishTabDragAtPointer(payload, true);
    };

    const unlisteners: Array<() => void> = [];
    void currentWindowRef.current.onMoved(onMove).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });

    window.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointermove", onMove, true);
    window.addEventListener("mousemove", onMove, true);
    document.addEventListener("mousemove", onMove, true);
    window.addEventListener("pointerup", onRelease, true);
    document.addEventListener("pointerup", onRelease, true);
    window.addEventListener("mouseup", onRelease, true);
    document.addEventListener("mouseup", onRelease, true);
    return () => {
      disposed = true;
      window.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("pointerup", onRelease, true);
      document.removeEventListener("pointerup", onRelease, true);
      window.removeEventListener("mouseup", onRelease, true);
      document.removeEventListener("mouseup", onRelease, true);
      for (const unlisten of unlisteners) unlisten();
    };
  }, [
    finishTabDragAtPointer,
    moveDetachedDragWindow,
    publishTabDragHover,
    tabDragActive,
  ]);

  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    void currentWindowRef.current
      .listen<TabTransferPayload>(TAB_TRANSFER_EVENT, (event) => {
        acceptTransferredTab(
          event.payload,
          event.payload.targetTabId ?? null,
          event.payload.targetEdge ?? "after",
        );
      })
      .then((unlisten) => {
        if (alive) unlisteners.push(unlisten);
        else unlisten();
      });
    void currentWindowRef.current
      .listen<TabTransferAccepted>(TAB_TRANSFER_ACCEPTED_EVENT, (event) => {
        const pending = pendingTransfersRef.current.get(
          event.payload.transferId,
        );
        if (!pending) return;
        const detachedHandoff =
          pendingDetachedTabDragWindowRef.current?.transferId ===
            event.payload.transferId &&
          pendingDetachedTabDragWindowRef.current.label ===
            event.payload.targetWindow;
        const detachedOwnerHandoff =
          detachedTabDragRef.current?.transferId === event.payload.transferId;
        pendingTransfersRef.current.delete(event.payload.transferId);
        for (const [label, payload] of pendingNewWindowTransfersRef.current) {
          if (payload.transferId === event.payload.transferId) {
            pendingNewWindowTransfersRef.current.delete(label);
          }
        }
        if (detachedHandoff || detachedOwnerHandoff) {
          pendingDetachedTabDragWindowRef.current = null;
          pendingDetachedTabDragHandoffRef.current = null;
        } else {
          endGlobalTabDrag(event.payload.transferId);
        }
        detachTransferredTab(pending.tabId);
      })
      .then((unlisten) => {
        if (alive) unlisteners.push(unlisten);
        else unlisten();
      });
    void listen<TabTransferReady>(TAB_TRANSFER_READY_EVENT, (event) => {
      const payload = pendingNewWindowTransfersRef.current.get(
        event.payload.label,
      );
      if (!payload) return;
      void emitTo<TabTransferPayload>(
        event.payload.label,
        TAB_TRANSFER_EVENT,
        payload,
      );
    }).then((unlisten) => {
      if (alive) unlisteners.push(unlisten);
      else unlisten();
    });
    void listen<TabDragSignal>(TAB_DRAG_STARTED_EVENT, (event) => {
      setGlobalTabDragActive(event.payload.transferId, true);
    }).then((unlisten) => {
      if (alive) unlisteners.push(unlisten);
      else unlisten();
    });
    void listen<TabDragHoverSignal>(TAB_DRAG_HOVER_EVENT, (event) => {
      void applyTabDragHover(event.payload);
    }).then((unlisten) => {
      if (alive) unlisteners.push(unlisten);
      else unlisten();
    });
    void listen<TabDragSignal>(TAB_DRAG_ENDED_EVENT, (event) => {
      if (activeDragTransferIdRef.current === event.payload.transferId) {
        setGlobalTabDragActive(null, false);
      }
    }).then((unlisten) => {
      if (alive) unlisteners.push(unlisten);
      else unlisten();
    });
    void currentWindowRef.current.emit<TabTransferReady>(
      TAB_TRANSFER_READY_EVENT,
      { label: currentWindowLabel },
    );
    return () => {
      alive = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [
    acceptTransferredTab,
    applyTabDragHover,
    currentWindowLabel,
    detachTransferredTab,
    endGlobalTabDrag,
    setGlobalTabDragActive,
  ]);

  // Drives session disposal off the pane tree, not React lifecycles —
  // split/unsplit re-mount components but the leaf is still live.
  const liveLeavesRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const live = new Set<number>();
    for (const t of tabs) {
      if (t.kind === "terminal") {
        for (const id of leafIds(t.paneTree)) live.add(id);
      }
    }
    for (const id of liveLeavesRef.current) {
      if (!live.has(id)) disposeSession(id);
    }
    liveLeavesRef.current = live;
    for (const k of [...terminalRefs.current.keys()])
      if (!live.has(k)) terminalRefs.current.delete(k);
  }, [tabs]);
  useEffect(() => {
    const liveTerminalTabs = new Set(
      tabs.filter((t) => t.kind === "terminal").map((t) => t.id),
    );
    setSidebarViewByTerminalTab((current) => {
      let changed = false;
      const next: Record<number, SidebarViewId> = {};
      for (const [key, view] of Object.entries(current)) {
        const tabId = Number(key);
        if (liveTerminalTabs.has(tabId)) {
          next[tabId] = view;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [tabs]);

  const handleClose = useCallback(
    async (id: number) => {
      const t = tabs.find((x) => x.id === id);
      if (t?.kind === "editor" && t.dirty) {
        setPendingCloseTab(id);
        return;
      }
      if (t?.kind === "terminal") {
        const leaves = leafIds(t.paneTree);
        const checks = await Promise.all(leaves.map(leafHasForegroundProcess));
        if (checks.some(Boolean)) {
          setPendingTerminalCloseTab(id);
          return;
        }
      }
      disposeTab(id);
    },
    [tabs, disposeTab],
  );

  const confirmClose = useCallback(() => {
    if (pendingCloseTab !== null) {
      disposeTab(pendingCloseTab);
      setPendingCloseTab(null);
    }
  }, [pendingCloseTab, disposeTab]);

  const cancelClose = useCallback(() => {
    setPendingCloseTab(null);
  }, []);

  const cycleTab = useCallback(
    (delta: 1 | -1) => {
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      const nextIdx = (idx + delta + tabs.length) % tabs.length;
      setActiveId(tabs[nextIdx].id);
    },
    [tabs, activeId, setActiveId],
  );

  const captureActiveSelection = useCallback((): string | null => {
    const t = tabs.find((x) => x.id === activeId);
    if (!t) return null;
    if (t.kind === "terminal") {
      const lid = t.activeLeafId;
      return terminalRefs.current.get(lid)?.getSelection() ?? null;
    }
    if (t.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [tabs, activeId]);

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    if (panelOpen) {
      useChatStore.getState().closePanel();
    } else {
      openPanel();
      focusInput(null);
    }
  }, [hasComposer, panelOpen, openPanel, focusInput]);

  const attachSelection = useChatStore((s) => s.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      // Dispatch a window event the composer listens for. Same pattern as
      // selections — keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("omnitab:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [hasComposer, openPanel, focusInput],
  );

  const askFromSelection = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    const selection = captureActiveSelection();
    if (!selection || !selection.trim()) {
      focusInput(null);
      return;
    }
    const source: "terminal" | "editor" =
      activeTab?.kind === "editor" ? "editor" : "terminal";
    attachSelection(selection, source);
  }, [
    hasComposer,
    captureActiveSelection,
    focusInput,
    attachSelection,
    activeTab,
  ]);

  const [askPopup, setAskPopup] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    const isInsideAi = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return !!(
        el.closest("[data-selection-ask-ai]") ||
        el.closest("[data-ai-input-bar]") ||
        el.closest("[data-ai-mini-window]")
      );
    };

    const onDown = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      setAskPopup(null);
    };
    const onUp = (e: MouseEvent) => {
      if (isInsideAi(e.target)) return;
      const el = e.target as HTMLElement | null;
      const inContentArea = el?.closest?.(".xterm, .cm-editor");
      if (!inContentArea) return;
      // Defer one tick so xterm/CodeMirror finalize the selection.
      setTimeout(() => {
        const text = captureActiveSelection();
        if (text && text.trim().length > 0) {
          setAskPopup({ x: e.clientX, y: e.clientY });
        } else {
          setAskPopup(null);
        }
      }, 0);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
    };
  }, [captureActiveSelection]);

  const onAskFromSelection = useCallback(() => {
    askFromSelection();
    setAskPopup(null);
  }, [askFromSelection]);

  const openNewTab = useCallback(() => {
    newTab(inheritedCwdForNewTab());
  }, [newTab, inheritedCwdForNewTab]);

  const openNewWindow = useCallback(() => {
    void openMainWindow(inheritedCwdForNewTab());
  }, [inheritedCwdForNewTab]);

  const openHostShell = useCallback(
    (host: HostProfile) => {
      const { leafId } = newHostShellTab(
        inheritedCwdForNewTab(),
        host.name,
        host.id,
      );
      void (async () => {
        const passwordPromise =
          host.authMode === "password"
            ? getHostPassword(host.id)
            : Promise.resolve(null);
        await whenSessionReady(leafId);
        writeToSession(leafId, `${buildSshCommand(host)}\r`);
        const password = await passwordPromise;
        if (!password) return;
        await waitForSshPasswordPrompt(
          () => {
            if (!liveLeavesRef.current.has(leafId)) return null;
            return terminalRefs.current.get(leafId)?.getBuffer(80) ?? "";
          },
          () => writeToSession(leafId, `${password}\r`),
        );
      })();
    },
    [inheritedCwdForNewTab, newHostShellTab],
  );

  const selectedHost = useMemo(
    () =>
      selectedHostSource === "local"
        ? null
        : (hosts.find(
            (host) => sourceForHost(host.id) === selectedHostSource,
          ) ?? null),
    [hosts, selectedHostSource],
  );
  const activeTerminalHost = useMemo(() => {
    if (!activeTerminalTab?.hostId) return null;
    return hosts.find((host) => host.id === activeTerminalTab.hostId) ?? null;
  }, [activeTerminalTab?.hostId, hosts]);
  const activeTerminalHostSource: HostSourceValue = activeTerminalHost
    ? sourceForHost(activeTerminalHost.id)
    : "local";

  const selectHostSource = useCallback(
    (source: HostSourceValue) => {
      setSelectedHostSource(source);
      writeSelectedSource(source);
      if (source === "local") return;
      const host = hosts.find((h) => sourceForHost(h.id) === source);
      if (host) openHostShell(host);
    },
    [hosts, openHostShell],
  );

  useEffect(() => {
    if (!hostsHydrated) return;
    if (selectedHostSource === "local") return;
    if (selectedHost) return;
    setSelectedHostSource("local");
    writeSelectedSource("local");
  }, [hostsHydrated, selectedHost, selectedHostSource]);

  const sendCd = useCallback(
    (path: string) => {
      if (activeLeafId === null) return;
      const term = terminalRefs.current.get(activeLeafId);
      if (!term) return;
      term.write(`cd ${quoteShellArg(path)}\r`);
      term.focus();
    },
    [activeLeafId],
  );

  const cdInNewTab = useCallback(
    (path: string) => {
      const tabId = newTab(path);
      setTimeout(() => {
        const tab = tabsRef.current.find((x) => x.id === tabId);
        if (!tab || tab.kind !== "terminal") return;
        const t = terminalRefs.current.get(tab.activeLeafId);
        if (!t) return;
        t.write(`cd ${quoteShellArg(path)}\r`);
        t.focus();
      }, 80);
    },
    [newTab],
  );

  const handleOpenFile = useCallback(
    (path: string, pin?: boolean) => {
      // Explorer defaults to preview (pin=false); explicit actions like
      // context-menu "Open" pass pin=true for a persistent tab.
      openFileTab(path, pin ?? false);
    },
    [openFileTab],
  );

  const handlePathRenamed = useCallback(
    (from: string, to: string) => {
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path === from) {
          const i = to.lastIndexOf("/");
          updateTab(t.id, { path: to, title: i === -1 ? to : to.slice(i + 1) });
        } else if (t.path.startsWith(`${from}/`)) {
          const suffix = t.path.slice(from.length);
          const newPath = `${to}${suffix}`;
          const i = newPath.lastIndexOf("/");
          updateTab(t.id, {
            path: newPath,
            title: i === -1 ? newPath : newPath.slice(i + 1),
          });
        }
      }
    },
    [tabs, updateTab],
  );

  const confirmDeleteClose = useCallback(() => {
    if (pendingDeleteTabs !== null) {
      for (const id of pendingDeleteTabs) disposeTab(id);
      setPendingDeleteTabs(null);
    }
  }, [pendingDeleteTabs, disposeTab]);

  const cancelDeleteClose = useCallback(() => {
    setPendingDeleteTabs(null);
  }, []);

  const handlePathDeleted = useCallback(
    (path: string) => {
      const dirty: number[] = [];
      for (const t of tabs) {
        if (t.kind !== "editor") continue;
        if (t.path !== path && !t.path.startsWith(`${path}/`)) continue;
        if (t.dirty) {
          dirty.push(t.id);
        } else {
          disposeTab(t.id);
        }
      }
      if (dirty.length > 0) setPendingDeleteTabs(dirty);
    },
    [tabs, disposeTab],
  );

  const activeTerminalLeafCwd =
    activeTab?.kind === "terminal"
      ? (findLeafCwd(activeTab.paneTree, activeTab.activeLeafId) ??
        activeTab.cwd ??
        null)
      : null;

  const activeFilePath = (() => {
    if (activeTab?.kind === "editor") return activeTab.path;
    if (activeTab?.kind === "git-diff") {
      if (/^([A-Za-z]:|\/|\\)/.test(activeTab.path)) return activeTab.path;
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    if (activeTab?.kind === "git-commit-file") {
      const root = activeTab.repoRoot.replace(/[\\/]+$/, "");
      const rel = activeTab.path.replace(/^[\\/]+/, "");
      return `${root}/${rel}`;
    }
    return null;
  })();
  const explorerActiveFilePath =
    activeTab?.kind === "editor" || activeTab?.kind === "markdown"
      ? activeTab.path
      : null;
  const workspaceFallbackPath = launchCwdResolved
    ? (launchCwd ?? home ?? null)
    : null;
  const sourceControlContextPath = (() => {
    if (activeTab?.kind === "terminal") {
      return activeTerminalLeafCwd ?? explorerRoot ?? workspaceFallbackPath;
    }
    if (activeTab?.kind === "editor") return dirname(activeTab.path);
    if (activeTab?.kind === "git-diff") return activeTab.repoRoot;
    if (activeTab?.kind === "git-commit-file") return activeTab.repoRoot;
    if (activeTab?.kind === "git-history") return activeTab.repoRoot;
    return explorerRoot ?? workspaceFallbackPath;
  })();
  const hasOpenGitTab = useMemo(
    () =>
      tabs.some(
        (t) =>
          t.kind === "git-diff" ||
          t.kind === "git-history" ||
          t.kind === "git-commit-file",
      ),
    [tabs],
  );
  const sourceControlActive =
    isTerminalTab || hasOpenGitTab || sidebarView === "source-control";
  // Non-terminal screens keep the old stable badge path. Terminal tabs need
  // their own context so Files/Source Control availability follows the tab.
  const badgeContextPath = workspaceFallbackPath;
  const sourceControlPath = activeTerminalHost
    ? null
    : sourceControlActive
      ? sourceControlContextPath
      : badgeContextPath;
  const sourceControl = useSourceControl(sourceControlPath, true);
  const hasSourceControlContent =
    !activeTerminalHost && sourceControl.hasRepo;
  const effectiveSidebarView =
    hasSourceControlContent && sidebarView === "source-control"
      ? "source-control"
      : "explorer";

  const toggleSourceControl = useCallback(() => {
    if (!hasSourceControlContent) return;
    cycleSidebarView("source-control");
  }, [cycleSidebarView, hasSourceControlContent]);

  const openGitGraphFromContext = useCallback(async () => {
    const known = sourceControl.hasRepo ? sourceControl.repo : null;
    if (known) {
      openCommitHistoryTab({
        repoRoot: known.repoRoot,
        branch: sourceControl.status?.branch ?? null,
      });
      return;
    }
    if (!sourceControlContextPath) return;
    try {
      const repo = await native.gitResolveRepo(sourceControlContextPath);
      if (!repo) return;
      openCommitHistoryTab({ repoRoot: repo.repoRoot, branch: repo.branch });
    } catch {
      /* noop */
    }
  }, [
    openCommitHistoryTab,
    sourceControl.hasRepo,
    sourceControl.repo,
    sourceControl.status?.branch,
    sourceControlContextPath,
  ]);

  const openPreviewTab = useCallback(
    (url: string) => {
      const id = newPreviewTab(url);
      // Focus the address bar if the URL is empty so the user can type.
      if (!url) {
        setTimeout(() => previewRefs.current.get(id)?.focusAddressBar(), 0);
      }
      return id;
    },
    [newPreviewTab],
  );

  const openMarkdownPreview = useCallback(
    (path: string) => {
      newMarkdownTab(path);
    },
    [newMarkdownTab],
  );

  const handleCloseTabOrPane = useCallback(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t?.kind === "terminal" && leafIds(t.paneTree).length > 1) {
      closeActivePane(activeId);
      return;
    }
    void handleClose(activeId);
  }, [activeId, closeActivePane, handleClose]);

  const [zenMode, setZenMode] = useState(false);

  const publishTabStripMetrics = useCallback(async () => {
    const strip = document.querySelector<HTMLElement>(TAB_STRIP_SELECTOR);
    if (!strip) {
      void invoke("tab_drag_clear_metrics", { label: currentWindowLabel });
      return;
    }
    const [innerPosition, scaleFactor] = await Promise.all([
      currentWindowRef.current.innerPosition(),
      currentWindowRef.current.scaleFactor(),
    ]);
    const toScreenRect = (rect: DOMRect) => ({
      x: Math.round(innerPosition.x + rect.left * scaleFactor),
      y: Math.round(innerPosition.y + rect.top * scaleFactor),
      width: Math.round(rect.width * scaleFactor),
      height: Math.round(rect.height * scaleFactor),
    });
    const stripRect = toScreenRect(strip.getBoundingClientRect());
    if (stripRect.width <= 0 || stripRect.height <= 0) {
      void invoke("tab_drag_clear_metrics", { label: currentWindowLabel });
      return;
    }
    const tabRects = Array.from(
      strip.querySelectorAll<HTMLElement>("[data-tab-id]"),
    )
      .map((el) => {
        const id = Number(el.dataset.tabId);
        if (!Number.isFinite(id)) return null;
        return {
          id,
          ...toScreenRect(el.getBoundingClientRect()),
        };
      })
      .filter((rect): rect is TabStripMetrics["tabs"][number] => !!rect);
    const metrics: TabStripMetrics = {
      windowLabel: currentWindowLabel,
      strip: stripRect,
      tabs: tabRects,
    };
    void invoke("tab_drag_set_metrics", {
      label: currentWindowLabel,
      metrics,
    });
  }, [currentWindowLabel]);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    const schedule = () => {
      if (disposed) return;
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        void publishTabStripMetrics();
      });
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    const strip = document.querySelector<HTMLElement>(TAB_STRIP_SELECTOR);
    if (strip) {
      observer.observe(strip);
      for (const tab of strip.querySelectorAll<HTMLElement>("[data-tab-id]")) {
        observer.observe(tab);
      }
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("focus", schedule);
    window.addEventListener("scroll", schedule, true);
    strip?.addEventListener("pointermove", schedule);
    const unlisteners: Array<() => void> = [];
    void currentWindowRef.current.onMoved(schedule).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    void currentWindowRef.current.onResized(schedule).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("scroll", schedule, true);
      strip?.removeEventListener("pointermove", schedule);
      for (const unlisten of unlisteners) unlisten();
    };
  }, [activeId, publishTabStripMetrics, tabDragActive, tabs, zenMode]);

  useEffect(() => {
    return () => {
      void invoke("tab_drag_clear_metrics", { label: currentWindowLabel });
    };
  }, [currentWindowLabel]);

  const shortcutHandlers = useMemo<ShortcutHandlers>(
    () => ({
      "commandPalette.open": () => setCommandPaletteOpen(true),
      "window.new": openNewWindow,
      "tab.new": openNewTab,
      "tab.newPreview": () => openPreviewTab(""),
      "tab.newEditor": () => setNewEditorOpen(true),
      "tab.close": handleCloseTabOrPane,
      "tab.next": () => cycleTab(1),
      "tab.prev": () => cycleTab(-1),
      "tab.selectByIndex": (e) => selectByIndex(parseInt(e.key, 10) - 1),
      "pane.focusNext": () => focusNextPaneInTab(activeId, 1),
      "pane.focusPrev": () => focusNextPaneInTab(activeId, -1),
      "pane.source": toggleSourceControl,
      "terminal.clear": () => {
        clearFocusedTerminal();
      },
      "ai.toggle": togglePanelAndFocus,
      "ai.askSelection": askFromSelection,
      "shortcuts.open": () => setShortcutsOpen((v) => !v),
      "settings.open": () => void openSettingsWindow(),
      "sidebar.toggle": toggleSidebar,
      "explorer.focus": toggleExplorerFocus,
      "view.zoomIn": zoomIn,
      "view.zoomOut": zoomOut,
      "view.zoomReset": zoomReset,
      "view.zenMode": () => setZenMode((v) => !v),
      "editor.undo": () => editorRefs.current.get(activeId)?.undo(),
      "editor.redo": () => editorRefs.current.get(activeId)?.redo(),
    }),
    [
      activeId,
      cycleTab,
      handleCloseTabOrPane,
      openNewTab,
      openPreviewTab,
      selectByIndex,
      focusNextPaneInTab,
      toggleSourceControl,
      togglePanelAndFocus,
      askFromSelection,
      toggleSidebar,
      toggleExplorerFocus,
      zoomIn,
      zoomOut,
      zoomReset,
    ],
  );

  const shortcutsDisabled = useCallback(
    (id: ShortcutId, e: KeyboardEvent) => {
      if (id === "editor.undo" || id === "editor.redo") {
        return activeTab?.kind !== "editor";
      }
      if (id === "ai.askSelection") {
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        if (!inTerminal) return false;
        const sel = captureActiveSelection();
        return !sel || !sel.trim();
      }
      if (id === "terminal.clear") {
        // Only intercept ⌘K while a terminal is focused; elsewhere let the key
        // fall through (we never preventDefault when disabled).
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        return !(target as HTMLElement | null)?.closest?.(".xterm");
      }
      if (id === "sidebar.toggle") {
        if (activeTab?.kind !== "terminal") return true;
        // Ctrl+B is also Claude Code's "run in background" key. While a terminal
        // is focused, let Ctrl+B reach the shell/Claude instead of toggling the
        // sidebar. Ctrl+Shift+B (second binding) still toggles it from anywhere.
        const target =
          (e.target as HTMLElement | null) ?? document.activeElement;
        const inTerminal = !!(target as HTMLElement | null)?.closest?.(
          ".xterm",
        );
        // Only defer the plain (no-shift) Ctrl/⌘+B binding; the Shift variant
        // is the always-on toggle and is never claimed by the terminal.
        return inTerminal && !e.shiftKey;
      }
      if (id === "explorer.focus") {
        return activeTab?.kind !== "terminal";
      }
      return false;
    },
    [activeTab],
  );

  useGlobalShortcuts(shortcutHandlers, { isDisabled: shortcutsDisabled });

  const registerTerminalHandle = useCallback(
    (leafId: number, h: TerminalPaneHandle | null) => {
      if (h) terminalRefs.current.set(leafId, h);
      else terminalRefs.current.delete(leafId);
    },
    [],
  );

  const registerEditorHandle = useCallback(
    (id: number, h: EditorPaneHandle | null) => {
      if (h) editorRefs.current.set(id, h);
      else editorRefs.current.delete(id);
      if (id === activeId) setActiveEditorHandle(h);
    },
    [activeId],
  );

  const registerPreviewHandle = useCallback(
    (id: number, h: PreviewPaneHandle | null) => {
      if (h) previewRefs.current.set(id, h);
      else previewRefs.current.delete(id);
    },
    [],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const handlePreviewTitle = useCallback(
    (id: number, title: string) => updateTab(id, { title }),
    [updateTab],
  );

  const authorizedCwds = useRef(new Set<string>());
  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      if (cwd && !authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = useCallback(
    (tabId: number, leafId: number) => {
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [setActiveId, focusPane],
  );

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [openPanel, focusInput]);

  const handleLeafExit = useCallback(
    (leafId: number, _code: number) => {
      const all = tabsRef.current;
      const tab = all.find(
        (t) => t.kind === "terminal" && hasLeaf(t.paneTree, leafId),
      );
      if (!tab || tab.kind !== "terminal") return;
      const isLast =
        leafIds(tab.paneTree).length === 1 &&
        all.filter((t) => t.kind === "terminal").length === 1;
      if (isLast) {
        void respawnSession(leafId, tab.cwd);
      } else {
        closePaneByLeaf(leafId);
      }
    },
    [closePaneByLeaf],
  );

  const handleEditorDirty = useCallback(
    (id: number, dirty: boolean) => updateTab(id, { dirty }),
    [updateTab],
  );

  const handleRenameTab = useCallback(
    (id: number, title: string) => updateTab(id, { customTitle: title.trim() }),
    [updateTab],
  );

  const commandPaletteActions = useMemo(
    () =>
      createCommandPaletteActions({
        tabs,
        activeId,
        explorerRoot,
        home,
        openNewTab,
        openNewWindow,
        openNewEditor: () => setNewEditorOpen(true),
        openNewPreview: () => openPreviewTab(""),
        closeActiveTabOrPane: handleCloseTabOrPane,
        nextTab: () => cycleTab(1),
        previousTab: () => cycleTab(-1),
        focusNextPane: () => focusNextPaneInTab(activeId, 1),
        focusPreviousPane: () => focusNextPaneInTab(activeId, -1),
        focusExplorerSearch: () => explorerRef.current?.focusSearch(),
        toggleSidebar,
        toggleAi: togglePanelAndFocus,
        askAiSelection: askFromSelection,
        openSettings: () => void openSettingsWindow(),
        openShortcuts: () => setShortcutsOpen(true),
      }),
    [
      tabs,
      activeId,
      explorerRoot,
      home,
      openNewTab,
      openNewWindow,
      openPreviewTab,
      handleCloseTabOrPane,
      cycleTab,
      focusNextPaneInTab,
      toggleSidebar,
      togglePanelAndFocus,
      askFromSelection,
    ],
  );

  const activeCwd = activeTerminalLeafCwd;
  const terminalExplorerRoot =
    activeTerminalLeafCwd ?? activeTerminalTab?.cwd ?? explorerRoot;

  useEffect(() => {
    const findCwd = () => {
      const active = tabs.find((x) => x.id === activeId);
      if (active?.kind === "terminal") {
        return (
          findLeafCwd(active.paneTree, active.activeLeafId) ??
          active.cwd ??
          null
        );
      }
      for (let i = tabs.length - 1; i >= 0; i--) {
        const t = tabs[i];
        if (t.kind !== "terminal") continue;
        const cwd = findLeafCwd(t.paneTree, t.activeLeafId) ?? t.cwd;
        if (cwd) return cwd;
      }
      return explorerRoot ?? launchCwd ?? home ?? null;
    };

    setLive({
      getCwd: findCwd,
      getTerminalContext: () => {
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return null;
        const buf = terminalRefs.current.get(t.activeLeafId)?.getBuffer(300);
        return buf ? redactSensitive(buf) : null;
      },
      injectIntoActivePty: (text) => {
        const t = tabs.find((x) => x.id === activeId);
        if (t?.kind !== "terminal") return false;
        const term = terminalRefs.current.get(t.activeLeafId);
        if (!term) return false;
        term.write(text);
        term.focus();
        return true;
      },
      getWorkspaceRoot: () => explorerRoot ?? launchCwd ?? home ?? null,
      getActiveFile: () => {
        const t = tabs.find((x) => x.id === activeId);
        return t?.kind === "editor" ? t.path : null;
      },
      openPreview: (url: string) => {
        openPreviewTab(url);
        return true;
      },
      spawnManagedAgent: (prompt: string, sessionId: string) => {
        const trimmed = prompt.trim();
        if (!trimmed) return null;
        const oneLine = trimmed.replace(/\s*\r?\n\s*/g, " ");
        const cwd = findCwd();
        const short =
          oneLine.length > 32 ? `${oneLine.slice(0, 32)}…` : oneLine;
        const { tabId, leafId } = newAgentTab(
          cwd ?? undefined,
          `claude · ${short}`,
        );
        useManagedAgentsStore
          .getState()
          .register({ leafId, tabId, sessionId, task: oneLine, cwd });
        const hooksReady = invoke("agent_enable_claude_hooks").catch(() => {});
        void (async () => {
          await Promise.all([whenSessionReady(leafId), hooksReady]);
          if (!writeToSession(leafId, "claude\r")) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          const readBuf = () => {
            const term = terminalRefs.current.get(leafId);
            return term ? term.getBuffer(120) : null;
          };
          const result = await waitForClaudeTuiReady(readBuf);
          if (result !== "ready") {
            if (result === "timeout") {
              console.warn(
                "[omnitab] Claude TUI did not appear in time; aborting prompt send",
              );
            }
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          if (!writeToSession(leafId, `\x1b[200~${trimmed}\x1b[201~`)) {
            useManagedAgentsStore.getState().remove(leafId);
            return;
          }
          setTimeout(() => writeToSession(leafId, "\r"), 120);
          useManagedAgentsStore.getState().setPhase(leafId, "working");
        })();
        return { tabId, leafId };
      },
      readLeafBuffer: (leafId: number) => {
        const buf = terminalRefs.current.get(leafId)?.getBuffer(300);
        return buf ? redactSensitive(buf) : null;
      },
    });
  }, [
    setLive,
    activeId,
    tabs,
    explorerRoot,
    launchCwd,
    home,
    openPreviewTab,
    newAgentTab,
  ]);

  const workspaceSurface = (
    <div className="relative h-full min-h-0">
      <div
        className={cn(
          "absolute inset-0",
          !isTerminalTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isTerminalTab}
      >
        <TerminalStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerTerminalHandle}
          onSearchReady={handleSearchReady}
          onCwd={handleTerminalCwd}
          onExit={handleLeafExit}
          onFocusLeaf={handleFocusLeaf}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isEditorTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isEditorTab}
      >
        <EditorStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerEditorHandle}
          onDirtyChange={handleEditorDirty}
          onCloseTab={disposeTab}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0",
          !isPreviewTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isPreviewTab}
      >
        <PreviewStack
          tabs={tabs}
          activeId={activeId}
          registerHandle={registerPreviewHandle}
          onUrlChange={handlePreviewUrl}
          onTitleChange={handlePreviewTitle}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isMarkdownTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isMarkdownTab}
      >
        <MarkdownStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isAiDiffTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isAiDiffTab}
      >
        <AiDiffStack
          tabs={tabs}
          activeId={activeId}
          onAccept={(id) => respondToApproval(id, true)}
          onReject={(id) => respondToApproval(id, false)}
        />
      </div>
      <div
        className={cn(
          "absolute inset-0 px-3 pt-2 pb-2",
          !isGitDiffTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isGitDiffTab}
      >
        <GitDiffStack tabs={tabs} activeId={activeId} />
      </div>
      <div
        className={cn(
          "absolute inset-0",
          !isGitHistoryTab && "invisible pointer-events-none",
        )}
        aria-hidden={!isGitHistoryTab}
      >
        <GitHistoryStack
          tabs={tabs}
          activeId={activeId}
          onOpenCommitFile={openCommitFileDiffTab}
          onSearchHandle={setGitHistoryHandle}
        />
      </div>
    </div>
  );

  const shell = (
    <ThemeProvider>
      <TooltipProvider>
        <div className="relative flex h-screen flex-col overflow-hidden bg-background text-foreground">
          {!zenMode && (
            <Header
              tabs={tabs}
              activeId={activeId}
              onSelect={setActiveId}
              onNew={openNewTab}
              onNewWindow={openNewWindow}
              onNewPreview={() => openPreviewTab("")}
              onClose={handleClose}
              onPin={pinTab}
              onRename={handleRenameTab}
              onTabDragStart={prepareTabTransfer}
              onTabDragMove={handleTabDragMove}
              onTabDragEnd={handleTabDragEnd}
              tabDragActive={tabDragActive}
              externalTabDragHover={externalTabDragHover}
              onActivateAgent={onActivateAgent}
              onActivateLocalAgent={onActivateLocalAgent}
              onOpenSettings={() => void openSettingsWindow()}
            />
          )}

          <main className="zoom-content flex min-h-0 flex-1 flex-col">
            {isTerminalTab ? (
              <TerminalHostToolbar
                onToggleSidebar={toggleSidebar}
                hosts={hosts}
                selectedHostSource={activeTerminalHostSource}
                selectedHost={activeTerminalHost}
                onSelectHostSource={selectHostSource}
                onCreateHost={() => setCreatingHost(true)}
                onEditHost={() => {
                  if (activeTerminalHost) setEditingHost(activeTerminalHost);
                }}
              />
            ) : null}
            <ResizablePanelGroup
              orientation="horizontal"
              className="min-h-0 flex-1"
            >
              {isTerminalTab && !sidebarCollapsed ? (
                <>
                  <ResizablePanel
                    id="sidebar"
                    panelRef={sidebarRef}
                    defaultSize={`${sidebarWidthRef.current}px`}
                    minSize={`${SIDEBAR_MIN_WIDTH}px`}
                    maxSize={`${SIDEBAR_MAX_WIDTH}px`}
                    onResize={(size) => {
                      persistSidebarWidth(size.inPixels);
                    }}
                  >
                    <div className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card">
                      <div className="min-h-0 flex-1">
                        {effectiveSidebarView === "explorer" ? (
                          <HostsPanel
                            ref={explorerRef}
                            localRootPath={terminalExplorerRoot}
                            selectedHost={activeTerminalHost}
                            activeFilePath={explorerActiveFilePath}
                            onOpenFile={handleOpenFile}
                            onPathRenamed={handlePathRenamed}
                            onPathDeleted={handlePathDeleted}
                            onChangeWorkingTree={sendCd}
                            onRevealInTerminal={cdInNewTab}
                            onAttachToAgent={handleAttachFileToAgent}
                            onOpenMarkdownPreview={openMarkdownPreview}
                            onOpenHostTerminal={openHostShell}
                          />
                        ) : effectiveSidebarView === "source-control" ? (
                          <SourceControlPanel
                            open
                            sourceControl={sourceControl}
                            onOpenDiff={openGitDiffTab}
                            onOpenGitGraph={openGitGraphFromContext}
                            onOpenFile={handleOpenFile}
                          />
                        ) : null}
                      </div>
                      {hasSourceControlContent ? (
                        <SidebarRail
                          activeView={effectiveSidebarView}
                          onSelectView={setActiveTerminalSidebarView}
                          changedCount={sourceControl.changedCount}
                        />
                      ) : null}
                    </div>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              ) : null}
              <ResizablePanel
                id="workspace"
                defaultSize={isTerminalTab ? "78%" : "100%"}
                minSize="30%"
              >
                <div className="flex h-full min-h-0 flex-col">
                  <div className="relative min-h-0 flex-1">
                    {workspaceSurface}
                  </div>

                  {keysLoaded ? (
                    <motion.div
                      data-ai-input-bar
                      initial={false}
                      animate={{
                        height: panelOpen ? "auto" : 0,
                        opacity: panelOpen ? 1 : 0,
                      }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                      aria-hidden={!panelOpen}
                    >
                      {hasComposer ? (
                        <AiInputBar />
                      ) : (
                        <AiInputBarConnect
                          onAdd={() => void openSettingsWindow("models")}
                        />
                      )}
                    </motion.div>
                  ) : null}
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>

          {!zenMode && isTerminalTab && (
            <StatusBar
              cwd={activeCwd}
              filePath={activeFilePath}
              home={home}
              onCd={sendCd}
              onWorkspaceChange={switchWorkspace}
              onOpenMini={openMini}
              hasComposer={hasComposer}
            />
          )}

          <AgentNotificationsBridge
            tabs={tabs}
            activeId={activeId}
            onActivate={onActivateAgent}
          />
          <Toaster position="bottom-right" />
          <HostDialog
            open={creatingHost}
            host={null}
            onOpenChange={setCreatingHost}
          />
          <HostDialog
            open={editingHost !== null}
            host={editingHost}
            onOpenChange={(open) => {
              if (!open) setEditingHost(null);
            }}
          />

          {hasComposer ? (
            <>
              <AgentRunBridge
                openAiDiffTab={openAiDiffTab}
                closeAiDiffTab={closeAiDiffTab}
              />
              <LocalAgentNotificationsBridge />
            </>
          ) : null}

          <AnimatePresence>
            {miniOpen && hasComposer ? <AiMiniWindow key="ai-mini" /> : null}
            {askPopup ? (
              <SelectionAskAi
                key="ask-ai-popup"
                x={askPopup.x}
                y={askPopup.y}
                onAsk={onAskFromSelection}
                onDismiss={() => setAskPopup(null)}
              />
            ) : null}
          </AnimatePresence>

          <CommandPalette
            open={commandPaletteOpen}
            onOpenChange={setCommandPaletteOpen}
            actions={commandPaletteActions}
            workspaceRoot={explorerRoot}
            onOpenFile={handleOpenFile}
          />

          <ShortcutsDialog
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
          />

          <NewEditorDialog
            open={newEditorOpen}
            onOpenChange={setNewEditorOpen}
            rootPath={explorerRoot ?? home}
            onCreated={(path) => openFileTab(path)}
          />

          <UpdaterDialog />

          <AlertDialog
            open={pendingCloseTab !== null}
            onOpenChange={(open) => !open && cancelClose()}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
                <AlertDialogDescription>
                  {tabs.find((t) => t.id === pendingCloseTab)?.title
                    ? `"${
                        tabs.find((t) => t.id === pendingCloseTab)?.title
                      }" has unsaved changes. Close anyway?`
                    : "This file has unsaved changes. Close anyway?"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={cancelClose}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction onClick={confirmClose}>
                  Close Anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={pendingTerminalCloseTab !== null}
            onOpenChange={(open) => !open && setPendingTerminalCloseTab(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close Terminal?</AlertDialogTitle>
                <AlertDialogDescription>
                  A process is running. Closing this tab will terminate it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => setPendingTerminalCloseTab(null)}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (pendingTerminalCloseTab !== null)
                      disposeTab(pendingTerminalCloseTab);
                    setPendingTerminalCloseTab(null);
                  }}
                >
                  Close Anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={pendingDeleteTabs !== null}
            onOpenChange={(open) => !open && cancelDeleteClose()}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingDeleteTabs?.length === 1
                    ? (() => {
                        const title = tabs.find(
                          (t) => t.id === pendingDeleteTabs[0],
                        )?.title;
                        return title
                          ? `"${title}" has unsaved changes. The file has been deleted. Close anyway?`
                          : "This file has unsaved changes. The file has been deleted. Close anyway?";
                      })()
                    : `${pendingDeleteTabs?.length ?? 0} files have unsaved changes. They have been deleted. Close all anyway?`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={cancelDeleteClose}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction onClick={confirmDeleteClose}>
                  Close Anyway
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );

  return <AiComposerProvider>{shell}</AiComposerProvider>;
}
