import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  beginTelegramLink,
  completeTelegramLink,
  createTelegramReport,
  disconnectTelegramBridge,
  queueTelegramRemoteCommand,
  readTelegramRuntimeSnapshot,
  resolveTelegramRemoteCommand,
  usesMockRuntime,
  type ExecutionMode,
  type TelegramRemoteCommandSnapshot,
  type TelegramRuntimeSnapshot,
  type TerminalSessionLogs,
  type TerminalSessionSnapshot,
} from '../../../lib/runtime'
import type { AgentContextSnapshot } from '../../../stores/workspace-store'
import { formatModeLabel } from '../../../shared/lib/formatters'
import type { RecordTask, TaskHistoryEntry } from '../../tasks/model/types'
import { emptyTelegramReportState, type TelegramReportState } from './types'

type UseTelegramWorkspaceParams = {
  initialReport?: TelegramReportState
  activeProject: string
  activeProjectPath: string
  projectName: string | null
  activeSession: TerminalSessionSnapshot | null
  terminalLogs: TerminalSessionLogs | null
  agentContext: AgentContextSnapshot | null
  executionMode: ExecutionMode
  taskHistory: TaskHistoryEntry[]
  setActiveContext: (context: string) => void
  recordTask: RecordTask
  executeCommandInTarget: (
    command: string,
    target: 'current-tab' | 'new-tab',
    options?: { newTabNameBase?: string },
  ) => Promise<void>
}

