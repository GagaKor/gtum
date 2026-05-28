import type { ExecutionMode } from '../../../lib/runtime'
import { formatModeLabel } from '../../../shared/lib/formatters'

export type StatusBarProps = {
  gitLabel: string
  changedFileCount?: number | null
  tabCount: number
  groupCount: number
  executionMode: ExecutionMode
  activeContext: string
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
}: StatusBarProps) {
  return (
    <footer className="statusbar app-statusbar" data-testid="app-statusbar" aria-label="Workspace status">
      <span className="item ok">● Ready</span>
      <span className="sep">·</span>
      <span className="item">{gitLabel}</span>
      {typeof changedFileCount === 'number' ? (
        <>
          <span className="sep">·</span>
          <span className="item warn">{formatCount(changedFileCount, 'changed file', 'changed files')}</span>
        </>
      ) : null}
      <span className="sep">·</span>
      <span className="item">
        {formatCount(tabCount, 'tab', 'tabs')} · {formatCount(groupCount, 'group', 'groups')}
      </span>
      <span className="spacer" />
      <span className="item">
        Mode: <span className="accent">{formatModeLabel(executionMode)}</span>
      </span>
      <span className="sep">·</span>
      <span className="item">{activeContext}</span>
    </footer>
  )
}
