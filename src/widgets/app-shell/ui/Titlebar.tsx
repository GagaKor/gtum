import type { ReactNode } from 'react'
import type { AgentConnectionSnapshot } from '../../../lib/runtime'
import { formatProviderStatusLabel } from '../../../features/auth/model/provider-ui'
import { summarizePath } from '../../../shared/lib/formatters'

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
  leading?: ReactNode
  trailing?: ReactNode
}

const formatCount = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`

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
  leading,
  trailing,
}: TitlebarProps) {
  const providerAccount =
    selectedProvider && 'accountLabel' in selectedProvider ? selectedProvider.accountLabel : null

  return (
    <header className="app-titlebar mission-header" data-testid="app-titlebar">
      <div className="mission-brand">
        {leading}
        <div className="mission-brand-copy">
          <strong>{projectName ?? 'No project selected'}</strong>
          <span>{summarizePath(projectPath)}</span>
        </div>
      </div>

      <div className="mission-header-chips" aria-label="Workspace summary">
        <span className="status-badge scopes">{gitLabel}</span>
        <span className="status-badge scopes">Tab: {activeTabLabel}</span>
        <span className="status-badge scopes">{formatCount(groupCount, 'group', 'groups')}</span>
        <span className="status-badge scopes">
          {formatCount(connectedProviderCount, 'provider', 'providers')} connected
        </span>
        <span className="status-badge kind-real">{formatSelectedProvider(selectedProvider)}</span>
        {providerAccount ? <span className="status-badge scopes">{providerAccount}</span> : null}
        {trailing}
        <button
          type="button"
          className="ghost-button"
          data-testid="app-titlebar-settings-button"
          onClick={onOpenSettings}
          aria-label={settingsLabel}
          title={settingsLabel}
        >
          Settings
        </button>
      </div>
    </header>
  )
}
