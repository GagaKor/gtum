import { invoke } from '@tauri-apps/api/core'
import { hasTauriRuntime } from '../../api/runtimeProjects'

// Window-chrome platform variant. Only mac/windows are modeled: the design
// draft defines macOS traffic lights and Windows caption buttons, and Linux
// falls back to the macOS layout.
export type RuntimeOs = 'mac' | 'windows'

type RuntimeInfo = { platform?: string }

const OS_OVERRIDE_KEY = '__GTUM_OS__'

// Explicit override, primarily for E2E so both titlebar layouts can be asserted
// deterministically without a real OS. Set window.__GTUM_OS__ = 'windows' | 'mac'.
export const osOverride = (): RuntimeOs | null => {
  if (typeof window === 'undefined') return null
  const value = (window as Window & { __GTUM_OS__?: unknown })[OS_OVERRIDE_KEY]
  return value === 'windows' || value === 'mac' ? value : null
}

const osFromPlatformString = (platform: string | undefined): RuntimeOs =>
  typeof platform === 'string' && /win/i.test(platform) ? 'windows' : 'mac'

// Synchronous best guess for first paint: override, then a navigator heuristic.
// Defaults to 'mac' (the design baseline) when nothing else is available.
export const initialOs = (): RuntimeOs => {
  const override = osOverride()
  if (override) return override
  if (typeof navigator === 'undefined') return 'mac'
  const hint =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent
  return osFromPlatformString(hint)
}

// Authoritative async detection: in Tauri, ask the backend runtime info
// (std::env::consts::OS). Falls back to the synchronous guess elsewhere or on error.
export const detectRuntimeOs = async (): Promise<RuntimeOs> => {
  const override = osOverride()
  if (override) return override
  if (!hasTauriRuntime()) return initialOs()
  try {
    const info = await invoke<RuntimeInfo>('get_runtime_info')
    return osFromPlatformString(info?.platform)
  } catch {
    return initialOs()
  }
}
