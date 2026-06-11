import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setBackgroundBlur,
  setBackgroundImageId,
  setBackgroundKind,
  setBackgroundOpacity,
  setZoomLevel,
  type ThemePref,
} from "@/modules/settings/store";
import { useTheme } from "@/modules/theme";
import {
  deleteBgImage,
  importBgImageFromFile,
} from "@/modules/theme/bgImageStore";
import {
  deleteCustomTheme,
  saveCustomTheme,
} from "@/modules/theme/customThemes";
import { listBuiltinThemes } from "@/modules/theme/themes";
import { validateTheme } from "@/modules/theme/validateTheme";
import { deleteThemeFile, starterTheme } from "@/modules/theme/themeFiles";
import {
  DEFAULT_THEME_ID,
  type Theme,
  type ThemeColors,
  type ThemeMode,
  type ThemeVariant,
} from "@/modules/theme/types";
import {
  ComputerIcon,
  Copy01Icon,
  Edit02Icon,
  Moon02Icon,
  PlusSignIcon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

const EDITABLE_COLOR_KEYS = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
  { key: "card", label: "Card" },
  { key: "cardForeground", label: "Card text" },
  { key: "primary", label: "Primary" },
  { key: "primaryForeground", label: "Primary text" },
  { key: "secondary", label: "Secondary" },
  { key: "secondaryForeground", label: "Secondary text" },
  { key: "muted", label: "Muted" },
  { key: "mutedForeground", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "accentForeground", label: "Accent text" },
  { key: "destructive", label: "Destructive" },
  { key: "border", label: "Border" },
  { key: "input", label: "Input" },
  { key: "ring", label: "Ring" },
  { key: "sidebar", label: "Sidebar" },
  { key: "sidebarForeground", label: "Sidebar text" },
  { key: "sidebarPrimary", label: "Sidebar primary" },
  { key: "sidebarAccent", label: "Sidebar accent" },
] as const satisfies readonly { key: keyof ThemeColors; label: string }[];

const APPEARANCE: {
  id: ThemePref;
  label: string;
  icon: typeof ComputerIcon;
}[] = [
  { id: "system", label: "System", icon: ComputerIcon },
  { id: "light", label: "Light", icon: Sun03Icon },
  { id: "dark", label: "Dark", icon: Moon02Icon },
];

const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.05;

const CSS_COLOR_VARS: Record<keyof ThemeColors, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  border: "--border",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarRing: "--sidebar-ring",
  radius: "--radius",
};

function editableSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return normalized || "custom-theme";
}

function uniqueThemeId(base: string, ids: Set<string>): string {
  const root = editableSlug(base);
  let candidate = root;
  let index = 2;
  while (ids.has(candidate)) {
    candidate = `${root}-${index}`;
    index += 1;
  }
  return candidate;
}

function readComputedColors(): ThemeColors {
  if (typeof window === "undefined") return {};
  const styles = window.getComputedStyle(document.documentElement);
  const out: ThemeColors = {};
  for (const [key, cssVar] of Object.entries(CSS_COLOR_VARS) as [
    keyof ThemeColors,
    string,
  ][]) {
    const value = styles.getPropertyValue(cssVar).trim();
    if (value) out[key] = value;
  }
  return out;
}

function parseRadiusPx(value: string | undefined): number {
  if (!value) return 10;
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) return 10;
  if (trimmed.endsWith("rem")) return Math.round(parsed * 16);
  return Math.round(parsed);
}

function isHexColor(value: string | undefined): value is string {
  return /^#[0-9a-f]{6}$/i.test(value ?? "");
}

function patchModeColors(
  theme: Theme,
  mode: ThemeMode,
  patch: ThemeColors,
): Theme {
  const current = theme.variants[mode] ?? {};
  return {
    ...theme,
    variants: {
      ...theme.variants,
      [mode]: {
        ...current,
        colors: {
          ...(current.colors ?? {}),
          ...patch,
        },
      },
    },
  };
}

function cloneVariant(variant: ThemeVariant | undefined): ThemeVariant {
  return variant ? structuredClone(variant) : {};
}

function fallbackVariantFor(theme: Theme, mode: ThemeMode): ThemeVariant {
  return cloneVariant(
    theme.variants[mode] ??
      theme.variants[mode === "light" ? "dark" : "light"] ??
      {},
  );
}

