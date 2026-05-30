import {
  activeShellTab,
  shellWorkspaceStatus,
  type ShellIcons,
  type ShellLanguage,
  type ShellProject,
  type ShellProvider,
  type ShellTranslate,
  type ShellWorkspace,
} from './shellTypes'

export interface TitlebarProps {
  readonly lang: ShellLanguage
  readonly workspace: ShellWorkspace
  readonly providers: readonly ShellProvider[]
  readonly project: ShellProject
  readonly icons: Pick<ShellIcons, 'gear'>
  readonly translate: ShellTranslate
  readonly openSettings: () => void
}

export function Titlebar({
  lang,
  workspace,
  providers,
  project,
  icons,
  translate,
  openSettings,
}: TitlebarProps) {
  const connected = providers.filter((provider) => provider.state === 'connected')
  const activeTab = activeShellTab(workspace)
  const wsStatus = shellWorkspaceStatus(workspace)
  const groupCount = Object.keys(workspace.groups ?? {}).length
  const GearIcon = icons.gear

  return (
    <div className="titlebar" data-comment-anchor="titlebar">
      <div className="traffic">
        <span className="dot red" />
        <span className="dot yellow" />
        <span className="dot green" />
      </div>
      <div className="title-center">
        <span className="brand-dot" />
        <span className="brand">gtum</span>
        <span className="sep">›</span>
        <span>{project.name}</span>
        <span className="sep">·</span>
        <span style={{ color: 'var(--accent)' }}>{project.branch}</span>
        <span className="sep">·</span>
        <span>[{activeTab?.title || '—'}]</span>
        {groupCount > 1 && (
          <span style={{ color: 'var(--text-faint)' }}>· {groupCount} groups</span>
        )}
      </div>
      <div className="title-right">
        <span className="pill">
          <span className={'dot' + (wsStatus === 'failed' ? ' warn' : '')} />
          {lang === 'ko' ? '라이브' : 'Live'} · {connected.length}{' '}
          {translate(lang, 'activeAgent')}
        </span>
        <button
          className="pill icon-only"
          onClick={openSettings}
          title={translate(lang, 'settingsTitle')}
        >
          <GearIcon />
        </button>
      </div>
    </div>
  )
}
