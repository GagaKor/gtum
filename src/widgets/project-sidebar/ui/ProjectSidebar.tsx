import type { FileTreeNode, ProjectOverview } from '../../../lib/runtime'
import { summarizePath } from '../../../shared/lib/formatters'
import { FileTreeNodeView } from '../../../shared/ui/FileTreeNode'

type ProjectSidebarProps = {
  visible: boolean
  onToggle: () => void
  activeProjectPath: string
  activeProject: string
  projectOverview: ProjectOverview | null
  isProjectLoading: boolean
  projectError: string | null
  projectPathInput: string
  onProjectPathInputChange: (value: string) => void
  onChooseProjectFolder: () => void
  onOpenProject: (path: string) => void
  recentProjects: string[]
  gitLabel: string
  selectedFilePath: string | null
  onSelectProjectFile: (node: FileTreeNode) => void
}

export function ProjectSidebar({
  visible,
  onToggle,
  activeProjectPath,
  activeProject,
  projectOverview,
  isProjectLoading,
  projectError,
  projectPathInput,
  onProjectPathInputChange,
  onChooseProjectFolder,
  onOpenProject,
  recentProjects,
  gitLabel,
  selectedFilePath,
  onSelectProjectFile,
}: ProjectSidebarProps) {
  if (!visible) {
    return (
      <button className="rail-button left" onClick={onToggle}>
        Show Projects
      </button>
    )
  }

  return (
    <aside className="panel sidebar">
      <div className="panel-header">
        <span className="eyebrow">Projects</span>
        <button onClick={onToggle}>Hide</button>
      </div>
      <div className="brand-lockup">
        <img className="brand-logo" src="/brand/gtum-logo.svg" alt="gtum" />
        <h1 className="visually-hidden">gtum</h1>
      </div>
      <p className="lead">Project-centric terminal workspace for agents, code, and live logs.</p>
      <div className="stack">
        <article className="card emphasis">
          <span className="label">Start</span>
          <strong>{activeProjectPath ? projectOverview?.metadata.name ?? activeProject : 'Open a project'}</strong>
          <p>
            {activeProjectPath
              ? `${summarizePath(activeProjectPath)} is ready for terminal and agent work.`
              : 'Use the folder picker to open a local project without pasting paths manually.'}
          </p>
          <div className="button-row">
            <button
              data-testid="start-open-project-button"
              onClick={onChooseProjectFolder}
              disabled={isProjectLoading}
            >
              {isProjectLoading ? 'Opening...' : 'Open Folder'}
            </button>
          </div>
          {projectError ? <p className="error-text">{projectError}</p> : null}
          <details className="subtle-disclosure">
            <summary>Manual Path Fallback</summary>
            <div className="stack compact">
              <label className="field-block">
                <span className="label">Project Path</span>
                <input
                  aria-label="Project Path"
                  value={projectPathInput}
                  onChange={(event) => onProjectPathInputChange(event.target.value)}
                  placeholder="/home/kwon/project/gtum"
                />
              </label>
              <button onClick={() => onOpenProject(projectPathInput)} disabled={isProjectLoading}>
                Open Project
              </button>
            </div>
          </details>
        </article>
        <article className="card">
          <span className="label">Recent Projects</span>
          <div className="stack compact">
            {recentProjects.length > 0 ? (
              recentProjects.map((project) => (
                <button key={project} className="recent-project" onClick={() => onOpenProject(project)}>
                  {project}
                </button>
              ))
            ) : (
              <p>No recent projects yet.</p>
            )}
          </div>
        </article>
        <article className="card">
          <span className="label">Repository</span>
          <strong>{projectOverview?.metadata.name ?? 'No project selected'}</strong>
          <p>{gitLabel}</p>
          <div className="meta-strip">
            <span className="pill soft">{projectOverview?.metadata.exists ? 'Exists' : 'Missing'}</span>
            <span className="pill soft">
              {projectOverview?.metadata.isDirectory ? 'Directory' : 'Unknown'}
            </span>
          </div>
        </article>
        <article className="card project-tree-card">
          <span className="label">File Tree</span>
          {projectOverview ? (
            <ul className="tree-list">
              <FileTreeNodeView
                node={projectOverview.tree}
                selectedFilePath={selectedFilePath}
                onSelectFile={onSelectProjectFile}
              />
            </ul>
          ) : (
            <p>Open a project to inspect its directory structure.</p>
          )}
        </article>
      </div>
    </aside>
  )
}
