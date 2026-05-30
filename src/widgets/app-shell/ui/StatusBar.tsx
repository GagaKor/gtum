import {
  allShellTabs,
  type ShellIcons,
  type ShellLanguage,
  type ShellProject,
  type ShellTranslate,
  type ShellWorkspace,
} from './shellTypes'

export interface StatusBarProps {
  readonly lang: ShellLanguage
  readonly mode: string
  readonly workspace: ShellWorkspace
  readonly project: ShellProject
  readonly icons: Pick<ShellIcons, 'dot' | 'branch'>
  readonly translate: ShellTranslate
}

export function StatusBar({
  lang,
  mode,
  workspace,
  project,
  icons,
  translate,
}: StatusBarProps) {
  const tabsList = allShellTabs(workspace)
  const failed = tabsList.filter((tab) => tab.status === 'failed').length
  const running = tabsList.filter((tab) => tab.status === 'running').length
  const groupCount = Object.keys(workspace.groups ?? {}).length
  const DotIcon = icons.dot
  const BranchIcon = icons.branch

  return (
    <div className="statusbar" data-comment-anchor="statusbar">
      <span className="item ok">
        <DotIcon /> {translate(lang, 'statusReady')}
      </span>
      <span className="sep">·</span>
      <span className="item">
        <BranchIcon /> {project.branch}
      </span>
      <span className="sep">·</span>
      <span className="item warn">
        {project.changedFiles} {translate(lang, 'changes')}
      </span>
      <span className="sep">·</span>
      <span className="item">↑{project.ahead} ↓{project.behind}</span>
      <span className="sep">·</span>
      <span className="item">
        {tabsList.length} {translate(lang, 'tabsLabel')} · {groupCount}{' '}
        {lang === 'ko' ? '그룹' : 'groups'}
        {failed > 0 && (
          <span style={{ color: 'var(--err)' }}>
            {' '}
            · {failed} {translate(lang, 'failed')}
          </span>
        )}
        {running > 0 && (
          <span style={{ color: 'var(--accent)' }}>
            {' '}
            · {running} {translate(lang, 'running')}
          </span>
        )}
      </span>
      <span className="spacer" />
      <span className="item">
        {translate(lang, 'mode')}:{' '}
        <span style={{ color: 'var(--accent)' }}>{translate(lang, mode)}</span>
      </span>
      <span className="sep">·</span>
      <span className="item">
        <span className="kbd">⌘K</span> {translate(lang, 'statusBarHint')}
      </span>
    </div>
  )
}
