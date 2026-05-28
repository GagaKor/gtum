import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type {
  FileTreeNode,
  ProjectOverview,
  ProjectSearchResult,
  RuntimeInfo,
  SourceControlFileEntry,
  SourceControlOverview,
} from '../../../lib/runtime'
import type { LeftSidebarMode } from '../../../features/workspace/model/useWorkbenchLayout'
import type { OutlineEntry } from '../../../shared/lib/outline'
import { summarizePath } from '../../../shared/lib/formatters'
import { FileTreeNodeView } from '../../../shared/ui/FileTreeNode'

type ProjectSidebarProps = {
  visible: boolean
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void
  activeMode: LeftSidebarMode
  onSelectMode: (mode: LeftSidebarMode) => void
  onToggleVisibility: () => void
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
  projectList: string[]
  gitLabel: string
  selectedFilePath: string | null
  onSelectProjectFile: (node: FileTreeNode) => void
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  recentQueries: string[]
  searchResults: ProjectSearchResult[]
  isSearchLoading: boolean
  searchError: string | null
  onOpenSearchResult: (filePath: string, lineNumber: number) => void
  sourceControl: SourceControlOverview | null
  isSourceControlLoading: boolean
  sourceControlError: string | null
  onOpenSourceDiff: (file: SourceControlFileEntry, staged: boolean) => void
  onStageSourceFile: (file: SourceControlFileEntry) => void
  onUnstageSourceFile: (file: SourceControlFileEntry) => void
  commitMessage: string
  onCommitMessageChange: (value: string) => void
  onCommitSourceControl: () => void
  onPushSourceControl: () => void
  outlineEntries: OutlineEntry[]
  onOpenOutlineLine: (lineNumber: number) => void
  runtimeInfo: RuntimeInfo | null
}

type ProjectListItem = {
  id: string
  name: string
  path: string
  branch: string
  changedFiles: number
}

export function ProjectSidebar(props: ProjectSidebarProps) {
  const {
    visible,
    onToggleVisibility,
    activeProjectPath,
    activeProject,
    projectOverview,
    isProjectLoading,
    projectError,
    onChooseProjectFolder,
    onOpenProject,
    recentProjects,
    projectList,
    gitLabel,
    selectedFilePath,
    onSelectProjectFile,
  } = props
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)

  if (!visible) {
    return null
  }

  const activeItem = buildActiveProjectItem({
    activeProjectPath,
    activeProject,
    projectOverview,
    gitLabel,
  })
  const otherRecentProjects = recentProjects.filter((project) => project !== activeProjectPath)
  const savedProjects = projectList.filter(
    (project) => project !== activeProjectPath && !otherRecentProjects.includes(project),
  )
  const projectsCount =
    (activeProjectPath ? 1 : 0) + otherRecentProjects.length + savedProjects.length + 1
  const changedFileCount = projectOverview?.git.changedFilesCount ?? 0

  return (
    <aside className="sidebar left-dock" data-testid="left-dock">
      <div className="sb-titlebar">
        <span className="sb-title">Explorer</span>
        <button
          type="button"
          className="rail-toggle"
          onClick={onToggleVisibility}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          ‹
        </button>
      </div>

      <div className="sb-scroll">
        <ProjectAccordionSection
          label="Projects"
          count={projectsCount}
          open={projectsOpen}
          onToggle={() => setProjectsOpen((isOpen) => !isOpen)}
          testId="left-projects-section"
        >
          <div className="project-list">
            {activeItem ? (
              <ProjectItem project={activeItem} active onSelect={() => undefined} />
            ) : (
              <div className="project-empty">
                <span className="project-mark">G</span>
                <span className="project-info">
                  <span className="project-name">
                    <span className="nm">{activeProject || 'No Project'}</span>
                  </span>
                  <span className="project-meta">Open a local folder to start.</span>
                </span>
              </div>
            )}

            {recentProjects.length > 0 ? <div className="psm-h">Recent Projects</div> : null}
            {otherRecentProjects.map((project) => (
              <ProjectItem
                key={`recent-${project}`}
                project={projectFromPath(project, gitLabel)}
                active={project === activeProjectPath}
                onSelect={() => onOpenProject(project)}
              />
            ))}

            {savedProjects.length > 0 ? <div className="psm-h">Saved Projects</div> : null}
            {savedProjects.map((project) => (
              <ProjectItem
                key={`saved-${project}`}
                project={projectFromPath(project, 'saved')}
                active={false}
                onSelect={() => onOpenProject(project)}
              />
            ))}

            <button
              type="button"
              className="project-item action"
              data-testid="start-open-project-button"
              aria-label="Open Folder"
              onClick={onChooseProjectFolder}
              disabled={isProjectLoading}
            >
              <span className="project-mark plus">+</span>
              <span className="project-info">
                <span className="project-name">
                  <span className="nm">{isProjectLoading ? 'Opening...' : 'Open Folder'}</span>
                </span>
                <span className="project-meta">Open a local folder as a workspace</span>
              </span>
              <span className="kbd">⌘O</span>
            </button>
          </div>
          {projectError ? <p className="error-text sidebar-error">{projectError}</p> : null}
        </ProjectAccordionSection>

        <ProjectAccordionSection
          label="Files"
          count={changedFileCount > 0 ? `${changedFileCount} changed` : undefined}
          open={filesOpen}
          onToggle={() => setFilesOpen((isOpen) => !isOpen)}
          testId="left-files-section"
        >
          <div className="section-head tight sidebar-file-head">
            <strong>File Tree</strong>
            <span>{projectOverview ? projectOverview.metadata.name : 'empty'}</span>
          </div>
          {projectOverview ? (
            <ul className="tree-list">
              <FileTreeNodeView
                node={projectOverview.tree}
                selectedFilePath={selectedFilePath}
                onSelectFile={onSelectProjectFile}
              />
            </ul>
          ) : (
            <p className="secondary-text sidebar-empty">Open a project to browse files.</p>
          )}
        </ProjectAccordionSection>
      </div>
    </aside>
  )
}

