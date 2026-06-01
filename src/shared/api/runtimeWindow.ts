import { hasTauriRuntime } from "./runtimeProjects";

export type RuntimeWindowUnlisten = () => void;

export type RuntimeWindowControls = {
  available: boolean;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  startDragging: () => Promise<void>;
};

type RuntimeWindowOverride = Partial<RuntimeWindowControls> & {
  available?: boolean;
};

const noopControls: RuntimeWindowControls = {
  available: false,
  minimize: async () => undefined,
  close: async () => undefined,
  toggleMaximize: async () => undefined,
  startDragging: async () => undefined,
};

const overrideControls = (): RuntimeWindowControls | null => {
  if (typeof window === "undefined") return null;

  const candidate = (window as Window & { __GTUM_WINDOW_CONTROLS__?: RuntimeWindowOverride })
    .__GTUM_WINDOW_CONTROLS__;
  if (!candidate || candidate.available !== true) return null;

  return {
    available: true,
    minimize: candidate.minimize ?? noopControls.minimize,
    close: candidate.close ?? noopControls.close,
    toggleMaximize: candidate.toggleMaximize ?? noopControls.toggleMaximize,
    startDragging: candidate.startDragging ?? noopControls.startDragging,
  };
};

export const initialRuntimeWindowControls = (): RuntimeWindowControls =>
  overrideControls() ?? noopControls;

export const createRuntimeWindowControls = async (): Promise<RuntimeWindowControls> => {
  const override = overrideControls();
  if (override) return override;
  if (!hasTauriRuntime()) return noopControls;

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();

    return {
      available: true,
      minimize: () => appWindow.minimize(),
      close: () => appWindow.close(),
      toggleMaximize: () => appWindow.toggleMaximize(),
      startDragging: () => appWindow.startDragging(),
    };
  } catch {
    return noopControls;
  }
};
