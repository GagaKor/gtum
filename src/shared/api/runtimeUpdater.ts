import { hasTauriRuntime } from "./runtimeProjects";

/**
 * Minimal seam over `@tauri-apps/plugin-updater`.
 *
 * This intentionally does NOT implement the full update-prompt / download /
 * restart UX. It only answers "is an update available?" and degrades to a
 * clear no-op when the Tauri runtime is not present (e.g. the browser preview
 * served by `vite preview` during e2e). Later tasks can build the prompt and
 * `relaunch()` flow on top of this contract.
 */
export type UpdateCheckResult =
  | {
      status: "available";
      version: string;
      currentVersion: string;
      notes?: string;
      date?: string;
    }
  | {
      status: "up-to-date";
      currentVersion: string;
    }
  | {
      status: "unavailable";
      /** Why the check could not run (e.g. browser preview, plugin error). */
      reason: string;
    };

/**
 * Allow tests / the browser preview to inject a deterministic checker without
 * pulling in the native plugin. Mirrors the `__GTUM_*` override hooks used by
 * the other runtime seams.
 */
type RuntimeUpdaterOverride = {
  checkForUpdate?: () => Promise<UpdateCheckResult>;
};

const updaterOverride = (): RuntimeUpdaterOverride | null => {
  if (typeof window === "undefined") return null;

  return (
    (window as Window & { __GTUM_UPDATER_RUNTIME__?: RuntimeUpdaterOverride })
      .__GTUM_UPDATER_RUNTIME__ ?? null
  );
};

const BROWSER_PREVIEW_RESULT: UpdateCheckResult = {
  status: "unavailable",
  reason: "Auto-update is unavailable in browser preview; run the installed desktop app.",
};

/**
 * Check whether a newer release is available via the configured updater
 * endpoint. No-ops (returns an `unavailable` result) outside the Tauri runtime
 * and never throws — callers can render the result directly.
 */
export const checkForUpdate = async (): Promise<UpdateCheckResult> => {
  const override = updaterOverride();
  if (override?.checkForUpdate) return override.checkForUpdate();

  if (!hasTauriRuntime()) return BROWSER_PREVIEW_RESULT;

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();

    if (!update) {
      return {
        status: "up-to-date",
        currentVersion: "",
      };
    }

    if (!update.available) {
      return {
        status: "up-to-date",
        currentVersion: update.currentVersion,
      };
    }

    return {
      status: "available",
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body ?? undefined,
      date: update.date ?? undefined,
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Failed to check for updates.",
    };
  }
};