export const useTelegramWorkspace = ({
  initialReport,
  activeProject,
  activeProjectPath,
  projectName,
  activeSession,
  terminalLogs,
  agentContext,
  executionMode,
  taskHistory,
  setActiveContext,
  recordTask,
  executeCommandInTarget,
}: UseTelegramWorkspaceParams) => {
  const [telegramSnapshot, setTelegramSnapshot] = useState<TelegramRuntimeSnapshot | null>(null)
  const [telegramError, setTelegramError] = useState<string | null>(null)
  const [telegramReport, setTelegramReport] = useState<TelegramReportState>(
    initialReport ?? emptyTelegramReportState(),
  )

  const refreshTelegramState = useCallback(async () => {
    try {
      const snapshot = await readTelegramRuntimeSnapshot()
      setTelegramSnapshot(snapshot)
    } catch (error) {
      setTelegramError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void refreshTelegramState()
  }, [refreshTelegramState])

  const startTelegramLink = useCallback(async () => {
    try {
      setTelegramError(null)
      const snapshot = await beginTelegramLink()
      setTelegramSnapshot((current) => ({
        storagePath: current?.storagePath ?? null,
        bridge: snapshot,
        reports: current?.reports ?? [],
        remoteCommands: current?.remoteCommands ?? [],
      }))
      setActiveContext('Sprint 14 Telegram link started')
      recordTask('Telegram link started', 'Awaiting Telegram bridge approval.', 'pending')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram link failed', message, 'error')
    }
  }, [recordTask, setActiveContext])

  const completeTelegramMockLink = useCallback(async () => {
    try {
      setTelegramError(null)
      const snapshot = await completeTelegramLink({
        authorizationCode: 'mock-telegram-code',
        chatLabel: '@gtum_ops',
      })
      setTelegramSnapshot((current) => ({
        storagePath: current?.storagePath ?? null,
        bridge: snapshot,
        reports: current?.reports ?? [],
        remoteCommands: current?.remoteCommands ?? [],
      }))
      setActiveContext('Sprint 14 Telegram connected')
      recordTask('Telegram connected', snapshot.chatLabel ?? '@gtum_ops', 'done')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram callback failed', message, 'error')
    }
  }, [recordTask, refreshTelegramState, setActiveContext])

  const disconnectTelegram = useCallback(async () => {
    try {
      setTelegramError(null)
      const snapshot = await disconnectTelegramBridge()
      setTelegramSnapshot((current) => ({
        storagePath: current?.storagePath ?? null,
        bridge: snapshot,
        reports: current?.reports ?? [],
        remoteCommands: current?.remoteCommands ?? [],
      }))
      setActiveContext('Sprint 14 Telegram disconnected')
      recordTask('Telegram disconnected', 'Telegram bridge cleared.', 'done')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram disconnect failed', message, 'error')
    }
  }, [recordTask, refreshTelegramState, setActiveContext])

  const sendTelegramStatusReport = useCallback(async () => {
    if (telegramSnapshot?.bridge.status !== 'connected') {
      setTelegramError('Connect Telegram before sending a report.')
      return
    }

    const title = `Workspace report for ${projectName ?? activeProject}`
    const recentTask = taskHistory[0]
    const projectPath = activeProjectPath || 'unbound'
    const body = [
      `Project: ${projectPath}`,
      `Terminal: ${activeSession?.name ?? 'none'}`,
      `Mode: ${formatModeLabel(executionMode)}`,
      `Captured logs: ${agentContext?.lines.length ?? 0}`,
      `Latest task: ${recentTask ? `${recentTask.title} (${recentTask.status})` : 'none'}`,
    ].join('\n')

    try {
      setTelegramError(null)
      const report = await createTelegramReport({ title, body })
      setTelegramSnapshot((current) =>
        current
          ? {
              ...current,
              reports: [report, ...current.reports].slice(0, 8),
            }
          : current,
      )
      setActiveContext('Sprint 14 Telegram report queued')
      recordTask('Telegram report sent', title, 'done')
      await refreshTelegramState()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTelegramError(message)
      recordTask('Telegram report failed', message, 'error')
    }
  }, [
    activeProject,
    activeProjectPath,
    activeSession?.name,
    agentContext?.lines.length,
    executionMode,
    projectName,
    recordTask,
    refreshTelegramState,
    setActiveContext,
    taskHistory,
    telegramSnapshot?.bridge.status,
  ])

  const queueTelegramCommand = useCallback(
    async (command: 'status' | 'rerun' | 'diff') => {
      const presets = {
        status: {
          summary: 'Remote /status request from Telegram',
          command: 'git status --short',
          suggestedTarget: 'new_tab',
        },
        rerun: {
          summary: 'Remote /rerun-tests request from Telegram',
          command: 'npm run test -- --runInBand',
          suggestedTarget: 'current_tab',
        },
        diff: {
          summary: 'Remote /git-diff request from Telegram',
          command: 'git diff --stat',
          suggestedTarget: 'new_tab',
        },
      } as const

      try {
        setTelegramError(null)
        const remoteCommand = await queueTelegramRemoteCommand({
          sourceLabel: telegramSnapshot?.bridge.chatLabel ?? '@gtum_ops',
          summary: presets[command].summary,
          command: presets[command].command,
          suggestedTarget: presets[command].suggestedTarget,
        })
        setTelegramSnapshot((current) =>
          current
            ? {
                ...current,
                remoteCommands: [remoteCommand, ...current.remoteCommands].slice(0, 12),
              }
            : current,
        )
        setActiveContext('Sprint 14 Telegram remote command queued')
        recordTask('Telegram command queued', remoteCommand.summary, 'pending')
        await refreshTelegramState()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setTelegramError(message)
        recordTask('Telegram command queue failed', message, 'error')
      }
    },
    [recordTask, refreshTelegramState, setActiveContext, telegramSnapshot?.bridge.chatLabel],
  )

  const approveTelegramCommand = useCallback(
    async (
      remoteCommand: TelegramRemoteCommandSnapshot,
      target: 'current-tab' | 'new-tab',
    ) => {
      try {
        await executeCommandInTarget(remoteCommand.command, target, {
          newTabNameBase: 'telegram',
        })
        await resolveTelegramRemoteCommand({
          commandId: remoteCommand.commandId,
          status: 'executed',
          resolutionNote: `Approved in ${target}`,
        })
        setActiveContext('Sprint 14 Telegram command executed')
        recordTask('Telegram command executed', `${remoteCommand.command} -> ${target}`, 'done')
        await refreshTelegramState()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setTelegramError(message)
        recordTask('Telegram command execution failed', message, 'error')
      }
    },
    [executeCommandInTarget, recordTask, refreshTelegramState, setActiveContext],
  )

  const rejectTelegramCommand = useCallback(
    async (remoteCommand: TelegramRemoteCommandSnapshot) => {
      try {
        await resolveTelegramRemoteCommand({
          commandId: remoteCommand.commandId,
          status: 'rejected',
          resolutionNote: 'Rejected in gtum approval flow.',
        })
        setActiveContext('Sprint 14 Telegram command rejected')
        recordTask('Telegram command rejected', remoteCommand.summary, 'done')
        await refreshTelegramState()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setTelegramError(message)
        recordTask('Telegram rejection failed', message, 'error')
      }
    },
    [recordTask, refreshTelegramState, setActiveContext],
  )

  const draftTelegramReport = useCallback(() => {
    const projectLabel = projectName ?? activeProject
    const projectPath = activeProjectPath || 'No active project path'
    const terminalLabel = agentContext?.tabTitle ?? activeSession?.name ?? 'No active terminal'
    const latestTask = taskHistory[0]
    const recentLines = (terminalLogs?.entries || []).slice(-4)

    setTelegramReport({
      status: 'draft-ready',
      preview: [
        'Telegram status report draft',
        `Project: ${projectLabel}`,
        `Project path: ${projectPath}`,
        `Terminal: ${terminalLabel}`,
        `Execution mode: ${formatModeLabel(executionMode)}`,
        `Agent context: ${agentContext ? 'captured' : 'pending'}`,
        `Recent task: ${latestTask ? latestTask.title : 'No recent tasks'}`,
        `Log lines: ${recentLines.length > 0 ? recentLines.join(' | ') : 'No active terminal lines'}`,
      ].join('\n'),
      generatedAt: new Date().toISOString(),
      queuedAt: null,
    })
    setActiveContext('Post-MVP Telegram draft ready')
    recordTask('Telegram report drafted', `${projectLabel} • ${projectPath}`, 'done')
  }, [
    activeProject,
    activeProjectPath,
    activeSession?.name,
    agentContext,
    executionMode,
    projectName,
    recordTask,
    setActiveContext,
    taskHistory,
    terminalLogs?.entries,
  ])

  const queueTelegramReport = useCallback(() => {
    setTelegramReport((current) => {
      if (current.status === 'idle') {
        return current
      }

      return {
        ...current,
        status: 'queued',
        queuedAt: new Date().toISOString(),
      }
    })
    setActiveContext('Post-MVP Telegram draft queued')
    recordTask('Telegram report queued', 'Draft prepared for external channel handoff.', 'done')
  }, [recordTask, setActiveContext])

  const telegramPendingCommands = useMemo(
    () => telegramSnapshot?.remoteCommands.filter((entry) => entry.status === 'pending') ?? [],
    [telegramSnapshot?.remoteCommands],
  )

  return {
    telegramSnapshot,
    telegramError,
    telegramReport,
    telegramPendingCommands,
    startTelegramLink,
    completeTelegramMockLink,
    disconnectTelegram,
    sendTelegramStatusReport,
    queueTelegramCommand,
    approveTelegramCommand,
    rejectTelegramCommand,
    draftTelegramReport,
    queueTelegramReport,
    usesMockTelegramRuntime: usesMockRuntime(),
  }
}
