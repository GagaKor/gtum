import type { AgentProviderId, ExecutionMode } from '../../../lib/runtime'
import type { TaskHistoryEntry } from '../../tasks/model/types'
import type { TelegramReportState } from '../../telegram/model/types'
import type { LeftSidebarMode } from './useWorkbenchLayout'

const UI_STATE_KEY = 'gtum.app-ui-state'

export type PersistedUiState = {
  lastProjectPath?: string
  selectedFilePath?: string
  selectedFileLine?: number | null
  selectedProvider?: AgentProviderId
  executionMode?: ExecutionMode
  leftPanelMode?: LeftSidebarMode
  taskHistory?: TaskHistoryEntry[]
  telegramReport?: TelegramReportState
}

export const loadUiState = (): PersistedUiState | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(UI_STATE_KEY)
    return raw ? (JSON.parse(raw) as PersistedUiState) : null
  } catch {
    return null
  }
}

export const saveUiState = (state: PersistedUiState) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(UI_STATE_KEY, JSON.stringify(state))
}
