import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { InlineInput } from "@/modules/explorer/InlineInput";
import {
  fileIconUrl,
  folderIconUrl,
} from "@/modules/explorer/lib/iconResolver";
import {
  COMPACT_CONTENT,
  COMPACT_ITEM,
} from "@/modules/explorer/lib/menuItemClass";
import type { FileExplorerHandle } from "@/modules/explorer";
import { getHostPassword } from "@/modules/hosts/lib/passwords";
import { sftpConfigForHost } from "@/modules/hosts/lib/sshCommand";
import type {
  HostProfile,
  SftpEntry,
  SftpHostConfig,
} from "@/modules/hosts/types";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  FileAddIcon,
  FolderAddIcon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  type DragEvent,
  type MouseEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { elementFromDragPosition } from "@/lib/nativeDragDrop";

type ChildrenState =
  | { status: "loading" }
  | { status: "loaded"; entries: SftpEntry[] }
  | { status: "error"; message: string };

type TreeState = Record<string, ChildrenState>;

type PendingCreate = {
  parentPath: string;
  kind: "file" | "dir";
};

type RemoteClipboard = {
  operation: "copy" | "cut";
  paths: string[];
};

type DropTarget = {
  hoverPath: string;
  targetDir: string;
  expandPath: string | null;
};

const REMOTE_DRAG_MIME = "application/x-omnitab-sftp-file";

type Row =
  | {
      kind: "parent";
      key: string;
      path: string;
      depth: number;
    }
  | {
      kind: "entry";
      key: string;
      entry: SftpEntry;
      isExpanded: boolean;
      depth: number;
    }
  | {
      kind: "rename";
      key: string;
      entry: SftpEntry;
      depth: number;
    }
  | {
      kind: "pending";
      key: string;
      parentPath: string;
      pendingKind: "file" | "dir";
      depth: number;
    }
  | {
      kind: "status";
      key: string;
      depth: number;
      tone: "muted" | "error";
      message: string;
    };

type Props = {
  host: HostProfile;
  rootPath: string;
  onOpenTerminal: (host: HostProfile) => void;
  onOpenFile: (path: string, pin?: boolean) => void;
  onChangeWorkingTree?: (path: string) => void;
};