function ensureThemeModes(theme: Theme, modes: readonly ThemeMode[]): Theme {
  const computed = readComputedColors();
  let next = theme;
  for (const mode of modes) {
    if (next.variants[mode]) continue;
    next = {
      ...next,
      variants: {
        ...next.variants,
        [mode]: {
          ...fallbackVariantFor(next, mode),
          colors: {
            ...computed,
            ...(fallbackVariantFor(next, mode).colors ?? {}),
          },
        },
      },
    };
  }
  return next;
}

function setThemeModeEnabled(
  theme: Theme,
  mode: ThemeMode,
  enabled: boolean,
): Theme {
  if (enabled) return ensureThemeModes(theme, [mode]);
  const otherMode = mode === "light" ? "dark" : "light";
  if (!theme.variants[otherMode]) return theme;
  const variants = { ...theme.variants };
  delete variants[mode];
  return {
    ...theme,
    variants,
  };
}

function themeRadiusPx(theme: Theme): number {
  const radius =
    theme.variants.light?.colors?.radius ??
    theme.variants.dark?.colors?.radius ??
    readComputedColors().radius;
  return parseRadiusPx(radius);
}

function setThemeRadius(theme: Theme, value: number): Theme {
  const radius = `${value}px`;
  const variants = { ...theme.variants };
  for (const mode of THEME_MODES.map((m) => m.id)) {
    const variant = variants[mode];
    if (!variant) continue;
    variants[mode] = {
      ...variant,
      colors: {
        ...(variant.colors ?? {}),
        radius,
      },
    };
  }
  return {
    ...theme,
    variants,
  };
}

function duplicateTheme(
  theme: Theme,
  mode: ThemeMode,
  ids: Set<string>,
): Theme {
  const id = uniqueThemeId(`${theme.id}-copy`, ids);
  const computed = readComputedColors();
  const currentVariant =
    theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light ?? {};
  return ensureThemeModes(
    {
      ...structuredClone(theme),
      id,
      name: `${theme.name} Copy`,
      description: theme.description ?? "Custom theme.",
      variants: {
        ...theme.variants,
        [mode]: {
          ...currentVariant,
          colors: {
            ...computed,
            ...(currentVariant.colors ?? {}),
          },
        },
      },
    },
    ["light", "dark"],
  );
}

