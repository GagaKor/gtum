import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  commitSourceControl,
  pushSourceControl,
  readSourceControlDiff,
  readSourceControlOverview,
  searchProjectText,
  stageSourceControlFile,
  unstageSourceControlFile,
  type ProjectFileSnapshot,
  type ProjectSearchResult,
  type SourceControlDiff,
  type SourceControlFileEntry,
  type SourceControlOverview,
} from '../../../lib/runtime'
import { buildOutlineEntries } from '../../../shared/lib/outline'
import type { RecordTask } from '../../tasks/model/types'

export type LeftSidebarMode = 'project' | 'explorer' | 'source-control' | 'outline' | 'settings'
export type WorkbenchSecondaryView = 'terminal' | 'diff'

type UseWorkbenchLayoutParams = {
  activeProjectPath: string
  selectedFile: ProjectFileSnapshot | null
  recentProjects: string[]
  initialLeftSidebarMode?: LeftSidebarMode
  recordTask: RecordTask
  setActiveContext: (context: string) => void
  refreshProject: () => Promise<void>
}

export const useWorkbenchLayout = ({
  activeProjectPath,
  selectedFile,
  recentProjects,
  initialLeftSidebarMode = 'project',
  recordTask,
  setActiveContext,
  refreshProject,
}: UseWorkbenchLayoutParams) => {
  const [leftSidebarMode, setLeftSidebarMode] = useState<LeftSidebarMode>(initialLeftSidebarMode)
  const [secondaryView, setSecondaryView] = useState<WorkbenchSecondaryView>('terminal')
  const [searchQuery, setSearchQuery] = useState('')
  const [recentQueries, setRecentQueries] = useState<string[]>([])
  const [searchResults, setSearchResults] = useState<ProjectSearchResult[]>([])
  const [isSearchLoading, setIsSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [sourceControl, setSourceControl] = useState<SourceControlOverview | null>(null)
  const [isSourceControlLoading, setIsSourceControlLoading] = useState(false)
  const [sourceControlError, setSourceControlError] = useState<string | null>(null)
  const [activeDiff, setActiveDiff] = useState<SourceControlDiff | null>(null)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')

  const outlineEntries = useMemo(() => buildOutlineEntries(selectedFile), [selectedFile])
  const projectList = useMemo(() => {
    const entries = [activeProjectPath, ...recentProjects].filter(Boolean)
    return Array.from(new Set(entries))
  }, [activeProjectPath, recentProjects])

  const refreshSourceControl = useCallback(async () => {
    if (!activeProjectPath) {
      setSourceControl(null)
      setSourceControlError(null)
      return
    }

    setIsSourceControlLoading(true)
    setSourceControlError(null)

    try {
      const overview = await readSourceControlOverview(activeProjectPath)
      setSourceControl(overview)
    } catch (error) {
      setSourceControl(null)
      setSourceControlError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSourceControlLoading(false)
    }
  }, [activeProjectPath])

  useEffect(() => {
    void refreshSourceControl()
  }, [refreshSourceControl])

  useEffect(() => {
    if (!activeProjectPath) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    const trimmedQuery = searchQuery.trim()
    if (trimmedQuery.length < 2) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    let isCancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setIsSearchLoading(true)
        setSearchError(null)

        try {
          const results = await searchProjectText(activeProjectPath, trimmedQuery)
          if (isCancelled) {
            return
          }

          setSearchResults(results)
          setRecentQueries((current) => [trimmedQuery, ...current.filter((entry) => entry !== trimmedQuery)].slice(0, 5))
        } catch (error) {
          if (isCancelled) {
            return
          }

          setSearchResults([])
          setSearchError(error instanceof Error ? error.message : String(error))
        } finally {
          if (!isCancelled) {
            setIsSearchLoading(false)
          }
        }
      })()
    }, 180)

    return () => {
      isCancelled = true
      window.clearTimeout(timer)
    }
  }, [activeProjectPath, searchQuery])

  const openDiff = useCallback(
    async (file: SourceControlFileEntry, staged: boolean) => {
      if (!activeProjectPath) {
        return
      }

      setIsDiffLoading(true)
      setDiffError(null)
      setSecondaryView('diff')

      try {
        const diff = await readSourceControlDiff(activeProjectPath, file.path, staged)
        setActiveDiff(diff)
        setActiveContext(`Source diff ready • ${diff.displayPath}`)
      } catch (error) {
        setActiveDiff(null)
        setDiffError(error instanceof Error ? error.message : String(error))
      } finally {
        setIsDiffLoading(false)
      }
    },
    [activeProjectPath, setActiveContext],
  )

  const applyFileAction = useCallback(
    async (file: SourceControlFileEntry, action: 'stage' | 'unstage') => {
      if (!activeProjectPath) {
        return
      }

      setSourceControlError(null)

      try {
        const nextOverview =
          action === 'stage'
            ? await stageSourceControlFile(activeProjectPath, file.path)
            : await unstageSourceControlFile(activeProjectPath, file.path)

        setSourceControl(nextOverview)
        await refreshProject()
        recordTask(
          action === 'stage' ? 'Source control file staged' : 'Source control file unstaged',
          file.displayPath,
          'done',
        )
      } catch (error) {
        setSourceControlError(error instanceof Error ? error.message : String(error))
      }
    },
    [activeProjectPath, recordTask, refreshProject],
  )

  const submitCommit = useCallback(async () => {
    if (!activeProjectPath) {
      return
    }

    try {
      const nextOverview = await commitSourceControl(activeProjectPath, commitMessage)
      setCommitMessage('')
      setSourceControl(nextOverview)
      await refreshProject()
      recordTask('Source control committed', commitMessage.trim(), 'done')
      setActiveContext('Git commit completed')
    } catch (error) {
      setSourceControlError(error instanceof Error ? error.message : String(error))
    }
  }, [activeProjectPath, commitMessage, recordTask, refreshProject, setActiveContext])

  const submitPush = useCallback(async () => {
    if (!activeProjectPath) {
      return
    }

    try {
      const nextOverview = await pushSourceControl(activeProjectPath)
      setSourceControl(nextOverview)
      await refreshProject()
      recordTask('Source control pushed', activeProjectPath, 'done')
      setActiveContext('Git push completed')
    } catch (error) {
      setSourceControlError(error instanceof Error ? error.message : String(error))
    }
  }, [activeProjectPath, recordTask, refreshProject, setActiveContext])

  return {
    leftSidebarMode,
    setLeftSidebarMode,
    secondaryView,
    setSecondaryView,
    projectList,
    searchQuery,
    setSearchQuery,
    recentQueries,
    searchResults,
    isSearchLoading,
    searchError,
    sourceControl,
    isSourceControlLoading,
    sourceControlError,
    refreshSourceControl,
    activeDiff,
    isDiffLoading,
    diffError,
    openDiff,
    applyFileAction,
    commitMessage,
    setCommitMessage,
    submitCommit,
    submitPush,
    outlineEntries,
  }
}