export const RemoteFileExplorer = forwardRef<FileExplorerHandle, Props>(
  function RemoteFileExplorer(
    {
      host,
      rootPath: rootPathProp,
      onOpenTerminal,
      onOpenFile,
      onChangeWorkingTree,
    },
    ref,
  ) {
    const initialPath = normalizeRootPath(rootPathProp || host.remotePath);
    const [rootPath, setRootPath] = useState(initialPath);
    const [nodes, setNodes] = useState<TreeState>({});
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [remoteSearchQuery, setRemoteSearchQuery] = useState("");
    const [remoteSearchResults, setRemoteSearchResults] = useState<SftpEntry[]>(
      [],
    );
    const [remoteSearchBusy, setRemoteSearchBusy] = useState(false);
    const [remoteSearchTruncated, setRemoteSearchTruncated] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(
      null,
    );
    const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
    const [remoteClipboard, setRemoteClipboard] =
      useState<RemoteClipboard | null>(null);
    const [dragSourcePaths, setDragSourcePaths] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedPathRef = useRef<string | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const expandedRef = useRef(expanded);
    const expandDropTargetTimerRef = useRef<number | null>(null);

    useEffect(() => {
      selectedPathRef.current = selectedPath;
    }, [selectedPath]);

    useEffect(() => {
      expandedRef.current = expanded;
    }, [expanded]);

    const getConfig = useCallback(async (): Promise<SftpHostConfig> => {
      if (host.authMode !== "password") return sftpConfigForHost(host);
      const password = await getHostPassword(host.id);
      if (!password) throw new Error("Password is missing for this host.");
      return sftpConfigForHost(host, password);
    }, [host]);

    const fetchChildren = useCallback(
      async (path: string) => {
        const nextPath = normalizeRootPath(path);
        setNodes((curr) => ({
          ...curr,
          [nextPath]: { status: "loading" },
        }));
        try {
          const config = await getConfig();
          const entries = await invoke<SftpEntry[]>("sftp_list", {
            config,
            path: nextPath,
          });
          setNodes((curr) => ({
            ...curr,
            [nextPath]: { status: "loaded", entries },
          }));
        } catch (e) {
          setNodes((curr) => ({
            ...curr,
            [nextPath]: { status: "error", message: String(e) },
          }));
        }
      },
      [getConfig],
    );

    useEffect(() => {
      const nextRoot = normalizeRootPath(rootPathProp || host.remotePath);
      setRootPath(nextRoot);
      setNodes({});
      setExpanded(new Set());
      setSelectedPath(null);
      setRemoteSearchQuery("");
      setRenaming(null);
      setPendingCreate(null);
      setError(null);
      void fetchChildren(nextRoot);
    }, [fetchChildren, host.id, host.remotePath, rootPathProp]);

    const openRoot = useCallback(
      (path: string) => {
        const nextRoot = normalizeRootPath(path);
        setRootPath(nextRoot);
        setNodes({});
        setExpanded(new Set());
        setSelectedPath(null);
        setRemoteSearchQuery("");
        setRenaming(null);
        setPendingCreate(null);
        setError(null);
        void fetchChildren(nextRoot);
      },
      [fetchChildren],
    );

    const openParentRoot = useCallback(async () => {
      setBusy(true);
      setError(null);
      try {
        const config = await getConfig();
        const parent = await invoke<string>("sftp_parent_path", {
          config,
          path: rootPath,
        });
        openRoot(parent);
        onChangeWorkingTree?.(parent);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    }, [getConfig, onChangeWorkingTree, openRoot, rootPath]);

    const refresh = useCallback(
      (path: string) => {
        void fetchChildren(path);
      },
      [fetchChildren],
    );

    const expandPath = useCallback(
      (path: string) => {
        setExpanded((curr) => {
          if (curr.has(path)) return curr;
          const next = new Set(curr);
          next.add(path);
          return next;
        });
        void fetchChildren(path);
      },
      [fetchChildren],
    );

    const toggle = useCallback(
      (entry: SftpEntry) => {
        if (!entry.isDir) return;
        setExpanded((curr) => {
          const next = new Set(curr);
          if (next.has(entry.path)) {
            next.delete(entry.path);
          } else {
            next.add(entry.path);
            void fetchChildren(entry.path);
          }
          return next;
        });
      },
      [fetchChildren],
    );

    const entriesByPath = useMemo(() => {
      const map = new Map<string, SftpEntry>();
      for (const state of Object.values(nodes)) {
        if (state.status !== "loaded") continue;
        for (const entry of state.entries) map.set(entry.path, entry);
      }
      return map;
    }, [nodes]);

    const rows = useMemo(
      () => buildRows(rootPath, nodes, expanded, renaming, pendingCreate),
      [expanded, nodes, pendingCreate, renaming, rootPath],
    );

    useEffect(() => {
      if (selectedPath && !entriesByPath.has(selectedPath)) {
        setSelectedPath(null);
      }
    }, [entriesByPath, selectedPath]);

    const runMutation = useCallback(
      async (
        fn: (config: SftpHostConfig) => Promise<void>,
        refreshPath: string | string[],
      ) => {
        setBusy(true);
        setError(null);
        try {
          const config = await getConfig();
          await fn(config);
          const refreshPaths = Array.isArray(refreshPath)
            ? refreshPath
            : [refreshPath];
          for (const path of new Set(refreshPaths)) await fetchChildren(path);
        } catch (e) {
          setError(String(e));
        } finally {
          setBusy(false);
        }
      },
      [fetchChildren, getConfig],
    );

    const beginCreate = useCallback(
      (parentPath: string, kind: "file" | "dir" = "dir") => {
        setRenaming(null);
        setPendingCreate({ parentPath, kind });
        setExpanded((curr) => {
          if (parentPath === rootPath || curr.has(parentPath)) return curr;
          const next = new Set(curr);
          next.add(parentPath);
          return next;
        });
      },
      [rootPath],
    );

    const commitCreate = useCallback(
      async (name: string) => {
        if (!pendingCreate) return;
        const trimmed = name.trim();
        if (!trimmed) {
          setPendingCreate(null);
          return;
        }
        const path = joinRemotePath(pendingCreate.parentPath, trimmed);
        await runMutation(
          (config) =>
            invoke<void>(
              pendingCreate.kind === "file" ? "sftp_create_file" : "sftp_mkdir",
              { config, path },
            ),
          pendingCreate.parentPath,
        );
        setPendingCreate(null);
      },
      [pendingCreate, runMutation],
    );

    const commitRename = useCallback(
      async (newName: string) => {
        if (!renaming) return;
        const entry = entriesByPath.get(renaming);
        if (!entry) {
          setRenaming(null);
          return;
        }
        const trimmed = newName.trim();
        if (!trimmed || trimmed === entry.name) {
          setRenaming(null);
          return;
        }
        const parent = parentRemotePath(entry.path);
        const to = joinRemotePath(parent, trimmed);
        await runMutation(
          (config) =>
            invoke<void>("sftp_rename", {
              config,
              from: entry.path,
              to,
            }),
          parent,
        );
        setRenaming(null);
      },
      [entriesByPath, renaming, runMutation],
    );

    const deleteEntry = useCallback(
      async (entry: SftpEntry) => {
        if (!window.confirm(`Delete "${entry.name}"?`)) return;
        const parent = parentRemotePath(entry.path);
        await runMutation(
          (config) =>
            invoke<void>("sftp_delete", {
              config,
              path: entry.path,
              isDir: entry.isDir,
            }),
          parent,
        );
        if (selectedPathRef.current === entry.path) setSelectedPath(null);
      },
      [runMutation],
    );

    const uploadInto = useCallback(
      async (parentPath: string) => {
        const localPath = window.prompt("Local file path");
        if (!localPath?.trim()) return;
        const name = basename(localPath);
        if (!name) {
          setError("Local path must include a file name.");
          return;
        }
        const remotePath = joinRemotePath(parentPath, name);
        await runMutation(
          (config) =>
            invoke<void>("sftp_upload", {
              config,
              localPath: localPath.trim(),
              remotePath,
            }),
          parentPath,
        );
      },
      [runMutation],
    );

    const uploadPathsInto = useCallback(
      async (localPaths: string[], parentPath: string) => {
        if (localPaths.length === 0) return;
        await runMutation(
          (config) =>
            invoke<void>("sftp_upload_into", {
              config,
              localPaths,
              remoteDir: parentPath,
            }),
          parentPath,
        );
      },
      [runMutation],
    );

    const applyRemoteOperation = useCallback(
      async (
        operation: "copy" | "cut",
        paths: string[],
        parentPath: string,
      ) => {
        if (paths.length === 0) return;
        const refreshPaths =
          operation === "cut"
            ? [parentPath, ...paths.map(parentRemotePath)]
            : [parentPath];
        await runMutation(
          (config) =>
            invoke<void>(
              operation === "copy" ? "sftp_copy_into" : "sftp_move_into",
              {
                config,
                remotePaths: paths,
                remoteDir: parentPath,
              },
            ),
          refreshPaths,
        );
        if (operation === "cut") {
          setRemoteClipboard((curr) =>
            curr?.operation === "cut" &&
            curr.paths.every((p) => paths.includes(p))
              ? null
              : curr,
          );
        }
      },
      [runMutation],
    );

    const downloadEntry = useCallback(
      async (entry: SftpEntry) => {
        if (entry.isDir) return;
        const localPath = window.prompt("Local destination path", entry.name);
        if (!localPath?.trim()) return;
        await runMutation(
          (config) =>
            invoke<void>("sftp_download", {
              config,
              remotePath: entry.path,
              localPath: localPath.trim(),
            }),
          parentRemotePath(entry.path),
        );
      },
      [runMutation],
    );

    const openRemoteFile = useCallback(
      async (entry: SftpEntry) => {
        if (entry.isDir) return;
        setBusy(true);
        setError(null);
        try {
          const config = await getConfig();
          const localPath = await invoke<string>("sftp_download_temp", {
            config,
            remotePath: entry.path,
          });
          onOpenFile(localPath, false);
        } catch (e) {
          setError(String(e));
        } finally {
          setBusy(false);
        }
      },
      [getConfig, onOpenFile],
    );

    const selectedEntry =
      selectedPath !== null ? (entriesByPath.get(selectedPath) ?? null) : null;
    const isSearchActive = remoteSearchQuery.trim().length > 0;

    useEffect(() => {
      if (isSearchOpen) {
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else {
        setRemoteSearchQuery("");
        setRemoteSearchResults([]);
        setRemoteSearchBusy(false);
        setRemoteSearchTruncated(false);
      }
    }, [isSearchOpen]);

    useEffect(() => {
      const q = remoteSearchQuery.trim().toLowerCase();
      if (q.length < 2) {
        setRemoteSearchResults([]);
        setRemoteSearchBusy(false);
        setRemoteSearchTruncated(false);
        return;
      }

      let alive = true;
      setRemoteSearchBusy(true);
      setRemoteSearchTruncated(false);
      const handle = window.setTimeout(async () => {
        try {
          const config = await getConfig();
          const hits: SftpEntry[] = [];
          const queue = [rootPath];
          const visited = new Set<string>();
          let scannedDirs = 0;
          let truncated = false;

          while (alive && queue.length > 0 && hits.length < 200) {
            const dir = normalizeRootPath(queue.shift() ?? "");
            if (visited.has(dir)) continue;
            visited.add(dir);
            scannedDirs += 1;
            if (scannedDirs > 500) {
              truncated = true;
              break;
            }

            const entries = await invoke<SftpEntry[]>("sftp_list", {
              config,
              path: dir,
            });
            if (!alive) return;
            setNodes((curr) => ({
              ...curr,
              [dir]: { status: "loaded", entries },
            }));

            for (const entry of entries) {
              if (entry.name.toLowerCase().includes(q)) hits.push(entry);
              if (entry.isDir) queue.push(entry.path);
              if (hits.length >= 200) {
                truncated = true;
                break;
              }
            }
          }

          if (queue.length > 0) truncated = true;
          if (alive) {
            setRemoteSearchResults(hits);
            setRemoteSearchTruncated(truncated);
          }
        } catch (e) {
          if (alive) {
            console.error("sftp search failed:", e);
            setRemoteSearchResults([]);
            setRemoteSearchTruncated(false);
          }
        } finally {
          if (alive) setRemoteSearchBusy(false);
        }
      }, 300);

      return () => {
        alive = false;
        window.clearTimeout(handle);
      };
    }, [getConfig, remoteSearchQuery, rootPath]);

    const targetForEntry = useCallback(
      (entry: SftpEntry): DropTarget => ({
        hoverPath: entry.path,
        targetDir: entry.isDir ? entry.path : parentRemotePath(entry.path),
        expandPath: entry.isDir ? entry.path : null,
      }),
      [],
    );

    const pasteInto = useCallback(
      (parentPath: string) => {
        if (!remoteClipboard) return;
        void applyRemoteOperation(
          remoteClipboard.operation,
          remoteClipboard.paths,
          parentPath,
        );
      },
      [applyRemoteOperation, remoteClipboard],
    );

    const clearExpandDropTargetTimer = useCallback(() => {
      if (expandDropTargetTimerRef.current === null) return;
      window.clearTimeout(expandDropTargetTimerRef.current);
      expandDropTargetTimerRef.current = null;
    }, []);

    useEffect(() => {
      let disposed = false;
      let unlisten: (() => void) | null = null;

      const resolveTarget = (position: {
        x: number;
        y: number;
      }): DropTarget | null => {
        const el = elementFromDragPosition(position);
        const row = el?.closest<HTMLElement>("[data-sftp-path]");
        if (row?.dataset.sftpPath) {
          const isDir = row.dataset.sftpIsDir === "true";
          const path = row.dataset.sftpPath;
          return {
            hoverPath: path,
            targetDir: isDir ? path : parentRemotePath(path),
            expandPath: isDir ? path : null,
          };
        }
        if (el?.closest("[data-sftp-drop-root]")) {
          return { hoverPath: rootPath, targetDir: rootPath, expandPath: null };
        }
        return null;
      };

      void getCurrentWebview()
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === "enter" || p.type === "over") {
            const target = resolveTarget(p.position);
            setDropTargetPath(target?.hoverPath ?? null);
            if (!target) clearExpandDropTargetTimer();
            return;
          }
          if (p.type === "leave") {
            setDropTargetPath(null);
            clearExpandDropTargetTimer();
            return;
          }
          if (p.type === "drop") {
            setDropTargetPath(null);
            clearExpandDropTargetTimer();
            if (!p.paths.length) return;
            const target = resolveTarget(p.position);
            if (!target) return;
            void uploadPathsInto(p.paths, target.targetDir);
          }
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch((err) =>
          console.error("[omnitab] sftp drop listen failed:", err),
        );

      return () => {
        disposed = true;
        setDropTargetPath(null);
        clearExpandDropTargetTimer();
        unlisten?.();
      };
    }, [clearExpandDropTargetTimer, expandPath, rootPath, uploadPathsInto]);

    const handleDragStartEntry = useCallback(
      (entry: SftpEntry, event: DragEvent<HTMLButtonElement>) => {
        setSelectedPath(entry.path);
        const paths = [entry.path];
        setDragSourcePaths(paths);
        event.dataTransfer.effectAllowed = "copyMove";
        event.dataTransfer.setData(REMOTE_DRAG_MIME, JSON.stringify(paths));
        event.dataTransfer.setData("text/plain", entry.path);
      },
      [],
    );

    const handleDragOverTarget = useCallback(
      (target: DropTarget, event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(REMOTE_DRAG_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = event.altKey ? "copy" : "move";
        setDropTargetPath(target.hoverPath);
      },
      [],
    );

    const handleDropTarget = useCallback(
      (target: DropTarget, event: DragEvent<HTMLElement>) => {
        if (!event.dataTransfer.types.includes(REMOTE_DRAG_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropTargetPath(null);
        clearExpandDropTargetTimer();
        const raw = event.dataTransfer.getData(REMOTE_DRAG_MIME);
        const paths = raw ? (JSON.parse(raw) as string[]) : dragSourcePaths;
        void applyRemoteOperation(
          event.altKey ? "copy" : "cut",
          paths,
          target.targetDir,
        );
        setDragSourcePaths([]);
      },
      [applyRemoteOperation, clearExpandDropTargetTimer, dragSourcePaths],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          containerRef.current?.focus();
        },
        isFocused: () => {
          const container = containerRef.current;
          const active = document.activeElement;
          return !!(
            container &&
            active instanceof Node &&
            container.contains(active)
          );
        },
        focusSearch: () => {
          setIsSearchOpen(true);
          requestAnimationFrame(() => searchInputRef.current?.focus());
        },
      }),
      [],
    );

    const renderRow = (row: Row) => {
      if (row.kind === "parent") {
        return (
          <button
            type="button"
            data-sftp-path={row.path}
            data-sftp-is-dir="true"
            className="group flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] text-foreground/85 transition-colors hover:bg-accent/70"
            style={{ paddingLeft: 6 + row.depth * 12 }}
            onClick={(event) => {
              if (event.detail > 1) return;
              void openParentRoot();
            }}
            onDragOver={(e) =>
              handleDragOverTarget(
                { hoverPath: row.path, targetDir: row.path, expandPath: null },
                e,
              )
            }
            onDrop={(e) =>
              handleDropTarget(
                { hoverPath: row.path, targetDir: row.path, expandPath: null },
                e,
              )
            }
          >
            <span className="size-3.5 shrink-0" />
            <img
              src={folderIconUrl("..", false)}
              alt=""
              className="size-4 shrink-0"
            />
            <span className="min-w-0 flex-1 truncate">..</span>
          </button>
        );
      }

      if (row.kind === "pending") {
        return (
          <div
            className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
            style={{ paddingLeft: 6 + row.depth * 12 }}
          >
            <span className="size-3.5 shrink-0" />
            {row.pendingKind === "dir" ? (
              <img
                src={folderIconUrl("", false)}
                alt=""
                className="size-4 shrink-0 opacity-70"
              />
            ) : (
              <img
                src={fileIconUrl("")}
                alt=""
                className="size-4 shrink-0 opacity-70"
              />
            )}
            <InlineInput
              initial=""
              placeholder={
                row.pendingKind === "dir" ? "New folder" : "New file"
              }
              onCommit={commitCreate}
              onCancel={() => setPendingCreate(null)}
            />
          </div>
        );
      }

      if (row.kind === "status") {
        return (
          <div
            className={cn(
              "h-6 truncate px-1.5 text-[12px] leading-6",
              row.tone === "error"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
            style={{ paddingLeft: 26 + row.depth * 12 }}
          >
            {row.message}
          </div>
        );
      }

      const entry = row.entry;
      const isSelected = selectedPath === entry.path;
      const isRenaming = row.kind === "rename";
      const iconUrl = entry.isDir
        ? folderIconUrl(entry.name, row.kind === "entry" && row.isExpanded)
        : fileIconUrl(entry.name);
      const paddingLeft = 6 + row.depth * 12;

      const handleEntryClick = (event: MouseEvent<HTMLButtonElement>) => {
        if (event.detail > 1) return;
        setSelectedPath(entry.path);
        if (entry.isDir) toggle(entry);
      };

      const handleEntryDoubleClick = () => {
        if (!entry.isDir) {
          void openRemoteFile(entry);
          return;
        }
        openRoot(entry.path);
        onChangeWorkingTree?.(entry.path);
      };

      return (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            {isRenaming ? (
              <div
                className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
                style={{ paddingLeft }}
              >
                <span className="size-3.5 shrink-0" />
                <img src={iconUrl} alt="" className="size-4 shrink-0" />
                <InlineInput
                  initial={entry.name}
                  onCommit={commitRename}
                  onCancel={() => setRenaming(null)}
                />
              </div>
            ) : (
              <button
                type="button"
                data-sftp-path={entry.path}
                data-sftp-is-dir={entry.isDir ? "true" : "false"}
                draggable
                onDragStart={(e) => handleDragStartEntry(entry, e)}
                onDragOver={(e) =>
                  handleDragOverTarget(targetForEntry(entry), e)
                }
                onDrop={(e) => handleDropTarget(targetForEntry(entry), e)}
                onDragEnd={() => {
                  setDragSourcePaths([]);
                  setDropTargetPath(null);
                  clearExpandDropTargetTimer();
                }}
                onDoubleClick={handleEntryDoubleClick}
                className={cn(
                  "group flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left text-[13px] text-foreground/85 transition-colors hover:bg-accent/70",
                  isSelected && "bg-accent text-foreground",
                  dropTargetPath === entry.path &&
                    "bg-primary/15 ring-1 ring-primary/35",
                  dragSourcePaths.includes(entry.path) && "opacity-55",
                )}
                style={{ paddingLeft }}
                onClick={handleEntryClick}
              >
                <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                  {entry.isDir ? (
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      size={12}
                      strokeWidth={2.25}
                      className={cn(
                        "transition-transform",
                        row.kind === "entry" && row.isExpanded && "rotate-90",
                      )}
                    />
                  ) : null}
                </span>
                <img src={iconUrl} alt="" className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent
            className={COMPACT_CONTENT}
            onCloseAutoFocus={(e) => {
              if (renaming || pendingCreate) e.preventDefault();
            }}
          >
            {entry.isDir ? (
              <>
                <ContextMenuItem
                  className={COMPACT_ITEM}
                  onSelect={() => beginCreate(entry.path, "file")}
                >
                  New File
                </ContextMenuItem>
                <ContextMenuItem
                  className={COMPACT_ITEM}
                  onSelect={() => beginCreate(entry.path, "dir")}
                >
                  New Folder
                </ContextMenuItem>
                <ContextMenuItem
                  className={COMPACT_ITEM}
                  onSelect={() => void uploadInto(entry.path)}
                >
                  Upload File
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            ) : (
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => void downloadEntry(entry)}
              >
                Download
              </ContextMenuItem>
            )}
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => void navigator.clipboard.writeText(entry.path)}
            >
              Copy Path
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() =>
                setRemoteClipboard({ operation: "cut", paths: [entry.path] })
              }
            >
              Cut
            </ContextMenuItem>
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() =>
                setRemoteClipboard({ operation: "copy", paths: [entry.path] })
              }
            >
              Copy
            </ContextMenuItem>
            <ContextMenuItem
              className={COMPACT_ITEM}
              disabled={!remoteClipboard}
              onSelect={() => pasteInto(targetForEntry(entry).targetDir)}
            >
              Paste
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className={COMPACT_ITEM}
              onSelect={() => setRenaming(entry.path)}
            >
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              className={COMPACT_ITEM}
              variant="destructive"
              onSelect={() => void deleteEntry(entry)}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      );
    };

    return (
      <div
        ref={containerRef}
        className="flex h-full min-h-0 flex-col outline-none"
        tabIndex={0}
        onKeyDown={(e) => {
          const active = document.activeElement as HTMLElement | null;
          if (
            active?.tagName === "INPUT" ||
            active?.tagName === "TEXTAREA" ||
            active?.isContentEditable
          ) {
            return;
          }
          if (!(e.metaKey || e.ctrlKey)) return;
          if ((e.key === "x" || e.key === "X") && selectedEntry) {
            e.preventDefault();
            setRemoteClipboard({
              operation: "cut",
              paths: [selectedEntry.path],
            });
            return;
          }
          if ((e.key === "c" || e.key === "C") && selectedEntry) {
            e.preventDefault();
            setRemoteClipboard({
              operation: "copy",
              paths: [selectedEntry.path],
            });
            return;
          }
          if ((e.key === "v" || e.key === "V") && remoteClipboard) {
            e.preventDefault();
            pasteInto(
              selectedEntry
                ? targetForEntry(selectedEntry).targetDir
                : rootPath,
            );
          }
        }}
      >
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <span
            className="flex flex-1 items-center truncate text-xs font-medium text-foreground/80"
            title={rootPath}
          >
            <img
              src={folderIconUrl(basename(rootPath), false)}
              alt=""
              height={15}
              width={15}
              className="mx-1.5"
            />
            {basename(rootPath) || rootPath}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => setIsSearchOpen((v) => !v)}
            title="Search files"
            aria-label="Search files"
          >
            <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => beginCreate(rootPath, "file")}
            title="New file"
          >
            <HugeiconsIcon icon={FileAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => beginCreate(rootPath, "dir")}
            title="New folder"
          >
            <HugeiconsIcon icon={FolderAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => refresh(rootPath)}
            title="Refresh"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={2} />
          </Button>
        </div>

        {isSearchOpen ? (
          <div className="relative shrink-0 px-2 py-1.5">
            <HugeiconsIcon
              icon={Search01Icon}
              size={13}
              strokeWidth={2}
              className="absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              value={remoteSearchQuery}
              onChange={(e) => setRemoteSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsSearchOpen(false);
                }
              }}
              placeholder="Search files..."
              className="h-7 pr-7 pl-6.5 text-xs"
            />
            {remoteSearchQuery ? (
              <button
                type="button"
                onClick={() => setRemoteSearchQuery("")}
                className="absolute top-1/2 right-3.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Clear search"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}

        {isSearchActive ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden py-1 [scrollbar-gutter:stable]">
            {remoteSearchQuery.trim().length < 2 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">
                Type at least 2 characters
              </div>
            ) : remoteSearchBusy && remoteSearchResults.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">
                Searching...
              </div>
            ) : remoteSearchResults.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">
                No matches
              </div>
            ) : (
              remoteSearchResults.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  title={entry.path}
                  onClick={() => {
                    if (entry.isDir) {
                      openRoot(entry.path);
                      onChangeWorkingTree?.(entry.path);
                    } else {
                      void openRemoteFile(entry);
                    }
                  }}
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs text-foreground/80 transition-colors hover:bg-accent/50"
                >
                  <img
                    src={
                      entry.isDir
                        ? folderIconUrl(entry.name, false)
                        : fileIconUrl(entry.name)
                    }
                    alt=""
                    className="size-3.5 shrink-0"
                  />
                  <span className="truncate">{entry.name}</span>
                  <span className="ml-auto truncate text-[10px] text-muted-foreground">
                    {relativeRemotePath(rootPath, entry.path)}
                  </span>
                </button>
              ))
            )}
            {remoteSearchTruncated && remoteSearchResults.length > 0 ? (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
                Showing partial results - refine your query.
              </div>
            ) : null}
          </div>
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                data-sftp-drop-root
                onDragOver={(e) =>
                  handleDragOverTarget(
                    {
                      hoverPath: rootPath,
                      targetDir: rootPath,
                      expandPath: null,
                    },
                    e,
                  )
                }
                onDrop={(e) =>
                  handleDropTarget(
                    {
                      hoverPath: rootPath,
                      targetDir: rootPath,
                      expandPath: null,
                    },
                    e,
                  )
                }
                className={cn(
                  "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-1 py-1 [scrollbar-gutter:stable]",
                  dropTargetPath === rootPath && "bg-primary/[0.06]",
                )}
              >
                {rows.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                    Loading
                  </div>
                ) : (
                  rows.map((row) => <div key={row.key}>{renderRow(row)}</div>)
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className={COMPACT_CONTENT}>
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => onOpenTerminal(host)}
              >
                SSH Terminal
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className={COMPACT_ITEM}
                disabled={!remoteClipboard}
                onSelect={() => pasteInto(rootPath)}
              >
                Paste
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => beginCreate(rootPath, "file")}
              >
                New File
              </ContextMenuItem>
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => beginCreate(rootPath, "dir")}
              >
                New Folder
              </ContextMenuItem>
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => void uploadInto(rootPath)}
              >
                Upload File
              </ContextMenuItem>
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => refresh(rootPath)}
              >
                Refresh
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>
    );
  },
);