export function ThemesSection() {
  const { mode, setMode, themeId, setThemeId, resolvedMode, customThemes } =
    useTheme();
  const builtinThemes = listBuiltinThemes();
  const themes = useMemo(
    () => [...builtinThemes, ...customThemes],
    [builtinThemes, customThemes],
  );
  const customIds = useMemo(
    () => new Set(customThemes.map((t) => t.id)),
    [customThemes],
  );

  const [importError, setImportError] = useState<string | null>(null);
  const [bgError, setBgError] = useState<string | null>(null);
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [draftTheme, setDraftTheme] = useState<Theme | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  const backgroundKind = usePreferencesStore((s) => s.backgroundKind);
  const backgroundImageId = usePreferencesStore((s) => s.backgroundImageId);
  const backgroundOpacity = usePreferencesStore((s) => s.backgroundOpacity);
  const backgroundBlur = usePreferencesStore((s) => s.backgroundBlur);
  const zoomLevel = usePreferencesStore((s) => s.zoomLevel);

  useEffect(() => {
    if (!editingThemeId) {
      setDraftTheme(null);
      return;
    }
    const updated = customThemes.find((t) => t.id === editingThemeId);
    if (updated) setDraftTheme(updated);
  }, [customThemes, editingThemeId]);

  const selectForEditing = (theme: Theme) => {
    setEditingThemeId(theme.id);
    setDraftTheme(theme);
    setThemeId(theme.id);
  };

  const persistDraft = async (next: Theme) => {
    setDraftTheme(next);
    setEditingThemeId(next.id);
    await saveCustomTheme(next);
    setThemeId(next.id);
  };

  const onCreateTheme = async () => {
    const ids = new Set(themes.map((t) => t.id));
    const base = starterTheme();
    const id = uniqueThemeId(base.id, ids);
    const computed = readComputedColors();
    const next = ensureThemeModes(
      patchModeColors(
        {
          ...base,
          id,
        },
        resolvedMode,
        computed,
      ),
      ["light", "dark"],
    );
    await persistDraft(next);
  };

  const onDuplicateTheme = async (theme: Theme) => {
    const next = duplicateTheme(
      theme,
      resolvedMode,
      new Set(themes.map((t) => t.id)),
    );
    await persistDraft(next);
  };

  const onEditTheme = (theme: Theme) => {
    selectForEditing(theme);
  };

  const updateDraftTheme = (mutate: (theme: Theme) => Theme) => {
    if (!draftTheme) return;
    const next = mutate(draftTheme);
    void persistDraft(next);
  };

  const updateDraftVariantEnabled = (mode: ThemeMode, enabled: boolean) => {
    updateDraftTheme((theme) => setThemeModeEnabled(theme, mode, enabled));
  };

  const updateDraftColor = (
    mode: ThemeMode,
    key: keyof ThemeColors,
    value: string,
  ) => {
    updateDraftTheme((theme) =>
      patchModeColors(theme, mode, { [key]: value } as ThemeColors),
    );
  };

  const updateDraftRadius = (value: number) => {
    updateDraftTheme((theme) => setThemeRadius(theme, value));
  };

  const handleThemeFiles = async (files: FileList | null) => {
    setImportError(null);
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const result = validateTheme(parsed);
        if (!result.ok) {
          setImportError(`${file.name}: ${result.error}`);
          return;
        }
        await saveCustomTheme(result.theme);
        setThemeId(result.theme.id);
        selectForEditing(result.theme);
      } catch (e) {
        setImportError(
          `${file.name}: ${e instanceof Error ? e.message : "failed to read"}`,
        );
        return;
      }
    }
  };

  const onPickThemeFile = () => fileInputRef.current?.click();

  const onRemoveCustomTheme = async (id: string) => {
    if (themeId === id) setThemeId(DEFAULT_THEME_ID);
    if (editingThemeId === id) {
      setEditingThemeId(null);
      setDraftTheme(null);
    }
    await deleteCustomTheme(id);
    void deleteThemeFile(id);
  };

  const onPickBgFile = () => bgInputRef.current?.click();

  const handleBgFiles = async (files: FileList | null) => {
    setBgError(null);
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      setBgError(`${file.name}: not an image`);
      return;
    }
    try {
      const prev = backgroundImageId;
      const { id } = await importBgImageFromFile(file);
      await setBackgroundImageId(id);
      await setBackgroundKind("image");
      if (prev && prev !== id) await deleteBgImage(prev).catch(() => undefined);
    } catch (e) {
      setBgError(e instanceof Error ? e.message : "failed to import image");
    }
  };

  const onRemoveBackground = async () => {
    setBgError(null);
    const prev = backgroundImageId;
    await setBackgroundKind("none");
    await setBackgroundImageId(null);
    if (prev) await deleteBgImage(prev).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Themes"
        description="Theme, background image, and customization."
      />

      <div className="flex flex-col gap-2">
        <Label>Appearance</Label>
        <div className="grid grid-cols-3 gap-2">
          {APPEARANCE.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              className={cn(
                "group flex h-20 flex-col items-center justify-center gap-1.5 rounded-lg border bg-card transition-all",
                mode === o.id
                  ? "border-foreground/60 ring-1 ring-foreground/20"
                  : "border-border/60 hover:border-border",
              )}
            >
              <HugeiconsIcon icon={o.icon} size={18} strokeWidth={1.5} />
              <span className="text-[11.5px]">{o.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Zoom</Label>
        <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-muted-foreground">
              UI zoom level
            </span>
            <span className="tabular-nums text-[11px] text-muted-foreground">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>
          <Slider
            value={[zoomLevel]}
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            onValueChange={(v) => void setZoomLevel(v[0] ?? 1)}
          />
        </div>
      </div>

      <div
        className="flex flex-col gap-2"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          void handleThemeFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center justify-between">
          <Label>Theme</Label>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={onCreateTheme}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={11} strokeWidth={2} />
              Create
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onPickThemeFile}
            >
              Import .omnitab-theme
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".omnitab-theme,.json,application/json"
            className="hidden"
            onChange={(e) => {
              void handleThemeFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {importError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11.5px] text-destructive">
            {importError}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {themes.map((t) => {
            const v =
              t.variants[resolvedMode] ?? t.variants.dark ?? t.variants.light;
            const c = v?.colors;
            const swatchBg = c?.background ?? "var(--background)";
            const swatchFg = c?.foreground ?? "var(--foreground)";
            const swatchAccent = c?.primary ?? c?.accent ?? "var(--accent)";
            const swatchMuted = c?.muted ?? "var(--muted)";
            const selected = themeId === t.id;
            const isCustom = customIds.has(t.id);
            const isEditing = editingThemeId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setThemeId(t.id)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border p-2.5 text-left transition-all",
                  isEditing
                    ? "border-primary/70 ring-1 ring-primary/30"
                    : selected
                      ? "border-foreground/60 ring-1 ring-foreground/20"
                      : "border-border/60 hover:border-border",
                )}
              >
                <div
                  className="flex h-10 w-14 shrink-0 items-center justify-center gap-1 rounded-md border border-border/40"
                  style={{ background: swatchBg }}
                >
                  <span
                    className="h-5 w-2 rounded-sm"
                    style={{ background: swatchAccent }}
                  />
                  <span
                    className="h-5 w-2 rounded-sm"
                    style={{ background: swatchFg, opacity: 0.7 }}
                  />
                  <span
                    className="h-5 w-2 rounded-sm"
                    style={{ background: swatchMuted }}
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12.5px] font-medium">
                    {t.name}
                  </span>
                  {t.description ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {t.description}
                    </span>
                  ) : null}
                </div>
                <span className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <span
                    role="button"
                    aria-label={`Duplicate ${t.name}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDuplicateTheme(t);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Copy01Icon}
                      size={12}
                      strokeWidth={1.75}
                    />
                  </span>
                  {isCustom ? (
                    <>
                      <span
                        role="button"
                        aria-label={`Edit ${t.name}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTheme(t);
                        }}
                      >
                        <HugeiconsIcon
                          icon={Edit02Icon}
                          size={12}
                          strokeWidth={1.75}
                        />
                      </span>
                      <span
                        role="button"
                        aria-label={`Remove ${t.name}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onRemoveCustomTheme(t.id);
                        }}
                      >
                        ×
                      </span>
                    </>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        {draftTheme ? (
          <ThemeConfigurator
            theme={draftTheme}
            onChangeName={(name) =>
              updateDraftTheme((theme) => ({ ...theme, name }))
            }
            onChangeDescription={(description) =>
              updateDraftTheme((theme) => ({
                ...theme,
                description: description.trim().length
                  ? description
                  : undefined,
              }))
            }
            onToggleVariant={updateDraftVariantEnabled}
            onChangeColor={updateDraftColor}
            onChangeRadius={updateDraftRadius}
          />
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Duplicate any preset to customize it. Only custom themes can be
            edited or removed.
          </p>
        )}
      </div>

      <div
        className="flex flex-col gap-2"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          void handleBgFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center justify-between">
          <Label>Background</Label>
          <div className="flex items-center gap-2">
            {backgroundKind === "image" && backgroundImageId ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => void onRemoveBackground()}
              >
                Remove
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onPickBgFile}
            >
              {backgroundKind === "image" ? "Replace image" : "Choose image"}
            </Button>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void handleBgFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {bgError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11.5px] text-destructive">
            {bgError}
          </div>
        ) : null}
        {backgroundKind === "image" && backgroundImageId ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-muted-foreground">
                Opacity
              </span>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {Math.round(backgroundOpacity * 100)}%
              </span>
            </div>
            <Slider
              value={[backgroundOpacity]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(v) => void setBackgroundOpacity(v[0] ?? 0)}
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11.5px] text-muted-foreground">Blur</span>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {backgroundBlur}px
              </span>
            </div>
            <Slider
              value={[backgroundBlur]}
              min={0}
              max={64}
              step={1}
              onValueChange={(v) => void setBackgroundBlur(v[0] ?? 0)}
            />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Drop an image here or pick one. Stored locally; doesn't affect the
            default look until set.
          </p>
        )}
      </div>
    </div>
  );
}

function ThemeConfigurator({
  theme,
  onChangeName,
  onChangeDescription,
  onToggleVariant,
  onChangeColor,
  onChangeRadius,
}: {
  theme: Theme;
  onChangeName: (value: string) => void;
  onChangeDescription: (value: string) => void;
  onToggleVariant: (mode: ThemeMode, enabled: boolean) => void;
  onChangeColor: (
    mode: ThemeMode,
    key: keyof ThemeColors,
    value: string,
  ) => void;
  onChangeRadius: (value: number) => void;
}) {
  const activeModes = THEME_MODES.filter(({ id }) =>
    Boolean(theme.variants[id]),
  );
  const radius = themeRadiusPx(theme);

  return (
    <div className="mt-2 flex flex-col gap-4 rounded-lg border border-border/60 p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label>Customize custom theme</Label>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Changes are saved and previewed immediately.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {THEME_MODES.map(({ id, label }) => {
            const checked = Boolean(theme.variants[id]);
            return (
              <label
                key={id}
                className="flex items-center gap-2 text-[11px] text-muted-foreground"
              >
                <Switch
                  checked={checked}
                  disabled={checked && activeModes.length === 1}
                  onCheckedChange={(v) => onToggleVariant(id, v)}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input
            value={theme.name}
            className="h-8 rounded-lg text-[12px]"
            onChange={(e) => onChangeName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Radius</Label>
          <div className="flex h-8 items-center gap-3">
            <Slider
              value={[radius]}
              min={0}
              max={28}
              step={1}
              onValueChange={(v) => onChangeRadius(v[0] ?? 0)}
            />
            <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
              {radius}px
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea
            value={theme.description ?? ""}
            className="min-h-14 rounded-lg py-2 text-[12px]"
            onChange={(e) => onChangeDescription(e.target.value)}
          />
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3",
          activeModes.length > 1 ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {activeModes.map(({ id, label }) => (
          <ThemeVariantConfigurator
            key={id}
            label={label}
            mode={id}
            theme={theme}
            onChangeColor={onChangeColor}
          />
        ))}
      </div>
    </div>
  );
}

function ThemeVariantConfigurator({
  label,
  mode,
  theme,
  onChangeColor,
}: {
  label: string;
  mode: ThemeMode;
  theme: Theme;
  onChangeColor: (
    mode: ThemeMode,
    key: keyof ThemeColors,
    value: string,
  ) => void;
}) {
  const variant =
    theme.variants[mode] ?? theme.variants.dark ?? theme.variants.light ?? {};
  const computed = readComputedColors();
  const colors = {
    ...computed,
    ...(theme.variants[mode === "light" ? "dark" : "light"]?.colors ?? {}),
    ...(variant.colors ?? {}),
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <Label>{label} variant</Label>
        <div
          className="flex h-16 w-28 shrink-0 flex-col justify-between rounded-lg border p-2"
          style={{
            background: colors.card ?? "var(--card)",
            borderColor: colors.border ?? "var(--border)",
            borderRadius: colors.radius ?? "var(--radius)",
            color: colors.cardForeground ?? "var(--card-foreground)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: colors.primary ?? "var(--primary)" }}
            />
            <span className="h-1.5 w-12 rounded-full bg-current opacity-60" />
          </div>
          <div
            className="h-6 rounded-md border"
            style={{
              background: colors.background ?? "var(--background)",
              borderColor: colors.border ?? "var(--border)",
              borderRadius: `calc(${colors.radius ?? "var(--radius)"} * 0.8)`,
            }}
          />
          <div
            className="h-1.5 w-16 rounded-full"
            style={{ background: colors.muted ?? "var(--muted)" }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {EDITABLE_COLOR_KEYS.map(({ key, label }) => {
          const value = colors[key] ?? "";
          const hexValue = isHexColor(value) ? value : null;
          return (
            <div key={key} className="flex min-w-0 flex-col gap-1.5">
              <Label>{label}</Label>
              <div className="flex h-8 items-center gap-2 rounded-lg bg-input/40 px-2">
                {hexValue ? (
                  <input
                    type="color"
                    value={hexValue}
                    className="h-5 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                    onChange={(e) => onChangeColor(mode, key, e.target.value)}
                  />
                ) : (
                  <span
                    className="h-5 w-6 shrink-0 rounded border border-border/70"
                    style={{ background: value || "transparent" }}
                  />
                )}
                <input
                  value={value}
                  className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
                  spellCheck={false}
                  onChange={(e) => onChangeColor(mode, key, e.target.value)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
