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

const railItems: { mode: LeftSidebarMode; label: string; icon: string; placement?: 'bottom' }[] = [
  { mode: 'project', label: '프로젝트', icon: '⌘' },
  { mode: 'explorer', label: '탐색기', icon: '⌕' },
  { mode: 'source-control', label: '소스 제어', icon: '⑂' },
  { mode: 'outline', label: '아웃라인', icon: '⋮' },
  { mode: 'settings', label: '설정', icon: '⚙', placement: 'bottom' },
]

export function ProjectSidebar({
  visible,
  onResizeStart,
  activeMode,
  onSelectMode,
  onToggleVisibility,
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
  projectList,
  gitLabel,
  selectedFilePath,
  onSelectProjectFile,
  searchQuery,
  onSearchQueryChange,
  recentQueries,
  searchResults,
  isSearchLoading,
  searchError,
  onOpenSearchResult,
  sourceControl,
  isSourceControlLoading,
  sourceControlError,
  onOpenSourceDiff,
  onStageSourceFile,
  onUnstageSourceFile,
  commitMessage,
  onCommitMessageChange,
  onCommitSourceControl,
  onPushSourceControl,
  outlineEntries,
  onOpenOutlineLine,
  runtimeInfo,
}: ProjectSidebarProps) {
  const [projectsSectionOpen, setProjectsSectionOpen] = useState(true)
  const [filesSectionOpen, setFilesSectionOpen] = useState(true)
  const activeProjectName = projectOverview?.metadata.name ?? activeProject
  const currentProjectSummary = activeProjectPath
    ? `${summarizePath(activeProjectPath)} • ${gitLabel}`
    : '열린 프로젝트가 없습니다.'
  const savedProjectCount = projectList.filter((project) => project !== activeProjectPath).length

  const handleModeSelection = (mode: LeftSidebarMode) => {
    if (visible && activeMode === mode) {
      onToggleVisibility()
      return
    }

    onSelectMode(mode)
  }

  return (
    <aside className={`left-dock ${visible ? 'expanded' : 'collapsed'}`} data-testid="left-dock">
      <div className="activity-rail" aria-label="왼쪽 메뉴">
        <div className="activity-rail-top">
          {railItems
            .filter((item) => item.placement !== 'bottom')
            .map((item) => (
              <button
                key={item.mode}
                type="button"
                className={`activity-button ${activeMode === item.mode ? 'active' : ''}`}
                aria-label={item.label}
                title={item.label}
                onClick={() => handleModeSelection(item.mode)}
              >
                <span>{item.icon}</span>
              </button>
            ))}
        </div>
        <div className="activity-rail-bottom">
          {railItems
            .filter((item) => item.placement === 'bottom')
            .map((item) => (
              <button
                key={item.mode}
                type="button"
                className={`activity-button ${activeMode === item.mode ? 'active' : ''}`}
                aria-label={item.label}
                title={item.label}
                onClick={() => handleModeSelection(item.mode)}
              >
                <span>{item.icon}</span>
              </button>
            ))}
        </div>
      </div>

      {visible ? (
        <div className="left-panel">
          <div className="left-panel-header">
            <div>
              <span className="eyebrow">Mission Control</span>
              <strong>{modeTitle(activeMode)}</strong>
              <p>{modeSubtitle(activeMode)}</p>
            </div>
            <button type="button" className="ghost-button" onClick={onToggleVisibility}>
              접기
            </button>
          </div>

          {activeMode === 'project' ? (
            <div className="left-panel-scroll">
              <ProjectAccordionSection
                title="Projects"
                status={activeProjectPath ? 'active' : 'empty'}
                sectionId="left-projects-content"
                isOpen={projectsSectionOpen}
                onToggle={() => setProjectsSectionOpen((isOpen) => !isOpen)}
                className="emphasis"
                testId="left-projects-section"
              >
                <strong className="primary-text">
                  {activeProjectPath ? activeProjectName : '프로젝트를 열어주세요'}
                </strong>
                <p className="secondary-text">{currentProjectSummary}</p>
                <div className="project-metadata-grid" aria-label="Project metadata">
                  <div>
                    <span>Current</span>
                    <strong>{activeProjectPath ? activeProjectName : 'none'}</strong>
                  </div>
                  <div>
                    <span>Recent Projects</span>
                    <strong>{recentProjects.length}</strong>
                  </div>
                  <div>
                    <span>Project List</span>
                    <strong>{savedProjectCount}</strong>
                  </div>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    data-testid="start-open-project-button"
                    onClick={onChooseProjectFolder}
                    disabled={isProjectLoading}
                  >
                    {isProjectLoading ? '열는 중...' : 'Open Folder'}
                  </button>
                  <button type="button" onClick={() => onOpenProject(projectPathInput)} disabled={!projectPathInput.trim()}>
                    경로 열기
                  </button>
                </div>
                <label className="field-block">
                  <span className="label">Project Path</span>
                  <input
                    aria-label="Project Path"
                    value={projectPathInput}
                    onChange={(event) => onProjectPathInputChange(event.target.value)}
                    placeholder="C:/Users/demo/demo-project"
                  />
                </label>
                {projectError ? <p className="error-text">{projectError}</p> : null}
                <div className="list-stack">
                  <div className="section-head tight">
                    <strong>Recent Projects</strong>
                    <span>{recentProjects.length}</span>
                  </div>
                  {recentProjects.length > 0 ? (
                    recentProjects.map((project) => (
                      <button
                        key={project}
                        type="button"
                        className="list-row"
                        aria-label={project}
                        onClick={() => onOpenProject(project)}
                      >
                        <span className="ellipsis">{project}</span>
                        <span className="row-tail" aria-hidden="true">
                          전환
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="secondary-text">아직 최근 프로젝트가 없습니다.</p>
                  )}
                </div>
                <div className="list-stack">
                  <div className="section-head tight">
                    <strong>Project List</strong>
                    <span>{savedProjectCount}</span>
                  </div>
                  {savedProjectCount > 0 ? (
                    projectList
                      .filter((project) => project !== activeProjectPath)
                      .map((project) => (
                        <button
                          key={project}
                          type="button"
                          className="list-row"
                          aria-label={`${project} saved project`}
                          onClick={() => onOpenProject(project)}
                        >
                          <span className="ellipsis">Saved • {project}</span>
                          <span className="row-tail" aria-hidden="true">
                            saved
                          </span>
                        </button>
                      ))
                  ) : (
                    <p className="secondary-text">저장된 다른 프로젝트가 없습니다.</p>
                  )}
                </div>
              </ProjectAccordionSection>

              <ProjectAccordionSection
                title="Files"
                status={projectOverview ? 'jump' : 'empty'}
                sectionId="left-files-content"
                isOpen={filesSectionOpen}
                onToggle={() => setFilesSectionOpen((isOpen) => !isOpen)}
                className="project-tree-panel"
                testId="left-files-section"
              >
                <div className="section-head tight">
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
                  <p className="secondary-text">프로젝트를 열면 여기서 파일로 바로 이동할 수 있습니다.</p>
                )}
              </ProjectAccordionSection>
            </div>
          ) : null}

          {activeMode === 'explorer' ? (
            <div className="left-panel-scroll">
              <article className="side-section emphasis">
                <div className="section-head">
                  <strong>현재 프로젝트 검색</strong>
                  <span>{searchResults.length} file(s)</span>
                </div>
                <label className="field-block">
                  <span className="label">Search Query</span>
                  <input
                    aria-label="Project Search"
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)}
                    placeholder="찾을 문구를 입력하세요"
                  />
                </label>
                {recentQueries.length > 0 ? (
                  <div className="chip-row">
                    {recentQueries.map((query) => (
                      <button key={query} type="button" className="chip" onClick={() => onSearchQueryChange(query)}>
                        {query}
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>

              <article className="side-section">
                <div className="section-head">
                  <strong>검색 결과</strong>
                  <span>{isSearchLoading ? 'loading' : searchResults.length}</span>
                </div>
                {searchError ? <p className="error-text">{searchError}</p> : null}
                {isSearchLoading ? <p className="secondary-text">검색 중입니다...</p> : null}
                {!isSearchLoading && searchQuery.trim().length < 2 ? (
                  <p className="secondary-text">두 글자 이상 입력하면 현재 프로젝트에서 문구를 찾습니다.</p>
                ) : null}
                <div className="result-groups">
                  {searchResults.map((result) => (
                    <div key={result.filePath} className="result-group">
                      <div className="section-head tight">
                        <strong className="ellipsis">{result.displayPath}</strong>
                        <span>{result.matches.length}</span>
                      </div>
                      <div className="result-list">
                        {result.matches.map((match) => (
                          <button
                            key={`${result.filePath}-${match.lineNumber}`}
                            type="button"
                            className="result-row"
                            onClick={() => onOpenSearchResult(result.displayPath, match.lineNumber)}
                          >
                            <span className="result-line">L{match.lineNumber}</span>
                            <span className="result-snippet ellipsis">{match.lineText.trim()}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          ) : null}

          {activeMode === 'source-control' ? (
            <div className="left-panel-scroll">
              <article className="side-section emphasis">
                <div className="section-head">
                  <strong>소스 제어</strong>
                  <span>{sourceControl?.branch ?? 'no-repo'}</span>
                </div>
                <p className="secondary-text">
                  {sourceControl?.isRepository
                    ? `ahead ${sourceControl.aheadCount} · behind ${sourceControl.behindCount}`
                    : 'Git 저장소가 감지되지 않았습니다.'}
                </p>
                {sourceControlError ? <p className="error-text">{sourceControlError}</p> : null}
                {isSourceControlLoading ? <p className="secondary-text">상태를 읽는 중입니다...</p> : null}
              </article>

              <SourceControlGroup
                title="Changed"
                files={sourceControl?.unstaged ?? []}
                actionLabel="Stage"
                onAction={onStageSourceFile}
                onOpenDiff={(file) => onOpenSourceDiff(file, false)}
              />
              <SourceControlGroup
                title="Staged"
                files={sourceControl?.staged ?? []}
                actionLabel="Unstage"
                onAction={onUnstageSourceFile}
                onOpenDiff={(file) => onOpenSourceDiff(file, true)}
              />

              <article className="side-section">
                <div className="section-head">
                  <strong>Commit / Push</strong>
                  <span>git</span>
                </div>
                <label className="field-block">
                  <span className="label">Commit Message</span>
                  <textarea
                    aria-label="Commit Message"
                    className="compact-textarea"
                    value={commitMessage}
                    onChange={(event) => onCommitMessageChange(event.target.value)}
                    placeholder="feat: implement mission-control shell"
                  />
                </label>
                <div className="inline-actions">
                  <button
                    type="button"
                    onClick={onCommitSourceControl}
                    disabled={(sourceControl?.staged.length ?? 0) === 0}
                  >
                    Commit Staged
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={onPushSourceControl}
                    disabled={!sourceControl?.isRepository}
                  >
                    Push
                  </button>
                </div>
              </article>
            </div>
          ) : null}

          {activeMode === 'outline' ? (
            <div className="left-panel-scroll">
              <article className="side-section emphasis">
                <div className="section-head">
                  <strong>현재 파일 구조</strong>
                  <span>{outlineEntries.length}</span>
                </div>
                <p className="secondary-text">
                  {selectedFilePath
                    ? '열려 있는 파일의 함수, 컴포넌트, 섹션 구조를 보여주고 바로 점프합니다.'
                    : '코드 파일을 열면 현재 파일 구조가 여기에 표시됩니다.'}
                </p>
              </article>
              <article className="side-section">
                <div className="outline-list">
                  {outlineEntries.length > 0 ? (
                    outlineEntries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="outline-row"
                        style={{ paddingLeft: `${16 + entry.depth * 12}px` }}
                        onClick={() => onOpenOutlineLine(entry.lineNumber)}
                      >
                        <span className="outline-kind">{entry.kind}</span>
                        <span className="ellipsis">{entry.label}</span>
                        <span className="row-tail" aria-hidden="true">
                          L{entry.lineNumber}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="secondary-text">현재 파일 구조를 읽을 수 있는 텍스트 파일을 선택하세요.</p>
                  )}
                </div>
              </article>
            </div>
          ) : null}

          {activeMode === 'settings' ? (
            <div className="left-panel-scroll">
              <article className="side-section emphasis">
                <div className="section-head">
                  <strong>언어 설정</strong>
                  <span>language</span>
                </div>
                <div className="setting-row">
                  <span>앱 언어</span>
                  <strong>한국어</strong>
                </div>
                <div className="setting-row">
                  <span>문서 병기</span>
                  <strong>한/영 병기</strong>
                </div>
              </article>

              <article className="side-section">
                <div className="section-head">
                  <strong>확장 / 연동</strong>
                  <span>extensions</span>
                </div>
                <div className="setting-row">
                  <span>Canva</span>
                  <strong>enabled</strong>
                </div>
                <div className="setting-row">
                  <span>GitHub</span>
                  <strong>enabled</strong>
                </div>
              </article>

              <article className="side-section">
                <div className="section-head">
                  <strong>프로그램 정보</strong>
                  <span>about</span>
                </div>
                <div className="setting-row">
                  <span>App</span>
                  <strong>gtum</strong>
                </div>
                <div className="setting-row">
                  <span>Runtime</span>
                  <strong>{runtimeInfo?.platform ?? 'preview'}</strong>
                </div>
                <div className="setting-row">
                  <span>Mode</span>
                  <strong>{runtimeInfo?.mode ?? 'browser'}</strong>
                </div>
              </article>
            </div>
          ) : null}
        </div>
      ) : null}

      {visible ? (
        <div
          className="dock-resize-handle dock-resize-handle-right"
          data-testid="left-resize-handle"
          role="separator"
          aria-label="Resize project panel"
          aria-orientation="vertical"
          onPointerDown={onResizeStart}
        />
      ) : null}
    </aside>
  )
}

function ProjectAccordionSection({
  title,
  status,
  sectionId,
  isOpen,
  onToggle,
  className = '',
  testId,
  children,
}: {
  title: string
  status: string
  sectionId: string
  isOpen: boolean
  onToggle: () => void
  className?: string
  testId: string
  children: ReactNode
}) {
  return (
    <article className={`side-section project-accordion-section ${className}`} data-testid={testId}>
      <div className="section-head project-accordion-head">
        <button
          type="button"
          className="project-accordion-toggle"
          aria-expanded={isOpen}
          aria-controls={sectionId}
          onClick={onToggle}
        >
          <span aria-hidden="true">{isOpen ? '⌄' : '›'}</span>
          <strong>{title}</strong>
        </button>
        <span>{status}</span>
      </div>
      {isOpen ? (
        <div id={sectionId} className="project-accordion-body">
          {children}
        </div>
      ) : null}
    </article>
  )
}

function SourceControlGroup({
  title,
  files,
  actionLabel,
  onAction,
  onOpenDiff,
}: {
  title: string
  files: SourceControlFileEntry[]
  actionLabel: string
  onAction: (file: SourceControlFileEntry) => void
  onOpenDiff: (file: SourceControlFileEntry) => void
}) {
  return (
    <article className="side-section">
      <div className="section-head">
        <strong>{title}</strong>
        <span>{files.length}</span>
      </div>
      <div className="list-stack">
        {files.length > 0 ? (
          files.map((file) => (
            <div key={`${title}-${file.displayPath}`} className="source-row">
              <button type="button" className="source-open" onClick={() => onOpenDiff(file)}>
                <span className="ellipsis">{file.displayPath}</span>
                <span className="row-tail" aria-hidden="true">
                  diff
                </span>
              </button>
              <button type="button" className="source-action" onClick={() => onAction(file)}>
                {actionLabel}
              </button>
            </div>
          ))
        ) : (
          <p className="secondary-text">현재 항목이 없습니다.</p>
        )}
      </div>
    </article>
  )
}

function modeTitle(mode: LeftSidebarMode) {
  switch (mode) {
    case 'project':
      return '프로젝트'
    case 'explorer':
      return '탐색기'
    case 'source-control':
      return '소스 제어'
    case 'outline':
      return '아웃라인'
    case 'settings':
      return '설정'
  }
}

function modeSubtitle(mode: LeftSidebarMode) {
  switch (mode) {
    case 'project':
      return '현재 프로젝트, 최근 프로젝트, 프로젝트 리스트, 파일 트리를 관리합니다.'
    case 'explorer':
      return '현재 프로젝트에서 특정 문구를 찾고 파일의 해당 줄로 이동합니다.'
    case 'source-control':
      return 'diff를 열고 staged / changed 파일을 관리하며 commit, push를 실행합니다.'
    case 'outline':
      return '현재 열려 있는 파일의 구조를 보고 line anchor로 점프합니다.'
    case 'settings':
      return '언어, 확장, 프로그램 정보를 확인합니다.'
  }
}
