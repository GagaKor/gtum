import type { MouseEvent } from 'react'

import {
  activeShellTab,
  shellWorkspaceStatus,
  type ShellIcons,
  type ShellLanguage,
  type ShellOs,
  type ShellProject,
  type ShellProvider,
  type ShellTranslate,
  type ShellWorkspace,
} from './shellTypes'

export interface TitlebarProps {
  readonly lang: ShellLanguage
  readonly os: ShellOs
  readonly maximized: boolean
  readonly workspace: ShellWorkspace
  readonly providers: readonly ShellProvider[]
  readonly project: ShellProject
  readonly icons: Pick<ShellIcons, 'gear'>
  readonly translate: ShellTranslate
  readonly openSettings: () => void
  readonly onMinimize: () => void
  readonly onToggleMax: () => void
  readonly onClose: () => void
  readonly onStartDrag?: () => void
}

interface WinControlsProps {
  readonly os: ShellOs
  readonly maximized: boolean
  readonly onMinimize: () => void
  readonly onToggleMax: () => void
  readonly onClose: () => void
}

function WinControls({ os, maximized, onMinimize, onToggleMax, onClose }: WinControlsProps) {
  if (os === 'windows') {
    return (
      <div className="win-controls" data-comment-anchor="window-controls">
        <button className="winbtn" title="Minimize" aria-label="Minimize" onClick={onMinimize}>
          <svg width="11" height="11" viewBox="0 0 11 11">
            <rect x="1" y="5" width="9" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="winbtn"
          title={maximized ? 'Restore' : 'Maximize'}
          aria-label="Maximize"
          onClick={onToggleMax}
        >
          {maximized ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="1.5" y="3.5" width="6" height="6" />
              <path d="M3.5 3.5V1.5h6v6h-2" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="1.5" y="1.5" width="8" height="8" />
            </svg>
          )}
        </button>
        <button className="winbtn close" title="Close" aria-label="Close" onClick={onClose}>
          <svg width="11" height="11" viewBox="0 0 11 11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
            <path d="M1.5 1.5l8 8M9.5 1.5l-8 8" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="traffic mac" data-comment-anchor="window-controls">
      <button className="dot red" title="Close" aria-label="Close" onClick={onClose}>
        <svg viewBox="0 0 12 12">
          <path d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8" />
        </svg>
      </button>
      <button className="dot yellow" title="Minimize" aria-label="Minimize" onClick={onMinimize}>
        <svg viewBox="0 0 12 12">
          <path d="M3 6h6" />
        </svg>
      </button>
      <button
        className="dot green"
        title={maximized ? 'Restore' : 'Maximize'}
        aria-label="Maximize"
        onClick={onToggleMax}
      >
        <svg viewBox="0 0 12 12">
          <path d="M4.2 4.2h2.2v2.2zM7.8 7.8H5.6V5.6z" />
        </svg>
      </button>
    </div>
  )
}

export function Titlebar({
  os,
  maximized,
  workspace,
  providers,
  project,
  icons,
  translate,
  openSettings,
  onMinimize,
  onToggleMax,
  onClose,
  onStartDrag,
  lang,
}: TitlebarProps) {
  const connected = providers.filter((provider) => provider.state === 'connected')
  const activeTab = activeShellTab(workspace)
  const wsStatus = shellWorkspaceStatus(workspace)
  const groupCount = Object.keys(workspace.groups ?? {}).length
  const GearIcon = icons.gear

  const breadcrumb = (
    <div className="breadcrumb">
      <span className="brand-dot" />
      <span className="brand">gtum</span>
      <span className="sep bc-detail">/</span>
      <span className="bc-detail">{project.name}</span>
      <span className="sep bc-detail">/</span>
      <span className="bc-detail" style={{ color: 'var(--accent)' }}>
        {project.branch}
      </span>
      <span className="sep bc-detail">/</span>
      <span className="bc-detail">[{activeTab?.title || '--'}]</span>
      {groupCount > 1 && (
        <span className="bc-detail" style={{ color: 'var(--text-faint)' }}>
          / {groupCount} groups
        </span>
      )}
    </div>
  )

  const status = (
    <div className="title-right">
      <span className="pill">
        <span className={'dot' + (wsStatus === 'failed' ? ' warn' : '')} />
        Live / {connected.length} {translate(lang, 'activeAgent')}
      </span>
      <button className="pill icon-only" onClick={openSettings} title={translate(lang, 'settingsTitle')}>
        <GearIcon />
      </button>
    </div>
  )

  const controls = (
    <WinControls
      os={os}
      maximized={maximized}
      onMinimize={onMinimize}
      onToggleMax={onToggleMax}
      onClose={onClose}
    />
  )

  const handleDragStart = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const target = event.target
    if (
      target instanceof Element &&
      target.closest('button, a, input, select, textarea, [role="button"], .win-controls, .traffic, .title-right')
    ) {
      return
    }

    onStartDrag?.()
  }

  if (os === 'windows') {
    return (
      <div
        className="titlebar os-windows"
        data-comment-anchor="titlebar"
        onDoubleClick={onToggleMax}
        onMouseDown={handleDragStart}
      >
        <div className="title-left">{breadcrumb}</div>
        <div className="title-spacer" />
        {status}
        {controls}
      </div>
    )
  }

  return (
    <div
      className="titlebar os-mac"
      data-comment-anchor="titlebar"
      onDoubleClick={onToggleMax}
      onMouseDown={handleDragStart}
    >
      {controls}
      <div className="title-center">{breadcrumb}</div>
      {status}
    </div>
  )
}
