import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readProjectFile,
  readProjectOverview,
  selectProjectFolder,
  type FileTreeNode,
  type ProjectFileSnapshot,
  type ProjectOverview,
} from '../../../lib/runtime'
import {
  buildDisplayFileAnchor,
  clampLineNumber,
  extractLineReference,
  findFirstFilePath,
  resolveSelectedFilePath,
} from '../../../shared/lib/file-context'
import type { RecordTask } from '../../tasks/model/types'

type UseProjectWorkspaceParams = {
  initialLastProjectPath?: string
  initialSelectedFilePath?: string | null
  initialSelectedFileLine?: number | null
  activeProjectPath: string
  projectPathInput: string
  recentProjects: string[]
  setActiveProject: (project: string) => void
  setActiveProjectPath: (path: string) => void
  setProjectPathInput: (path: string) => void
  rememberProject: (path: string) => void
  setActiveContext: (context: string) => void
  ensureWorkspaceTerminal: (cwd: string) => Promise<void>
  recordTask: RecordTask
}

export const useProjectWorkspace = ({
  initialLastProjectPath,
  initialSelectedFilePath = null,
  initialSelectedFileLine = null,
  activeProjectPath,
  projectPathInput,
  recentProjects,
  setActiveProject,
  setActiveProjectPath,
  setProjectPathInput,
  rememberProject,
  setActiveContext,
  ensureWorkspaceTerminal,
  recordTask,
}: UseProjectWorkspaceParams) => {
  const [projectOverview, setProjectOverview] = useState<ProjectOverview | null>(null)
  const [isProjectLoading, setIsProjectLoading] = useState(false)
  const [projectError, setProjectError] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(initialSelectedFilePath)
  const [selectedFileLine, setSelectedFileLine] = useState<number | null>(initialSelectedFileLine)
  const [selectedFile, setSelectedFile] = useState<ProjectFileSnapshot | null>(null)
  const [isFileLoading, setIsFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const hasRestoredWorkspace = useRef(false)
  const restoredSelectedFilePath = useRef(initialSelectedFilePath)
  const restoredSelectedFileLine = useRef(initialSelectedFileLine)

  const loadProjectFileSnapshot = useCallback(
    async (
      projectPath: string,
      filePath: string,
      options: {
        shouldRecord?: boolean
        anchorLine?: number | null
      } = {},
    ) => {
      if (!projectPath || !filePath) {
        setSelectedFilePath(null)
        setSelectedFileLine(null)
        setSelectedFile(null)
        setFileError(null)
        return null
      }

      setSelectedFilePath(filePath)
      setIsFileLoading(true)
      setFileError(null)

      try {
        const snapshot = await readProjectFile(projectPath, filePath)
        const normalizedAnchor = snapshot.isText
          ? clampLineNumber(options.anchorLine ?? null, snapshot.content.split('\n').length)
          : null
        setSelectedFile(snapshot)
        setSelectedFilePath(snapshot.filePath)
        setSelectedFileLine(normalizedAnchor)

        if (options.shouldRecord) {
          recordTask(
            'Code surface focused',
            buildDisplayFileAnchor(snapshot.displayPath, normalizedAnchor),
            'done',
          )
        }

        return snapshot
      } catch (error) {
        setSelectedFile(null)
        setSelectedFileLine(null)
        setFileError(error instanceof Error ? error.message : String(error))
        return null
      } finally {
        setIsFileLoading(false)
      }
    },
    [recordTask],
  )

  const openProject = useCallback(
    async (
      path: string,
      options: {
        shouldRecord?: boolean
        nextContext?: string | null
      } = {},
    ) => {
      const trimmedPath = path.trim()

      if (!trimmedPath) {
        setProjectError('Choose a project folder to continue.')
        return
      }

      setProjectError(null)
      setIsProjectLoading(true)

      try {
        const overview = await readProjectOverview(trimmedPath)
        const firstFilePath = findFirstFilePath(overview.tree)
        const preferredFilePath =
          selectedFilePath && selectedFilePath.startsWith(overview.metadata.path)
            ? selectedFilePath
            : restoredSelectedFilePath.current ?? null
        const preferredFileLine =
          preferredFilePath && preferredFilePath === selectedFilePath
            ? selectedFileLine
            : restoredSelectedFileLine.current ?? null
        const nextSelectedFilePath = resolveSelectedFilePath(overview.tree, preferredFilePath)

        setProjectOverview(overview)
        setActiveProject(overview.metadata.name)
        setActiveProjectPath(overview.metadata.path)
        setProjectPathInput(overview.metadata.path)
        if (options.nextContext !== null) {
          setActiveContext(options.nextContext ?? 'Sprint 14 FSD Workspace Ready')
        }
        rememberProject(overview.metadata.path)
        setSelectedFilePath(nextSelectedFilePath)
        setFileError(null)
        await ensureWorkspaceTerminal(overview.metadata.path)

        let loadedFile = null
        if (nextSelectedFilePath) {
          loadedFile = await loadProjectFileSnapshot(overview.metadata.path, nextSelectedFilePath, {
            anchorLine: preferredFileLine,
          })
        }

        if (!loadedFile && firstFilePath && firstFilePath !== nextSelectedFilePath) {
          await loadProjectFileSnapshot(overview.metadata.path, firstFilePath)
        } else if (!nextSelectedFilePath) {
          setSelectedFile(null)
          setSelectedFilePath(null)
          setSelectedFileLine(null)
        }

        if (options.shouldRecord ?? true) {
          recordTask('Project opened', overview.metadata.path, 'done')
        }
      } catch (error) {
        setProjectOverview(null)
        setSelectedFile(null)
        setSelectedFilePath(null)
        setSelectedFileLine(null)
        setFileError(null)
        setProjectError(error instanceof Error ? error.message : String(error))
      } finally {
        setIsProjectLoading(false)
      }
    },
    [
      ensureWorkspaceTerminal,
      loadProjectFileSnapshot,
      recordTask,
      rememberProject,
      selectedFileLine,
      selectedFilePath,
      setActiveContext,
      setActiveProject,
      setActiveProjectPath,
      setProjectPathInput,
    ],
  )

  const chooseProjectFolder = useCallback(async () => {
    const chosenPath = await selectProjectFolder(projectPathInput || activeProjectPath || recentProjects[0])

    if (!chosenPath) {
      return
    }

    setProjectPathInput(chosenPath)
    await openProject(chosenPath)
  }, [activeProjectPath, openProject, projectPathInput, recentProjects, setProjectPathInput])

  const refreshProject = useCallback(async () => {
    if (!activeProjectPath) {
      return
    }

    await openProject(activeProjectPath, {
      shouldRecord: false,
      nextContext: null,
    })
  }, [activeProjectPath, openProject])

  useEffect(() => {
    if (hasRestoredWorkspace.current) {
      return
    }

    hasRestoredWorkspace.current = true

    if (initialLastProjectPath) {
      void openProject(initialLastProjectPath)
    }
  }, [initialLastProjectPath, openProject])

  useEffect(() => {
    restoredSelectedFilePath.current = selectedFilePath
  }, [selectedFilePath])

  useEffect(() => {
    restoredSelectedFileLine.current = selectedFileLine
  }, [selectedFileLine])

  const selectProjectFile = useCallback(
    (node: FileTreeNode) => {
      const projectPath = projectOverview?.metadata.path ?? activeProjectPath

      if (node.kind !== 'file' || !projectPath) {
        return
      }

      void loadProjectFileSnapshot(projectPath, node.path, { shouldRecord: true })
    },
    [activeProjectPath, loadProjectFileSnapshot, projectOverview?.metadata.path],
  )

  const openProjectFileAtLine = useCallback(
    async (filePath: string, lineNumber?: number | null) => {
      const projectPath = projectOverview?.metadata.path ?? activeProjectPath

      if (!projectPath || !filePath) {
        return null
      }

      const snapshot = await loadProjectFileSnapshot(projectPath, filePath, {
        shouldRecord: true,
        anchorLine: lineNumber ?? null,
      })

      if (snapshot && snapshot.isText && lineNumber) {
        setActiveContext(
          `Mission Control Focus • ${buildDisplayFileAnchor(snapshot.displayPath, lineNumber)}`,
        )
      }

      return snapshot
    },
    [activeProjectPath, loadProjectFileSnapshot, projectOverview?.metadata.path, setActiveContext],
  )

  const selectCodeLine = useCallback(
    (lineNumber: number) => {
      const normalizedLineNumber = clampLineNumber(
        lineNumber,
        selectedFile?.content.split('\n').length ?? 0,
      )

      if (!selectedFile?.isText || !normalizedLineNumber) {
        return
      }

      setSelectedFileLine(normalizedLineNumber)
      setActiveContext(
        `Sprint 14 Line Anchor Ready • ${buildDisplayFileAnchor(
          selectedFile.displayPath,
          normalizedLineNumber,
        )}`,
      )
      recordTask(
        'Line anchor focused',
        buildDisplayFileAnchor(selectedFile.displayPath, normalizedLineNumber),
        'done',
      )
    },
    [recordTask, selectedFile, setActiveContext],
  )

  const clearSelectedLine = useCallback(() => {
    setSelectedFileLine(null)
  }, [])

  const openLineReference = useCallback(
    async (line: string) => {
      const reference = extractLineReference(line)
      const projectPath = projectOverview?.metadata.path ?? activeProjectPath

      if (!reference || !projectPath) {
        return
      }

      await loadProjectFileSnapshot(projectPath, reference.filePath, {
        shouldRecord: true,
        anchorLine: reference.lineNumber,
      })
      setActiveContext(`Sprint 14 Log Anchor Ready • ${reference.label}`)
    },
    [activeProjectPath, loadProjectFileSnapshot, projectOverview?.metadata.path, setActiveContext],
  )

  return {
    projectOverview,
    isProjectLoading,
    projectError,
    selectedFilePath,
    selectedFileLine,
    selectedFile,
    isFileLoading,
    fileError,
    openProject,
    refreshProject,
    chooseProjectFolder,
    selectProjectFile,
    openProjectFileAtLine,
    selectCodeLine,
    clearSelectedLine,
    openLineReference,
  }
}
