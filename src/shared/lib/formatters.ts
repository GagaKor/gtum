import type { ExecutionMode, TerminalSessionStatus } from '../../lib/runtime'

export const formatModeLabel = (mode: ExecutionMode) =>
  mode === 'fast' ? 'Fast' : mode === 'balanced' ? 'Balanced' : 'Deep'

export const formatTerminalStatusLabel = (status: TerminalSessionStatus) =>
  status === 'running'
    ? 'Live'
    : status === 'exited'
      ? 'Exited'
      : status === 'terminated'
        ? 'Terminated'
        : 'Attention'

export const summarizePath = (value: string | null) => {
  if (!value) {
    return 'No project selected'
  }

  const segments = value.split(/[\\/]/).filter(Boolean)
  if (segments.length <= 3) {
    return value
  }

  return ['…', ...segments.slice(-3)].join('/')
}
