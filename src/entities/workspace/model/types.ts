import type { ProjectSummary } from '../../project/model/types'

export type WorkspacePanel = 'left' | 'center' | 'right' | 'status'

export interface WorkspaceShellState {
  readonly activeProject?: ProjectSummary
  readonly activePanel: WorkspacePanel
  readonly leftDockWidth: number
  readonly rightDockWidth: number
}
