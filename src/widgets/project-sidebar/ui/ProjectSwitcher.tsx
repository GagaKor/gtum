import type { ReactNode } from 'react'

import type { ProjectWorkspaceRow } from '../../../features/projects/model/useProjectWorkspaces'

export type ProjectSwitcherProps = {
  rows: ProjectWorkspaceRow[]
  activePath: string | null
  openingProject: boolean
  openProjectLabel: string
  openingProjectLabel: string
  openProjectHint: string
  onSelectProject(path: string): void
  onOpenProject(): void
  activeDetails?: ReactNode
  plusIcon?: ReactNode
  branchIcon?: ReactNode
}

export function ProjectSwitcher({
  rows,
  activePath,
  openingProject,
  openProjectLabel,
  openingProjectLabel,
  openProjectHint,
  onSelectProject,
  onOpenProject,
  activeDetails,
  plusIcon,
  branchIcon,
}: ProjectSwitcherProps) {
  return (
    <div className="project-list project-switcher">
      {rows.map((entry) => {
        const active = entry.path === activePath
        const project = entry.project
        const status = entry.error
          ? entry.error
          : entry.hydration === 'loading'
            ? 'Loading project'
            : entry.hydration === 'idle'
              ? entry.path
              : project.branch

        const row = (
          <button
            aria-pressed={active}
            className={`project-item${active ? ' active' : ''}`}
            data-project-path={entry.path}
            data-project-state={entry.hydration}
            key={entry.path}
            onClick={() => onSelectProject(entry.path)}
            type="button"
          >
            <span className={`project-mark${active ? ' active' : ''}`}>
              {(project.name || '?')[0].toUpperCase()}
            </span>
            <span className="project-info">
              <span className="project-name">
                <span className="nm">{project.name}</span>
                {active && <span className="project-tag">current</span>}
              </span>
              <span className={`project-meta${entry.error ? ' project-error' : ''}`}>
                {!entry.error && branchIcon}
                <span className="project-branch">{status}</span>
                {!entry.error && project.changedFiles > 0 && (
                  <>
                    <span className="project-meta-sep">/</span>
                    <span className="project-changes">{project.changedFiles} changes</span>
                  </>
                )}
              </span>
            </span>
          </button>
        )

        return active ? (
          <div className="project-group open" key={entry.path}>
            {row}
            {activeDetails}
          </div>
        ) : row
      })}
      <button
        className="project-item action"
        disabled={openingProject}
        onClick={onOpenProject}
        type="button"
      >
        <span className="project-mark plus">{plusIcon}</span>
        <span className="project-info">
          <span className="project-name">
            <span className="nm">{openProjectLabel}</span>
          </span>
          <span className="project-meta">
            {openingProject ? openingProjectLabel : openProjectHint}
          </span>
        </span>
        <span className="kbd">Open</span>
      </button>
    </div>
  )
}
