import { invoke } from "@tauri-apps/api/core";

export type OpenMainWindowOptions = {
  position?: { x: number; y: number };
  detachedDrag?: boolean;
  deferShow?: boolean;
};

export async function openMainWindow(
  cwd?: string | null,
  options: OpenMainWindowOptions = {},
): Promise<string> {
  return await invoke<string>("open_main_window", {
    cwd: cwd ?? null,
    position: options.position ?? null,
    detachedDrag: options.detachedDrag ?? false,
    deferShow: options.deferShow ?? false,
  });
}
