import type { AgentJobSnapshot } from '../../../shared/api/runtimeAgentJobs'
import type { RuntimeTerminalSnapshot } from '../../../shared/api/runtimeTerminals'

export const projectCloseBlockReasons = {
  agentRequest: 'An Agent request or job creation is still in progress.',
  permissionReview: 'Review or dismiss pending Agent permissions before closing.',
  agentJob: 'An Agent job is still running or cancelling.',
  dirtyEditor: 'Save or discard unsaved editor changes before closing.',
  terminal: 'Close running terminals before closing the project.',
  verification: 'Could not verify project activity, so the project remains open.',
} as const

type CloseSession = {
  request?: { phase?: unknown } | null
  messages?: readonly {
    suggestion?: { commands?: readonly unknown[] } | null
    permissionDecision?: unknown
  }[]
}

type CloseTab = {
  id?: unknown
  type?: unknown
  dirty?: unknown
  status?: unknown
  runtimeStatus?: unknown
  runtimeBacked?: unknown
  terminalSessionId?: unknown
}

type CloseWorkbench = {
  workspace?: {
    groups?: Readonly<Record<string, { tabs?: readonly CloseTab[] }>>
  }
} | null

export type ProjectCloseSafetyInput = {
  sessions: readonly CloseSession[]
  workbench: CloseWorkbench
  provisionalTerminalTabIds: ReadonlySet<string>
  jobs: readonly AgentJobSnapshot[]
  terminals: readonly RuntimeTerminalSnapshot[]
}

export type ProjectCloseSafetyResult =
  | { blocked: true; reason: string }
  | { blocked: false; reason: null }

const allWorkbenchTabs = (workbench: CloseWorkbench): CloseTab[] =>
  Object.values(workbench?.workspace?.groups ?? {})
    .flatMap((group) => group.tabs ?? [])

export const auditProjectCloseSafety = ({
  sessions,
  workbench,
  provisionalTerminalTabIds,
  jobs,
  terminals,
}: ProjectCloseSafetyInput): ProjectCloseSafetyResult => {
  if (sessions.some((session) => session.request?.phase === 'running')) {
    return { blocked: true, reason: projectCloseBlockReasons.agentRequest }
  }

  if (sessions.some((session) => (session.messages ?? []).some((message) =>
    (message.suggestion?.commands?.length ?? 0) > 0 && !message.permissionDecision))) {
    return { blocked: true, reason: projectCloseBlockReasons.permissionReview }
  }

  if (jobs.some((snapshot) =>
    snapshot.status === 'running' || snapshot.status === 'cancelling')) {
    return { blocked: true, reason: projectCloseBlockReasons.agentJob }
  }

  const tabs = allWorkbenchTabs(workbench)
  if (tabs.some((tab) => tab.type === 'editor' && tab.dirty === true)) {
    return { blocked: true, reason: projectCloseBlockReasons.dirtyEditor }
  }

  const hasLiveLocalTerminal = tabs.some((tab) =>
    (typeof tab.id === 'string' && provisionalTerminalTabIds.has(tab.id)) ||
    tab.runtimeStatus === 'running' ||
    (tab.runtimeBacked === true && tab.terminalSessionId != null && tab.status === 'running'))
  const hasLiveRuntimeTerminal = terminals.some((snapshot) => snapshot.status === 'running')
  if (hasLiveLocalTerminal || hasLiveRuntimeTerminal) {
    return { blocked: true, reason: projectCloseBlockReasons.terminal }
  }

  return { blocked: false, reason: null }
}