function ProjectAccordionSection({
  label,
  count,
  open,
  onToggle,
  testId,
  children,
}: {
  label: string
  count?: number | string
  open: boolean
  onToggle: () => void
  testId: string
  children: ReactNode
}) {
  return (
    <section className={`sb-section${open ? ' open' : ' closed'}`} data-testid={testId}>
      <button
        type="button"
        className="sb-section-h"
        aria-label={label}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="sb-chev">{open ? '⌄' : '›'}</span>
        <span className="sb-section-label">{label}</span>
        {count != null ? (
          <span className="count" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </button>
      {open ? <div className="sb-section-body">{children}</div> : null}
    </section>
  )
}

function ProjectItem({
  project,
  active,
  onSelect,
}: {
  project: ProjectListItem
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`project-item${active ? ' active' : ''}`}
      aria-label={project.path}
      onClick={onSelect}
    >
      <span className={`project-mark${active ? ' active' : ''}`}>
        {project.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="project-info">
        <span className="project-name">
          <span className="nm">{project.name}</span>
          {active ? <span className="project-tag">current</span> : null}
        </span>
        <span className="project-meta">
          <span className="project-branch">{project.branch}</span>
          {project.changedFiles > 0 ? (
            <>
              <span className="project-meta-sep">·</span>
              <span className="project-changes">{project.changedFiles} changes</span>
            </>
          ) : null}
        </span>
        <span className="project-meta project-path-meta">{project.path}</span>
      </span>
    </button>
  )
}

function buildActiveProjectItem({
  activeProjectPath,
  activeProject,
  projectOverview,
  gitLabel,
}: {
  activeProjectPath: string
  activeProject: string
  projectOverview: ProjectOverview | null
  gitLabel: string
}): ProjectListItem | null {
  if (!activeProjectPath) {
    return null
  }

  return {
    id: activeProjectPath,
    name: projectOverview?.metadata.name ?? activeProject,
    path: activeProjectPath,
    branch: gitLabel,
    changedFiles: projectOverview?.git.changedFilesCount ?? 0,
  }
}

function projectFromPath(path: string, branch: string): ProjectListItem {
  return {
    id: path,
    name: summarizePath(path),
    path,
    branch,
    changedFiles: 0,
  }
}
