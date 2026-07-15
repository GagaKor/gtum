import type { ReactNode } from 'react'

import type { ProjectAgentSummary } from '../../../features/agents/model/projectAgentFleet'
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
  onCloseProject?(path: string): void
  agentSummariesByPath?: Record<string, ProjectAgentSummary | undefined>
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
  onCloseProject,
  agentSummariesByPath = {},
  activeDetails,
  plusIcon,
  branchIcon,
}: ProjectSwitcherProps) {
  return (
    <div className="project-list project-switcher">
      {rows.map((entry) => {
        const active = entry.path === activePath
        const project = entry.project
        const agentSummary = agentSummariesByPath[entry.path]
        const closeState = entry.closeChecking
          ? 'checking'
          : entry.closeBlockedReason
            ? 'blocked'
            : 'ready'
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
            data-agent-state={agentSummary?.state}
            data-agent-working-count={agentSummary?.workingCount ?? 0}
            data-agent-review-count={agentSummary?.reviewCount ?? 0}
            data-agent-attention-count={agentSummary?.attentionCount ?? 0}
            data-agent-done-count={agentSummary?.doneCount ?? 0}
            data-agent-job-count={agentSummary?.jobCount ?? 0}
            data-project-close-state={closeState}
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
                {agentSummary && (
                  <span className={`project-agent-summary ${agentSummary.state}`}>
                    {agentSummary.label}
                  </span>
                )}
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

        const rowWithClose = (
          <div className="project-row-shell" key={entry.path}>
            {row}
            {onCloseProject && (
              <button
                aria-label={`Close ${project.name} project`}
                className="project-close"
                data-close-state={closeState}
                data-project-close-path={entry.path}
                disabled={entry.closeChecking}
                onClick={() => onCloseProject(entry.path)}
                title={entry.closeChecking
                  ? `Checking ${project.name}`
                  : entry.closeBlockedReason || `Close ${project.name}`}
                type="button"
              >
                {entry.closeChecking ? '…' : '×'}
              </button>
            )}
            {entry.closeBlockedReason && (
              <span className="project-close-reason" role="status">
                {entry.closeBlockedReason}
              </span>
            )}
          </div>
        )

        return active ? (
          <div className="project-group open" key={entry.path}>
            {rowWithClose}
            {activeDetails}
          </div>
        ) : rowWithClose
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
