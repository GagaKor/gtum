import type { AgentConnectionSnapshot } from '../../../lib/runtime'
import { formatProviderStatusLabel } from '../../../features/auth/model/provider-ui'

export type TitlebarProviderSummary = {
  displayName: string
  statusLabel: string
  accountLabel?: string | null
}

export type TitlebarProps = {
  projectName: string | null
  projectPath: string | null
  gitLabel: string
  activeTabLabel: string
  groupCount: number
  connectedProviderCount: number
  selectedProvider: TitlebarProviderSummary | AgentConnectionSnapshot | null
  onOpenSettings: () => void
  settingsLabel?: string
}

const formatSelectedProvider = (
  selectedProvider: TitlebarProps['selectedProvider'],
) => {
  if (!selectedProvider) {
    return 'No provider selected'
  }

  if ('status' in selectedProvider) {
    return `${selectedProvider.displayName} ${formatProviderStatusLabel(selectedProvider.status)}`
  }

  return `${selectedProvider.displayName} ${selectedProvider.statusLabel}`
}

export function Titlebar({
  projectName,
  projectPath,
  gitLabel,
  activeTabLabel,
  groupCount,
  connectedProviderCount,
  selectedProvider,
  onOpenSettings,
  settingsLabel = 'Settings',
}: TitlebarProps) {
  return (
    <header className="titlebar app-titlebar" data-testid="app-titlebar">
      <div className="traffic" data-testid="app-window-controls" aria-hidden="true">
        <span className="dot red" />
        <span className="dot yellow" />
        <span className="dot green" />
      </div>

      <div className="title-center" aria-label="Workspace summary">
        <span className="brand-dot" />
        <span className="brand">gtum</span>
        <span className="sep">›</span>
        <span>{projectName ?? 'No Project'}</span>
        <span className="sep">·</span>
        <span className="title-branch">{gitLabel}</span>
        <span className="sep">·</span>
        <span>[{activeTabLabel || 'workspace'}]</span>
        {groupCount > 1 ? (
          <>
            <span className="sep">·</span>
            <span>{groupCount} groups</span>
          </>
        ) : null}
        {projectPath ? (
          <>
            <span className="sep">·</span>
            <span>{projectPath}</span>
          </>
        ) : null}
      </div>

      <div className="title-right">
        <span className="pill">
          <span className="dot" />
          Live · {connectedProviderCount} agent{connectedProviderCount === 1 ? '' : 's'}
        </span>
        <span className="pill">{formatSelectedProvider(selectedProvider)}</span>
        <button
          type="button"
          className="pill icon-only"
          data-testid="app-titlebar-settings-button"
          onClick={onOpenSettings}
          aria-label={settingsLabel}
          title={settingsLabel}
        >
          ⚙
        </button>
      </div>
    </header>
  )
}
