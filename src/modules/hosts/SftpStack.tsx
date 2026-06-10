import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Tab } from "@/modules/tabs";
import type { HostProfile, SftpEntry } from "@/modules/hosts/types";
import { sftpConfigForHost } from "@/modules/hosts/lib/sshCommand";
import { getHostPassword } from "@/modules/hosts/lib/passwords";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  Delete02Icon,
  Download01Icon,
  File01Icon,
  Folder01Icon,
  FolderAddIcon,
  FolderTransferIcon,
  PencilEdit02Icon,
  Refresh01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useMemo, useState } from "react";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function SftpStack({ tabs, activeId }: Props) {
  const sftpTabs = useMemo(
    () => tabs.filter((t) => t.kind === "hosts-sftp"),
    [tabs],
  );

  return (
    <div className="relative h-full w-full">
      {sftpTabs.map((tab) => {
        const visible = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{
              visibility: visible ? "visible" : "hidden",
              pointerEvents: visible ? "auto" : "none",
            }}
            aria-hidden={!visible}
          >
            <SftpPane host={tab.host} visible={visible} />
          </div>
        );
      })}
    </div>
  );
}

function SftpPane({ host, visible }: { host: HostProfile; visible: boolean }) {
  const [remotePath, setRemotePath] = useState(host.remotePath || ".");
  const [pathInput, setPathInput] = useState(host.remotePath || ".");
  const [localPath, setLocalPath] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = entries.find((e) => e.path === selectedPath) ?? null;

  const getConfig = useCallback(async () => {
    if (host.authMode !== "password") return sftpConfigForHost(host);
    const password = await getHostPassword(host.id);
    if (!password) {
      throw new Error("Password is missing for this host.");
    }
    return sftpConfigForHost(host, password);
  }, [host]);

  const load = useCallback(
    async (path = remotePath) => {
      const nextPath = path.trim() || ".";
      setBusy(true);
      setError(null);
      try {
        const config = await getConfig();
        const next = await invoke<SftpEntry[]>("sftp_list", {
          config,
          path: nextPath,
        });
        setRemotePath(nextPath);
        setPathInput(nextPath);
        setEntries(next);
        setSelectedPath(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [getConfig, remotePath],
  );

  useEffect(() => {
    if (!visible) return;
    void load(host.remotePath || ".");
  }, [host.id, visible]);

  const runMutation = useCallback(
    async (
      fn: (config: Awaited<ReturnType<typeof getConfig>>) => Promise<void>,
    ) => {
      setBusy(true);
      setError(null);
      try {
        const config = await getConfig();
        await fn(config);
        await load(remotePath);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [getConfig, load, remotePath],
  );

  const openDir = useCallback(
    (entry: SftpEntry) => {
      if (!entry.isDir) return;
      void load(entry.path);
    },
    [load],
  );

  const makeDir = useCallback(() => {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    const path = joinRemotePath(remotePath, name.trim());
    void runMutation((config) =>
      invoke<void>("sftp_mkdir", {
        config,
        path,
      }),
    );
  }, [remotePath, runMutation]);

  const renameSelected = useCallback(() => {
    if (!selected) return;
    const name = window.prompt("Rename", selected.name);
    if (!name?.trim() || name.trim() === selected.name) return;
    const to = joinRemotePath(parentRemotePath(selected.path), name.trim());
    void runMutation((config) =>
      invoke<void>("sftp_rename", {
        config,
        from: selected.path,
        to,
      }),
    );
  }, [runMutation, selected]);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.name}"?`)) return;
    void runMutation((config) =>
      invoke<void>("sftp_delete", {
        config,
        path: selected.path,
        isDir: selected.isDir,
      }),
    );
  }, [runMutation, selected]);

  const upload = useCallback(() => {
    const source = localPath.trim();
    if (!source) {
      setError("Local path is required.");
      return;
    }
    const remoteName = basename(source);
    if (!remoteName) {
      setError("Local path must include a file name.");
      return;
    }
    void runMutation((config) =>
      invoke<void>("sftp_upload", {
        config,
        localPath: source,
        remotePath: joinRemotePath(remotePath, remoteName),
      }),
    );
  }, [localPath, remotePath, runMutation]);

  const download = useCallback(() => {
    if (!selected || selected.isDir) return;
    const target = localPath.trim();
    if (!target) {
      setError("Local path is required.");
      return;
    }
    void runMutation((config) =>
      invoke<void>("sftp_download", {
        config,
        remotePath: selected.path,
        localPath: downloadTarget(target, selected.name),
      }),
    );
  }, [localPath, runMutation, selected]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-sm">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon
              icon={FolderTransferIcon}
              size={17}
              strokeWidth={2}
            />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{host.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {host.username ? `${host.username}@` : ""}
              {host.hostname}
              {host.port !== 22 ? `:${host.port}` : ""}
            </div>
          </div>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="rounded-lg"
          title="Refresh"
          disabled={busy}
          onClick={() => void load(remotePath)}
        >
          <HugeiconsIcon icon={Refresh01Icon} size={15} strokeWidth={2} />
        </Button>
      </div>

      <div className="grid shrink-0 gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="rounded-lg"
            title="Parent directory"
            disabled={busy}
            onClick={() => void load(parentRemotePath(remotePath))}
          >
            <HugeiconsIcon icon={ArrowUp01Icon} size={15} strokeWidth={2} />
          </Button>
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(pathInput);
            }}
            className="h-8 rounded-lg bg-card"
            aria-label="Remote path"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-lg"
            disabled={busy}
            onClick={() => void load(pathInput)}
          >
            Open
          </Button>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Input
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            className="h-8 rounded-lg bg-card"
            placeholder="Local path"
            aria-label="Local path"
          />
          <ToolbarButton
            icon={Upload01Icon}
            label="Upload"
            disabled={busy || !localPath.trim()}
            onClick={upload}
          />
          <ToolbarButton
            icon={Download01Icon}
            label="Download"
            disabled={busy || !selected || selected.isDir || !localPath.trim()}
            onClick={download}
          />
          <ToolbarButton
            icon={FolderAddIcon}
            label="New Folder"
            disabled={busy}
            onClick={makeDir}
          />
          <ToolbarButton
            icon={PencilEdit02Icon}
            label="Rename"
            disabled={busy || !selected}
            onClick={renameSelected}
          />
          <ToolbarButton
            icon={Delete02Icon}
            label="Delete"
            disabled={busy || !selected}
            onClick={deleteSelected}
          />
        </div>
        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <div className="grid shrink-0 grid-cols-[1fr_110px_132px] border-b border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <div>Name</div>
        <div className="text-right">Size</div>
        <div className="text-right">Modified</div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 py-1">
          {busy && entries.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              Loading
            </div>
          ) : entries.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              Empty
            </div>
          ) : (
            entries.map((entry) => {
              const selectedRow = selectedPath === entry.path;
              return (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => setSelectedPath(entry.path)}
                  onDoubleClick={() => openDir(entry)}
                  className={cn(
                    "grid w-full grid-cols-[1fr_110px_132px] items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none",
                    "hover:bg-foreground/[0.045] focus-visible:ring-2 focus-visible:ring-ring/30",
                    selectedRow && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <HugeiconsIcon
                      icon={entry.isDir ? Folder01Icon : File01Icon}
                      size={15}
                      strokeWidth={1.9}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="text-right text-xs tabular-nums text-muted-foreground">
                    {entry.isDir ? "" : formatSize(entry.size)}
                  </span>
                  <span className="truncate text-right text-xs text-muted-foreground">
                    {entry.modified ?? ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      className="rounded-lg"
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} size={15} strokeWidth={2} />
    </Button>
  );
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

function downloadTarget(base: string, name: string): string {
  if (base.endsWith("/") || base.endsWith("\\")) return `${base}${name}`;
  return base;
}

function formatSize(size: number | null): string {
  if (size === null || !Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
