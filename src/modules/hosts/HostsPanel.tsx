import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileExplorer, type FileExplorerHandle } from "@/modules/explorer";
import type { HostDraft, HostProfile } from "@/modules/hosts/types";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { RemoteFileExplorer } from "./RemoteFileExplorer";
import { newHostId, useHostsStore } from "./lib/hostsStore";
import { clearHostPassword, setHostPassword } from "./lib/passwords";

type Props = {
  localRootPath: string | null;
  selectedHost: HostProfile | null;
  activeFilePath?: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onChangeWorkingTree?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  onOpenMarkdownPreview?: (path: string) => void;
  onOpenHostTerminal: (host: HostProfile) => void;
};

const EMPTY_DRAFT: HostDraft = {
  name: "",
  hostname: "",
  port: 22,
  username: "",
  authMode: "agent",
  keyPath: "",
  remotePath: ".",
};

export const HostsPanel = forwardRef<FileExplorerHandle, Props>(
  function HostsPanel(
    {
      localRootPath,
      selectedHost,
      activeFilePath,
      onOpenFile,
      onPathRenamed,
      onPathDeleted,
      onChangeWorkingTree,
      onRevealInTerminal,
      onAttachToAgent,
      onOpenMarkdownPreview,
      onOpenHostTerminal,
    },
    ref,
  ) {
    const localExplorerRef = useRef<FileExplorerHandle>(null);
    const remoteExplorerRef = useRef<FileExplorerHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (selectedHost) remoteExplorerRef.current?.focus();
          else localExplorerRef.current?.focus();
        },
        isFocused: () =>
          selectedHost
            ? (remoteExplorerRef.current?.isFocused() ?? false)
            : (localExplorerRef.current?.isFocused() ?? false),
        focusSearch: () => {
          if (selectedHost) remoteExplorerRef.current?.focusSearch();
          else localExplorerRef.current?.focusSearch();
        },
      }),
      [selectedHost],
    );

    return (
      <div className="flex h-full min-h-0 flex-col bg-card text-sm">
        <div className="min-h-0 flex-1">
          {selectedHost ? (
            <RemoteFileExplorer
              ref={remoteExplorerRef}
              host={selectedHost}
              onOpenTerminal={onOpenHostTerminal}
              onChangeWorkingTree={onChangeWorkingTree}
            />
          ) : (
            <FileExplorer
              ref={localExplorerRef}
              rootPath={localRootPath}
              activeFilePath={activeFilePath}
              onOpenFile={onOpenFile}
              onPathRenamed={onPathRenamed}
              onPathDeleted={onPathDeleted}
              onChangeWorkingTree={onChangeWorkingTree}
              onRevealInTerminal={onRevealInTerminal}
              onAttachToAgent={onAttachToAgent}
              onOpenMarkdownPreview={onOpenMarkdownPreview}
            />
          )}
        </div>
      </div>
    );
  },
);

export function HostDialog({
  open,
  host,
  onOpenChange,
}: {
  open: boolean;
  host: HostProfile | null;
  onOpenChange: (open: boolean) => void;
}) {
  const upsert = useHostsStore((s) => s.upsert);
  const [draft, setDraft] = useState<HostDraft>(EMPTY_DRAFT);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(host ?? EMPTY_DRAFT);
    setPassword("");
  }, [host, open]);

  const canSave =
    draft.hostname.trim().length > 0 &&
    (draft.authMode !== "password" || host !== null || password.length > 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave || saving) return;
    const nextHost = host
      ? { ...draft, id: host.id }
      : { ...draft, id: newHostId() };
    setSaving(true);
    void (async () => {
      try {
        upsert(nextHost);
        if (nextHost.authMode === "password") {
          if (password.length > 0) await setHostPassword(nextHost.id, password);
        } else {
          await clearHostPassword(nextHost.id);
        }
        onOpenChange(false);
      } catch (err) {
        window.alert(String(err));
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{host ? "Edit Host" : "New Host"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3">
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(e) => patchDraft(setDraft, { name: e.target.value })}
                className="rounded-lg"
                placeholder="Production"
              />
            </Field>
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <Field label="Host">
                <Input
                  value={draft.hostname}
                  onChange={(e) =>
                    patchDraft(setDraft, { hostname: e.target.value })
                  }
                  className="rounded-lg"
                  placeholder="example.com"
                  required
                />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={(e) =>
                    patchDraft(setDraft, {
                      port: Number.parseInt(e.target.value, 10) || 22,
                    })
                  }
                  className="rounded-lg"
                />
              </Field>
            </div>
            <Field label="User">
              <Input
                value={draft.username}
                onChange={(e) =>
                  patchDraft(setDraft, { username: e.target.value })
                }
                className="rounded-lg"
                placeholder="deploy"
              />
            </Field>
            <div className="grid grid-cols-[150px_1fr] gap-3">
              <Field label="Auth">
                <Select
                  value={draft.authMode}
                  onValueChange={(value) => {
                    const authMode =
                      value === "key" || value === "password" ? value : "agent";
                    patchDraft(setDraft, { authMode });
                  }}
                >
                  <SelectTrigger className="h-9 w-full rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="key">Identity File</SelectItem>
                    <SelectItem value="password">Password</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Key Path">
                <Input
                  value={draft.keyPath}
                  onChange={(e) =>
                    patchDraft(setDraft, { keyPath: e.target.value })
                  }
                  disabled={draft.authMode !== "key"}
                  className="rounded-lg"
                  placeholder="~/.ssh/id_ed25519"
                />
              </Field>
            </div>
            {draft.authMode === "password" ? (
              <Field label="Password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg"
                  placeholder={host ? "Leave blank to keep existing" : ""}
                  autoComplete="new-password"
                />
              </Field>
            ) : null}
            <Field label="Remote Path">
              <Input
                value={draft.remotePath}
                onChange={(e) =>
                  patchDraft(setDraft, { remotePath: e.target.value })
                }
                className="rounded-lg"
                placeholder="."
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="rounded-lg"
              disabled={!canSave || saving}
            >
              Save Host
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function patchDraft(
  setDraft: Dispatch<SetStateAction<HostDraft>>,
  patch: Partial<HostDraft>,
): void {
  setDraft((curr) => ({ ...curr, ...patch }));
}
