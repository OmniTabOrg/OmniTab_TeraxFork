import { Alert02Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";
import {
  browserClearData,
  browserGoBack,
  browserGoForward,
  browserNavigate,
  browserReload,
  browserSetZoom,
  browserState,
  browserStop,
  type BrowserPageLoadPayload,
} from "./browserNative";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};

type Props = {
  id: number;
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
  onTitleChange: (title: string) => void;
};

type HistoryState = {
  entries: string[];
  index: number;
};

const PAGE_LOAD_EVENT = "omnitab:browser-page-load";
const MIN_WEBVIEW_SIZE = 8;

export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ id, url, visible, onUrlChange, onTitleChange }, ref) {
    const addressRef = useRef<PreviewAddressBarHandle>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const webviewRef = useRef<Webview | null>(null);
    const webviewUrlRef = useRef("");
    const urlRef = useRef(url);
    const window = useMemo(() => getCurrentWindow(), []);
    const webviewLabel = useMemo(
      () => `browser-${sanitizeLabel(window.label)}-${id}`,
      [id, window.label],
    );

    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [history, setHistory] = useState<HistoryState>({
      entries: url ? [url] : [],
      index: url ? 0 : -1,
    });

    useEffect(() => {
      urlRef.current = url;
    }, [url]);

    const recordNavigation = useCallback((nextUrl: string) => {
      if (!nextUrl) return;
      setHistory((prev) => {
        if (prev.entries[prev.index] === nextUrl) return prev;

        const existing = prev.entries.lastIndexOf(nextUrl);
        if (existing !== -1) return { entries: prev.entries, index: existing };

        const base =
          prev.index >= 0 ? prev.entries.slice(0, prev.index + 1) : [];
        return { entries: [...base, nextUrl], index: base.length };
      });
    }, []);

    const closeWebview = useCallback(() => {
      const webview = webviewRef.current;
      webviewRef.current = null;
      webviewUrlRef.current = "";
      setReady(false);
      setLoading(false);
      if (webview) void webview.close().catch(console.warn);
    }, []);

    const updateBounds = useCallback(async () => {
      const webview = webviewRef.current;
      const viewport = viewportRef.current;
      if (!webview || !viewport) return;

      const rect = viewport.getBoundingClientRect();
      if (
        !visible ||
        !urlRef.current ||
        rect.width < MIN_WEBVIEW_SIZE ||
        rect.height < MIN_WEBVIEW_SIZE
      ) {
        await webview.hide().catch(console.warn);
        return;
      }

      const x = Math.max(0, Math.round(rect.left));
      const y = Math.max(0, Math.round(rect.top));
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      await webview.setPosition(new LogicalPosition(x, y));
      await webview.setSize(new LogicalSize(width, height));
      await webview.show();
    }, [visible]);

    const syncBrowserState = useCallback(async () => {
      if (!webviewRef.current) return;
      try {
        const state = await browserState(webviewLabel);
        if (state.url && state.url !== webviewUrlRef.current) {
          webviewUrlRef.current = state.url;
          onUrlChange(state.url);
          recordNavigation(state.url);
        }
        const title = state.title.trim();
        if (title) onTitleChange(title);
      } catch {
        // The webview may be in-flight or gone during tab close.
      }
    }, [onTitleChange, onUrlChange, recordNavigation, webviewLabel]);

    const createWebview = useCallback(
      (targetUrl: string) => {
        if (webviewRef.current) return;
        if (!isSupportedWebUrl(targetUrl)) {
          setError("Browser tabs support http and https URLs.");
          return;
        }

        const viewport = viewportRef.current;
        const rect = viewport?.getBoundingClientRect();
        const x = Math.max(0, Math.round(rect?.left ?? 0));
        const y = Math.max(0, Math.round(rect?.top ?? 0));
        const width = Math.max(1, Math.round(rect?.width ?? 800));
        const height = Math.max(1, Math.round(rect?.height ?? 600));

        setError(null);
        setLoading(true);
        webviewUrlRef.current = targetUrl;
        recordNavigation(targetUrl);

        const webview = new Webview(window, webviewLabel, {
          url: targetUrl,
          x,
          y,
          width,
          height,
          focus: false,
          dragDropEnabled: true,
          zoomHotkeysEnabled: true,
          devtools: import.meta.env.DEV,
          backgroundColor: "#ffffff",
          allowLinkPreview: true,
          generalAutofillEnabled: true,
        });

        webviewRef.current = webview;
        void webview.once("tauri://created", () => {
          setReady(true);
          void browserSetZoom(webviewLabel, zoom).catch(console.warn);
          void updateBounds();
        });
        void webview.once<string>("tauri://error", (event) => {
          setError(
            String(event.payload || "Failed to create browser webview."),
          );
          closeWebview();
        });
      },
      [
        closeWebview,
        recordNavigation,
        updateBounds,
        webviewLabel,
        window,
        zoom,
      ],
    );

    useEffect(() => {
      const targetUrl = url.trim();
      if (!targetUrl) {
        closeWebview();
        setHistory({ entries: [], index: -1 });
        setError(null);
        return;
      }

      if (!webviewRef.current) {
        createWebview(targetUrl);
        return;
      }

      if (targetUrl === webviewUrlRef.current) return;
      if (!isSupportedWebUrl(targetUrl)) {
        setError("Browser tabs support http and https URLs.");
        return;
      }

      setError(null);
      setLoading(true);
      webviewUrlRef.current = targetUrl;
      recordNavigation(targetUrl);
      void browserNavigate(webviewLabel, targetUrl).catch((e) => {
        setLoading(false);
        setError(String(e));
      });
    }, [closeWebview, createWebview, recordNavigation, url, webviewLabel]);

    useEffect(() => {
      let unlisten: (() => void) | null = null;
      void window
        .listen<BrowserPageLoadPayload>(PAGE_LOAD_EVENT, (event) => {
          const payload = event.payload;
          if (payload.label !== webviewLabel) return;

          setLoading(payload.event === "started");
          if (payload.url && payload.url !== webviewUrlRef.current) {
            webviewUrlRef.current = payload.url;
            onUrlChange(payload.url);
            recordNavigation(payload.url);
          }
          if (payload.event === "finished") void syncBrowserState();
        })
        .then((fn) => {
          unlisten = fn;
        });
      return () => unlisten?.();
    }, [onUrlChange, recordNavigation, syncBrowserState, webviewLabel, window]);

    useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const resize = () => void updateBounds();
      const observer = new ResizeObserver(resize);
      observer.observe(viewport);
      globalThis.addEventListener("resize", resize);
      const raf = requestAnimationFrame(resize);

      return () => {
        observer.disconnect();
        globalThis.removeEventListener("resize", resize);
        cancelAnimationFrame(raf);
      };
    }, [updateBounds]);

    useEffect(() => {
      if (!webviewRef.current) return;
      if (visible && url) void updateBounds();
      else void webviewRef.current.hide().catch(console.warn);
    }, [updateBounds, url, visible]);

    useEffect(() => {
      if (!visible || !ready) return;
      void syncBrowserState();
      const interval = globalThis.setInterval(
        () => void syncBrowserState(),
        1200,
      );
      return () => globalThis.clearInterval(interval);
    }, [ready, syncBrowserState, visible]);

    useEffect(() => closeWebview, [closeWebview]);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => {
          if (!webviewRef.current) return;
          setLoading(true);
          void browserReload(webviewLabel).catch((e) => {
            setLoading(false);
            setError(String(e));
          });
        },
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => webviewUrlRef.current || url,
      }),
      [url, webviewLabel],
    );

    const canGoBack = history.index > 0;
    const canGoForward =
      history.index >= 0 && history.index < history.entries.length - 1;

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <PreviewAddressBar
          ref={addressRef}
          url={url}
          loading={loading}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          zoom={zoom}
          onSubmit={onUrlChange}
          onReload={() => {
            if (!webviewRef.current) return;
            setLoading(true);
            void browserReload(webviewLabel).catch((e) => {
              setLoading(false);
              setError(String(e));
            });
          }}
          onStop={() => {
            setLoading(false);
            void browserStop(webviewLabel).catch(console.warn);
          }}
          onBack={() => {
            if (!canGoBack) return;
            setHistory((prev) => ({
              ...prev,
              index: Math.max(0, prev.index - 1),
            }));
            setLoading(true);
            void browserGoBack(webviewLabel).catch((e) => {
              setLoading(false);
              setError(String(e));
            });
          }}
          onForward={() => {
            if (!canGoForward) return;
            setHistory((prev) => ({
              ...prev,
              index: Math.min(prev.entries.length - 1, prev.index + 1),
            }));
            setLoading(true);
            void browserGoForward(webviewLabel).catch((e) => {
              setLoading(false);
              setError(String(e));
            });
          }}
          onZoomIn={() => {
            setZoom((z) => {
              const next = clampZoom(z + 0.1);
              void browserSetZoom(webviewLabel, next).catch(console.warn);
              return next;
            });
          }}
          onZoomOut={() => {
            setZoom((z) => {
              const next = clampZoom(z - 0.1);
              void browserSetZoom(webviewLabel, next).catch(console.warn);
              return next;
            });
          }}
          onZoomReset={() => {
            setZoom(1);
            void browserSetZoom(webviewLabel, 1).catch(console.warn);
          }}
          onClearData={() => {
            void browserClearData(webviewLabel)
              .then(() => browserReload(webviewLabel))
              .catch((e) => setError(String(e)));
          }}
        />
        {error ? <ErrorBanner message={error} /> : null}
        <div
          ref={viewportRef}
          className={
            url
              ? "relative min-h-0 flex-1 bg-white"
              : "relative min-h-0 flex-1 bg-background"
          }
        >
          {!url ? <EmptyState /> : !ready ? <LoadingState /> : null}
        </div>
      </div>
    );
  },
);

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-destructive/8 px-3 text-[11px] text-destructive">
      <HugeiconsIcon
        icon={Alert02Icon}
        size={12}
        strokeWidth={1.75}
        className="shrink-0"
      />
      <span className="truncate">{message}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
      Loading browser...
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">New browser tab</p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Search or enter a URL.
        </p>
      </div>
    </div>
  );
}

function sanitizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9_/:.-]/g, "-");
}

function isSupportedWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function clampZoom(value: number): number {
  return Math.min(3, Math.max(0.25, Math.round(value * 10) / 10));
}
