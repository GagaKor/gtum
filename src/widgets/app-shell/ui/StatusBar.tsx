import type { ReactNode } from 'react'
import type { ExecutionMode } from '../../../lib/runtime'
import { formatModeLabel } from '../../../shared/lib/formatters'

export type StatusBarProps = {
  gitLabel: string
  changedFileCount?: number | null
  tabCount: number
  groupCount: number
  executionMode: ExecutionMode
  activeContext: string
  leading?: ReactNode
  trailing?: ReactNode
}

const formatCount = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`

export function StatusBar({
  gitLabel,
  changedFileCount,
  tabCount,
  groupCount,
  executionMode,
  activeContext,
  leading,
  trailing,
}: StatusBarProps) {
  return (
    <footer className="app-statusbar" data-testid="app-statusbar" aria-label="Workspace status">
      {leading}
      <span className="status-badge scopes">{gitLabel}</span>
      {typeof changedFileCount === 'number' ? (
        <span className="status-badge scopes">
          {formatCount(changedFileCount, 'changed file', 'changed files')}
        </span>
      ) : null}
      <span className="status-badge scopes">{formatCount(tabCount, 'tab', 'tabs')}</span>
      <span className="status-badge scopes">{formatCount(groupCount, 'group', 'groups')}</span>
      <span className="status-badge kind-real">Mode: {formatModeLabel(executionMode)}</span>
      <span className="status-badge scopes">Context: {activeContext}</span>
      {trailing}
    </footer>
  )
}