function buildRows(
  rootPath: string,
  nodes: TreeState,
  expanded: Set<string>,
  renaming: string | null,
  pendingCreate: PendingCreate | null,
): Row[] {
  const rows: Row[] = [];
  rows.push({
    kind: "parent",
    key: `parent:${rootPath}`,
    path: parentRemotePath(rootPath),
    depth: 0,
  });

  const walk = (parentPath: string, depth: number) => {
    const state = nodes[parentPath];
    if (!state) return;
    if (pendingCreate?.parentPath === parentPath) {
      rows.push({
        kind: "pending",
        key: `pending:${parentPath}`,
        parentPath,
        pendingKind: pendingCreate.kind,
        depth,
      });
    }
    if (state.status === "loading") {
      rows.push({
        kind: "status",
        key: `loading:${parentPath}`,
        depth,
        tone: "muted",
        message: "Loading",
      });
      return;
    }
    if (state.status === "error") {
      rows.push({
        kind: "status",
        key: `error:${parentPath}`,
        depth,
        tone: "error",
        message: state.message,
      });
      return;
    }
    for (const entry of state.entries) {
      const isExpanded = entry.isDir && expanded.has(entry.path);
      if (renaming === entry.path) {
        rows.push({
          kind: "rename",
          key: `rename:${entry.path}`,
          entry,
          depth,
        });
      } else {
        rows.push({
          kind: "entry",
          key: entry.path,
          entry,
          isExpanded,
          depth,
        });
      }
      if (isExpanded) walk(entry.path, depth + 1);
    }
  };

  walk(rootPath, 0);
  return rows;
}

function normalizeRootPath(path: string): string {
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : ".";
}

function joinRemotePath(base: string, name: string): string {
  const cleanName = name.replace(/^\/+/, "");
  if (!base || base === ".") return cleanName;
  if (base === "/") return `/${cleanName}`;
  return `${base.replace(/\/+$/, "")}/${cleanName}`;
}

function parentRemotePath(path: string): string {
  const clean = path.trim();
  if (!clean || clean === ".") return ".";
  if (clean === "/") return "/";
  const withoutTrailing = clean.replace(/\/+$/, "");
  const idx = withoutTrailing.lastIndexOf("/");
  if (idx === 0) return "/";
  if (idx < 0) return ".";
  return withoutTrailing.slice(0, idx);
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function relativeRemotePath(root: string, path: string): string {
  const cleanRoot = root.replace(/\/+$/, "");
  if (!cleanRoot || cleanRoot === "." || path === cleanRoot) return path;
  const prefix = `${cleanRoot}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
