import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  Delete02Icon,
  LinkSquare02Icon,
  MoreHorizontalCircle01Icon,
  StopCircleIcon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type PreviewAddressBarHandle = {
  focus: () => void;
};

type Props = {
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  zoom: number;
  onSubmit: (url: string) => void;
  onReload: () => void;
  onStop: () => void;
  onBack: () => void;
  onForward: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onClearData: () => void;
};

export const PreviewAddressBar = forwardRef<PreviewAddressBarHandle, Props>(
  function PreviewAddressBar(
    {
      url,
      loading,
      canGoBack,
      canGoForward,
      zoom,
      onSubmit,
      onReload,
      onStop,
      onBack,
      onForward,
      onZoomIn,
      onZoomOut,
      onZoomReset,
      onClearData,
    },
    ref,
  ) {
    const [draft, setDraft] = useState(url);
    const [notice, setNotice] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      setDraft(url);
    }, [url]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          const el = inputRef.current;
          if (!el) return;
          el.focus();
          el.select();
        },
      }),
      [],
    );

    const submit = () => {
      const next = normalizeBrowserInput(draft);
      if (!next) {
        setNotice("Enter a URL or search query.");
        return;
      }
      setNotice(null);
      if (next !== url) onSubmit(next);
      else onReload();
    };

    return (
      <div className="shrink-0 border-b border-border/60">
        <div className="flex h-9 items-center gap-1 bg-card/40 px-1.5">
          <IconButton
            title="Back"
            disabled={!canGoBack}
            onClick={onBack}
            icon={ArrowLeft01Icon}
          />
          <IconButton
            title="Forward"
            disabled={!canGoForward}
            onClick={onForward}
            icon={ArrowRight01Icon}
          />
          <IconButton
            title={loading ? "Stop" : "Reload"}
            onClick={loading ? onStop : onReload}
            icon={loading ? StopCircleIcon : ArrowReloadHorizontalIcon}
          />
          <div className="flex min-w-0 flex-1 items-center">
            <Input
              ref={inputRef}
              value={draft}
              placeholder="Search or enter URL"
              spellCheck={false}
              autoComplete="off"
              className="h-7 w-full bg-muted/60 px-2 text-xs placeholder:text-muted-foreground/70 focus-visible:ring-0"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(url);
                  inputRef.current?.blur();
                }
              }}
            />
          </div>
          <IconButton
            title="Open in system browser"
            disabled={!url}
            onClick={() => {
              if (url) void openUrl(url).catch(console.error);
            }}
            icon={LinkSquare02Icon}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Browser options"
                className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={MoreHorizontalCircle01Icon}
                  size={14}
                  strokeWidth={1.75}
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={onZoomIn}>
                <HugeiconsIcon
                  icon={ZoomInAreaIcon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="ml-2 flex-1">Zoom in</span>
                <span className="text-xs text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onZoomOut}>
                <HugeiconsIcon
                  icon={ZoomOutAreaIcon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="ml-2 flex-1">Zoom out</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onZoomReset}>
                <span className="flex-1">Reset zoom</span>
                <span className="text-xs text-muted-foreground">100%</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onClearData}>
                <HugeiconsIcon
                  icon={Delete02Icon}
                  size={14}
                  strokeWidth={1.75}
                />
                <span className="ml-2">Clear browsing data</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {notice ? (
          <div className="flex items-center gap-1.5 bg-amber-500/8 px-3 py-1 text-[11px] text-amber-600 dark:text-amber-400">
            <span className="truncate">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="ml-auto rounded px-1 text-[10px] opacity-80 hover:bg-accent hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
    );
  },
);

function IconButton({
  title,
  disabled,
  onClick,
  icon,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  icon: IconSvgElement;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.75} />
    </Button>
  );
}

function normalizeBrowserInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost([/:?#]|$)/i.test(trimmed)) return `http://${trimmed}`;
  if (/^\d{1,3}(\.\d{1,3}){3}([/:?#]|$)/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^[\w.-]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  const params = new URLSearchParams({ q: trimmed });
  return `https://duckduckgo.com/?${params.toString()}`;
}
