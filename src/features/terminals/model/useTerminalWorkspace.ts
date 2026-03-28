import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  appendMockTerminalLine,
  closeTerminalSession,
  createTerminalSession,
  createTerminalSessionWithCommand,
  executeTerminalSessionCommand,
  listTerminalSessions,
  readTerminalSessionLogs,
  renameTerminalSession,
  usesMockRuntime,
  type TerminalSessionLogs,
  type TerminalSessionSnapshot,
} from '../../../lib/runtime'
import type { AgentContextSnapshot } from '../../../stores/workspace-store'

export type CommandExecutionTarget = 'current-tab' | 'new-tab'

type UseTerminalWorkspaceParams = {
  activeProjectPath: string
  activeTerminalTabId: string
  agentContext: AgentContextSnapshot | null
  selectTerminalTab: (id: string) => void
  captureTerminalContext: (snapshot: AgentContextSnapshot | null) => void
}

export const useTerminalWorkspace = ({
  activeProjectPath,
  activeTerminalTabId,
  agentContext,
  selectTerminalTab,
  captureTerminalContext,
}: UseTerminalWorkspaceParams) => {
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionSnapshot[]>([])
  const [terminalLogs, setTerminalLogs] = useState<TerminalSessionLogs | null>(null)
  const [terminalError, setTerminalError] = useState<string | null>(null)

  const activeSession = useMemo(
    () => terminalSessions.find((session) => String(session.sessionId) === activeTerminalTabId) ?? null,
    [activeTerminalTabId, terminalSessions],
  )

  const refreshTerminalSessions = useCallback(async () => {
    try {
      const sessions = await listTerminalSessions()
      setTerminalSessions(sessions)

      if (sessions.length > 0 && !sessions.some((session) => String(session.sessionId) === activeTerminalTabId)) {
        selectTerminalTab(String(sessions[0].sessionId))
      }
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    }
  }, [activeTerminalTabId, selectTerminalTab])

  const refreshActiveTerminalLogs = useCallback(async (sessionId: string) => {
    try {
      const logs = await readTerminalSessionLogs(Number(sessionId), 120)
      setTerminalLogs(logs)
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    void refreshTerminalSessions()
  }, [refreshTerminalSessions])

  useEffect(() => {
    if (!activeTerminalTabId) {
      setTerminalLogs(null)
      return
    }

    void refreshActiveTerminalLogs(activeTerminalTabId)
    const timer = window.setInterval(() => {
      void refreshActiveTerminalLogs(activeTerminalTabId)
    }, 1200)

    return () => window.clearInterval(timer)
  }, [activeTerminalTabId, refreshActiveTerminalLogs])

  const ensureWorkspaceTerminal = useCallback(
    async (cwd: string) => {
      const sessions = await listTerminalSessions()
      if (sessions.length > 0) {
        setTerminalSessions(sessions)
        if (!activeTerminalTabId) {
          selectTerminalTab(String(sessions[0].sessionId))
        }
        return
      }

      const session = await createTerminalSession({
        name: 'workspace',
        cwd,
        maxLogEntries: 400,
      })
      setTerminalSessions([session])
      selectTerminalTab(String(session.sessionId))
    },
    [activeTerminalTabId, selectTerminalTab],
  )

  const createTab = useCallback(async () => {
    try {
      const session = await createTerminalSession({
        name: `tab-${terminalSessions.length + 1}`,
        cwd: activeProjectPath || undefined,
        maxLogEntries: 400,
      })
      setTerminalSessions((current) => [...current, session])
      selectTerminalTab(String(session.sessionId))
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : String(error))
    }
  }, [activeProjectPath, selectTerminalTab, terminalSessions.length])

  const renameTab = useCallback(
    async (sessionId: number, nextName: string) => {
      const trimmedName = nextName.trim()

      if (!trimmedName) {
        return
      }

      try {
        const updated = await renameTerminalSession(sessionId, trimmedName)
        setTerminalSessions((current) =>
          current.map((entry) => (entry.sessionId === updated.sessionId ? updated : entry)),
        )
        if (agentContext?.tabId === String(updated.sessionId)) {
          captureTerminalContext({
            ...agentContext,
            tabTitle: updated.name,
          })
        }
      } catch (error) {
        setTerminalError(error instanceof Error ? error.message : String(error))
      }
    },
    [agentContext, captureTerminalContext],
  )

  const closeTab = useCallback(
    async (sessionId: number) => {
      try {
        await closeTerminalSession(sessionId)
        setTerminalSessions((current) => {
          const nextSessions = current.filter((entry) => entry.sessionId !== sessionId)
          if (String(sessionId) === activeTerminalTabId) {
            selectTerminalTab(nextSessions[0] ? String(nextSessions[0].sessionId) : '')
          }
          return nextSessions
        })
        if (agentContext?.tabId === String(sessionId)) {
          captureTerminalContext(null)
        }
      } catch (error) {
        setTerminalError(error instanceof Error ? error.message : String(error))
      }
    },
    [activeTerminalTabId, agentContext?.tabId, captureTerminalContext, selectTerminalTab],
  )

  const captureAgentContextFromActiveTab = useCallback(() => {
    if (!activeSession || !terminalLogs) {
      return
    }

    const snapshot: AgentContextSnapshot = {
      tabId: String(activeSession.sessionId),
      tabTitle: activeSession.name,
      lines: terminalLogs.entries.slice(-50),
      capturedAt: new Date().toISOString(),
    }

    captureTerminalContext(snapshot)
  }, [activeSession, captureTerminalContext, terminalLogs])

  const simulateMockActivity = useCallback(async () => {
    if (!usesMockRuntime() || !activeTerminalTabId) {
      return
    }

    const sessionName = activeSession?.name || 'workspace'
    await appendMockTerminalLine(Number(activeTerminalTabId), `${sessionName}: live log sample`)
    await refreshActiveTerminalLogs(activeTerminalTabId)
    await refreshTerminalSessions()
  }, [activeSession?.name, activeTerminalTabId, refreshActiveTerminalLogs, refreshTerminalSessions])

  const launchCommandSession = useCallback(
    async ({
      name,
      command,
      cwd,
    }: {
      name: string
      command: string
      cwd?: string
    }) => {
      const session = await createTerminalSessionWithCommand({
        session: {
          name,
          cwd: cwd ?? activeProjectPath ?? activeSession?.cwd ?? undefined,
          maxLogEntries: 400,
        },
        command,
      })
      await refreshTerminalSessions()
      selectTerminalTab(String(session.sessionId))
      await refreshActiveTerminalLogs(String(session.sessionId))
      return session
    },
    [
      activeProjectPath,
      activeSession?.cwd,
      refreshActiveTerminalLogs,
      refreshTerminalSessions,
      selectTerminalTab,
    ],
  )

  const executeCommandInTarget = useCallback(
    async (
      command: string,
      target: CommandExecutionTarget,
      options: {
        newTabNameBase?: string
      } = {},
    ) => {
      if (target === 'current-tab') {
        if (!activeTerminalTabId) {
          return
        }

        if (usesMockRuntime()) {
          await appendMockTerminalLine(Number(activeTerminalTabId), command)
        } else {
          await executeTerminalSessionCommand(Number(activeTerminalTabId), command)
        }
        await refreshActiveTerminalLogs(activeTerminalTabId)
        await refreshTerminalSessions()
        return
      }

      const session = await createTerminalSession({
        name: `${options.newTabNameBase ?? 'tab'}-${terminalSessions.length + 1}`,
        cwd: activeProjectPath || undefined,
        maxLogEntries: 400,
      })
      setTerminalSessions((current) => [...current, session])
      selectTerminalTab(String(session.sessionId))

      if (usesMockRuntime()) {
        await appendMockTerminalLine(session.sessionId, command)
      } else {
        await executeTerminalSessionCommand(session.sessionId, command)
      }

      await refreshActiveTerminalLogs(String(session.sessionId))
      await refreshTerminalSessions()
    },
    [
      activeProjectPath,
      activeTerminalTabId,
      refreshActiveTerminalLogs,
      refreshTerminalSessions,
      selectTerminalTab,
      terminalSessions.length,
    ],
  )

  return {
    terminalSessions,
    terminalLogs,
    terminalError,
    activeSession,
    canCaptureActiveLog: Boolean(activeSession && terminalLogs),
    refreshTerminalSessions,
    refreshActiveTerminalLogs,
    ensureWorkspaceTerminal,
    createTab,
    renameTab,
    closeTab,
    captureAgentContextFromActiveTab,
    simulateMockActivity,
    launchCommandSession,
    executeCommandInTarget,
  }
}
