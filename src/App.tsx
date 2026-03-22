import { useEffect, useState } from 'react'
import './App.css'
import { useWorkspaceStore } from './stores/workspace-store'
import {
  type FileTreeNode,
  type ProjectOverview,
  type RuntimeInfo,
  getRuntimeInfo,
  readProjectOverview,
} from './lib/runtime'

function TreeNode({ node, depth = 0 }: { node: FileTreeNode; depth?: number }) {
  return (
    <li>
      <div className={`tree-row ${node.kind}`} style={{ paddingLeft: `${depth * 14}px` }}>
        <span className="tree-icon">{node.kind === 'directory' ? '▸' : '·'}</span>
        <span className="tree-name">{node.name}</span>
        {node.truncated ? <span className="tree-meta">depth limit</span> : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="tree-list">
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function App() {
  const {
    activeProject,
    activeContext,
    activeProjectPath,
    projectPathInput,
    recentProjects,
    panels,
    setActiveProject,
    setActiveContext,
    setActiveProjectPath,
    setProjectPathInput,
    rememberProject,
    togglePanel,
  } = useWorkspaceStore()
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [projectOverview, setProjectOverview] = useState<ProjectOverview | null>(null)
  const [isProjectLoading, setIsProjectLoading] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)

  useEffect(() => {
    getRuntimeInfo()
      .then(setRuntimeInfo)
      .catch(() => {
        setRuntimeInfo(null)
      })
  }, [])

  const openProject = async (path: string) => {
    const trimmedPath = path.trim()

    if (!trimmedPath) {
      setProjectError('Enter a local project path to load.')
      return
    }

    setProjectError(null)
    setIsProjectLoading(true)

    try {
      const overview = await readProjectOverview(trimmedPath)

      setProjectOverview(overview)
      setActiveProject(overview.metadata.name)
      setActiveProjectPath(overview.metadata.path)
      setProjectPathInput(overview.metadata.path)
      setActiveContext('Sprint 1 Project Workspace')
      rememberProject(overview.metadata.path)
    } catch (error) {
      setProjectOverview(null)
      setProjectError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsProjectLoading(false)
    }
  }

  const gitLabel = projectOverview?.git.isRepository
    ? `${projectOverview.git.branch ?? 'detached'} • ${
        projectOverview.git.isDirty ? 'Dirty' : 'Clean'
      }`
    : 'No Git repository detected'

  return (
    <div className="app-shell">
      {panels.projects ? (
        <aside className="panel sidebar">
          <div className="panel-header">
            <span className="eyebrow">Projects</span>
            <button onClick={() => togglePanel('projects')}>Hide</button>
          </div>
          <h1>gtum</h1>
          <p className="lead">
            Project-centric terminal workspace for agents, code, and live logs.
          </p>
          <div className="stack">
            <label className="field-block">
              <span className="label">Project Path</span>
              <input
                value={projectPathInput}
                onChange={(event) => setProjectPathInput(event.target.value)}
                placeholder="/home/kwon/project/gtum"
              />
            </label>
            <button onClick={() => void openProject(projectPathInput)}>
              {isProjectLoading ? 'Opening...' : 'Open Project'}
            </button>
            {projectError ? <p className="error-text">{projectError}</p> : null}
          </div>
          <div className="stack">
            <article className="card">
              <span className="label">Active Project</span>
              <strong>{activeProject}</strong>
              <p>{activeProjectPath || 'Open a local path to inspect repository context.'}</p>
            </article>
            <article className="card">
              <span className="label">Sprint Focus</span>
              <strong>{activeContext}</strong>
              <p>Project open, file exploration, and Git state visibility.</p>
            </article>
            <article className="card">
              <span className="label">Recent Projects</span>
              <div className="stack compact">
                {recentProjects.length > 0 ? (
                  recentProjects.map((project) => (
                    <button
                      key={project}
                      className="recent-project"
                      onClick={() => void openProject(project)}
                    >
                      {project}
                    </button>
                  ))
                ) : (
                  <p>No recent projects yet.</p>
                )}
              </div>
            </article>
          </div>
        </aside>
      ) : (
        <button className="rail-button left" onClick={() => togglePanel('projects')}>
          Show Projects
        </button>
      )}

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2>Project workspace with repository context</h2>
          </div>
          <div className="pill-row">
            <span className="pill">Sprint 1</span>
            <span className="pill">Project Open</span>
            <span className="pill">Git Context</span>
          </div>
        </header>

        <section className="workspace-body">
          <div className="terminal-stage">
            <div className="terminal-tabs">
              <button className="tab active">workspace</button>
              <button className="tab">agents</button>
              <button className="tab">tests</button>
            </div>
            <div className="terminal-window">
              <div className="terminal-line">$ sprint-1:open-project</div>
              <div className="terminal-line dim">
                Load a local repository path to inspect files, metadata, and Git state.
              </div>
              <div className="terminal-line">$ runtime-info</div>
              <div className="terminal-line">
                {runtimeInfo
                  ? `${runtimeInfo.app_name} • ${runtimeInfo.platform} • ${runtimeInfo.mode}`
                  : 'Runtime handshake pending or unavailable in browser-only mode.'}
              </div>
              <div className="terminal-line">$ project-overview</div>
              <div className="terminal-line">
                {projectOverview
                  ? `${projectOverview.metadata.name} • ${
                      projectOverview.tree.children.length
                    } root entries`
                  : 'No project loaded yet.'}
              </div>
            </div>
          </div>

          <section className="status-grid">
            <article className="card emphasis">
              <span className="label">Project</span>
              <strong>{projectOverview?.metadata.name ?? 'Awaiting Selection'}</strong>
              <p>
                {projectOverview?.metadata.path ??
                  'Pick a local project path to populate the workspace.'}
              </p>
            </article>
            <article className="card">
              <span className="label">Git</span>
              <strong>{gitLabel}</strong>
              <p>
                {projectOverview?.git.isRepository
                  ? `${projectOverview.git.changedFilesCount} changed file(s) • ${
                      projectOverview.git.branchType ?? 'other'
                    } branch type`
                  : 'Branch and dirty state will appear for Git repositories.'}
              </p>
            </article>
            <article className="card">
              <span className="label">Runtime Probe</span>
              <strong>{runtimeInfo ? 'Connected' : 'Fallback Mode'}</strong>
              <p>Filesystem and Git reads are now layered on top of the Sprint 0 shell.</p>
            </article>
          </section>

          <section className="project-grid">
            <article className="card project-card">
              <span className="label">Project Metadata</span>
              <strong>{projectOverview?.metadata.name ?? 'No project selected'}</strong>
              <p>{projectOverview?.metadata.path ?? 'Open a project to continue.'}</p>
              <div className="meta-strip">
                <span className="pill soft">
                  {projectOverview?.metadata.exists ? 'Exists' : 'Missing'}
                </span>
                <span className="pill soft">
                  {projectOverview?.metadata.isDirectory ? 'Directory' : 'Unknown'}
                </span>
                <span className="pill soft">
                  {projectOverview ? `${projectOverview.tree.children.length} root entries` : '0 entries'}
                </span>
              </div>
            </article>

            <article className="card project-card">
              <span className="label">File Tree</span>
              {projectOverview ? (
                <ul className="tree-list">
                  <TreeNode node={projectOverview.tree} />
                </ul>
              ) : (
                <p>Load a project to inspect its directory structure.</p>
              )}
            </article>
          </section>
        </section>
      </main>

      {panels.agents ? (
        <aside className="panel inspector">
          <div className="panel-header">
            <span className="eyebrow">Agents</span>
            <button onClick={() => togglePanel('agents')}>Hide</button>
          </div>
          <div className="stack">
            <article className="card">
              <span className="label">Orchestrator</span>
              <strong>Active</strong>
              <p>Tracking Sprint 1 progress against docs, PR flow, and repository state.</p>
            </article>
            <article className="card">
              <span className="label">Context</span>
              <strong>Project + Git</strong>
              <p>Agent context can soon inherit file tree and repository summaries from here.</p>
            </article>
            <article className="card">
              <span className="label">Policy</span>
              <strong>feature → dev → master</strong>
              <p>Each sprint closes with docs sync, UI E2E, and next-sprint backlog updates.</p>
            </article>
          </div>
        </aside>
      ) : (
        <button className="rail-button right" onClick={() => togglePanel('agents')}>
          Show Agents
        </button>
      )}
    </div>
  )
}

export default App
