import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  basenameOfPath,
  type RuntimeProject,
} from '../../../shared/api/runtimeProjects'
import {
  createWorkspaceRuntimeService,
  type RuntimeWorkspaceSnapshot,
  type WorkspaceRuntimeService,
} from '../../../shared/api/runtimeWorkspace'
import {
  activateProjectWorkspace,
  closeProjectWorkspace,
  createProjectWorkspaceStore,
  openProjectWorkspace,
  selectActiveProjectWorkbench,
  selectProjectWorkbench,
  setProjectWorkspaceCloseBlockedReason,
  setProjectWorkspaceHydration,
  setProjectWorkspaceMetadata,
  updateProjectWorkbench as updateStoredProjectWorkbench,
  type JsonSafeValue,
  type ProjectWorkbench,
  type ProjectWorkspaceHydration,
  type ProjectWorkspaceStore,
} from './projectWorkspaceStore'

type Registry<W extends JsonSafeValue> = ProjectWorkspaceStore<W>
const defaultWorkspaceRuntimeService = createWorkspaceRuntimeService()

export type ProjectWorkspaceRow = {
  path: string
  project: RuntimeProject
  hydration: ProjectWorkspaceHydration
  error: string | null
  closeChecking: boolean
  closeBlockedReason: string | null
}

export type ProjectClosePreflightResult = {
  blocked: boolean
  reason: string | null
  release?: () => void
}

export type ProjectCloseResult = {
  closed: boolean
  reason: string | null
}

export type UseProjectWorkspacesOptions<W extends JsonSafeValue> = {
  fallbackProject: RuntimeProject
  readProjectOverview(path: string): Promise<RuntimeProject>
  createWorkbench(): ProjectWorkbench<W>
  workspaceService?: WorkspaceRuntimeService
}

const placeholderProject = (path: string): RuntimeProject => ({
  id: path,
  name: basenameOfPath(path),
  path,
  branch: 'loading',
  branchType: 'none',
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  fileTree: [],
  runtimeBacked: true,
})

const unavailableProject = (
  path: string,
  hydration: ProjectWorkspaceHydration,
): RuntimeProject => ({
  ...placeholderProject(path),
  branch: hydration === 'missing' ? 'missing' : 'unavailable',
  runtimeBacked: false,
})

const reconcileSnapshot = <W extends JsonSafeValue>(
  current: Registry<W>,
  snapshot: RuntimeWorkspaceSnapshot,
  createWorkbench: () => ProjectWorkbench<W>,
): Registry<W> => {
  let next = createProjectWorkspaceStore<W>()

  for (const path of snapshot.openProjectPaths) {
    const existing = current.entriesByPath[path]
    next = openProjectWorkspace(next, {
      path,
      project: existing?.project ?? placeholderProject(path),
      workbench: existing?.workbench ?? createWorkbench(),
    })
    if (existing) {
      next = setProjectWorkspaceHydration(next, path, existing.hydration)
      next = setProjectWorkspaceCloseBlockedReason(
        next,
        path,
        existing.closeBlockedReason ?? null,
      )
    }
  }

  if (snapshot.activeProjectPath) {
    next = activateProjectWorkspace(next, snapshot.activeProjectPath)
  }
  return next
}

const hydrationFailure = (message: string): ProjectWorkspaceHydration =>
  /does not exist|not found|no such file|missing/i.test(message) ? 'missing' : 'error'

export function useProjectWorkspaces<W extends JsonSafeValue>({
  fallbackProject,
  readProjectOverview,
  createWorkbench,
  workspaceService = defaultWorkspaceRuntimeService,
}: UseProjectWorkspacesOptions<W>) {
  const [registry, setRegistry] = useState<Registry<W>>(() => createProjectWorkspaceStore<W>())
  const registryRef = useRef(registry)
  const hydrationGenerationsRef = useRef(new Map<string, number>())
  const transitionGenerationRef = useRef(0)
  const successfulWorkspaceMutationRevisionRef = useRef(0)
  const workspaceMutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const projectClosePromisesRef = useRef(new Map<string, Promise<ProjectCloseResult>>())
  const [errorsByPath, setErrorsByPath] = useState<Record<string, string>>({})
  const [closeCheckingPaths, setCloseCheckingPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [restoreError, setRestoreError] = useState<string | null>(null)

  const commitRegistry = useCallback((next: Registry<W>) => {
    registryRef.current = next
    setRegistry(next)
  }, [])

  const getProjectWorkbench = useCallback((path: string | null | undefined) => {
    if (typeof path !== 'string' || !path.trim()) return null
    const normalizedPath = path.trim()
    if (!Object.hasOwn(registryRef.current.entriesByPath, normalizedPath)) return null
    return selectProjectWorkbench(registryRef.current, normalizedPath) ?? null
  }, [])

  const getActiveProjectWorkbench = useCallback(() => (
    selectActiveProjectWorkbench(registryRef.current)
  ), [])

  const updateProjectWorkbench = useCallback((
    path: string,
    update: (current: ProjectWorkbench<W>) => ProjectWorkbench<W>,
  ): boolean => {
    if (!registryRef.current.entriesByPath[path]) return false
    const next = updateStoredProjectWorkbench(registryRef.current, path, update)
    commitRegistry(next)
    return true
  }, [commitRegistry])

  const enqueueWorkspaceMutation = useCallback(<T,>(mutation: () => Promise<T>): Promise<T> => {
    const result = workspaceMutationQueueRef.current.then(mutation)
    workspaceMutationQueueRef.current = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }, [])

  const clearProjectErrors = useCallback((...paths: string[]) => {
    setErrorsByPath((current) => {
      const existingPaths = paths.filter((path) => Object.hasOwn(current, path))
      if (existingPaths.length === 0) return current
      const next = { ...current }
      for (const path of existingPaths) delete next[path]
      return next
    })
  }, [])

  const hydrateProject = useCallback(async (path: string) => {
    const currentEntry = registryRef.current.entriesByPath[path]
    if (!currentEntry || currentEntry.hydration === 'ready' || currentEntry.hydration === 'loading') {
      return
    }

    const generation = (hydrationGenerationsRef.current.get(path) ?? 0) + 1
    hydrationGenerationsRef.current.set(path, generation)
    let loadingRegistry = setProjectWorkspaceMetadata(
      registryRef.current,
      path,
      placeholderProject(path),
    )
    loadingRegistry = setProjectWorkspaceHydration(loadingRegistry, path, 'loading')
    commitRegistry(loadingRegistry)
    setErrorsByPath((current) => {
      if (!Object.hasOwn(current, path)) return current
      const next = { ...current }
      delete next[path]
      return next
    })

    try {
      const project = await readProjectOverview(path)
      if (hydrationGenerationsRef.current.get(path) !== generation) return
      if (project.path !== path || project.id !== path) {
        throw new Error('Project overview does not match its persisted project path')
      }
      if (!registryRef.current.entriesByPath[path]) return

      let next = setProjectWorkspaceMetadata(registryRef.current, path, project)
      next = setProjectWorkspaceHydration(next, path, 'ready')
      commitRegistry(next)
    } catch (error) {
      if (hydrationGenerationsRef.current.get(path) !== generation) return
      if (!registryRef.current.entriesByPath[path]) return
      const message = error instanceof Error ? error.message : String(error)
      const failureHydration = hydrationFailure(message)
      let failedRegistry = setProjectWorkspaceMetadata(
        registryRef.current,
        path,
        unavailableProject(path, failureHydration),
      )
      failedRegistry = setProjectWorkspaceHydration(failedRegistry, path, failureHydration)
      commitRegistry(failedRegistry)
      setErrorsByPath((current) => ({ ...current, [path]: message }))
    }
  }, [commitRegistry, readProjectOverview])

  useEffect(() => {
    if (!workspaceService.hasRuntime()) return undefined
    let cancelled = false
    const restoreMutationRevision = successfulWorkspaceMutationRevisionRef.current

    workspaceService.readRuntimeSnapshot()
      .then((runtimeSnapshot) => {
        if (
          cancelled ||
          !runtimeSnapshot ||
          successfulWorkspaceMutationRevisionRef.current !== restoreMutationRevision
        ) return
        const next = reconcileSnapshot(
          registryRef.current,
          runtimeSnapshot.snapshot,
          createWorkbench,
        )
        commitRegistry(next)
        const activePath = runtimeSnapshot.snapshot.activeProjectPath
        if (activePath) void hydrateProject(activePath)
      })
      .catch((error) => {
        if (
          cancelled ||
          successfulWorkspaceMutationRevisionRef.current !== restoreMutationRevision
        ) return
        setRestoreError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [commitRegistry, createWorkbench, hydrateProject, workspaceService])

  const activateProject = useCallback(async (path: string) => {
    if (!registryRef.current.entriesByPath[path]) return
    const generation = transitionGenerationRef.current + 1
    transitionGenerationRef.current = generation

    try {
      if (workspaceService.hasRuntime()) {
        const snapshot = await enqueueWorkspaceMutation(
          () => workspaceService.activateProject(path),
        )
        if (!snapshot) return
        successfulWorkspaceMutationRevisionRef.current += 1
        commitRegistry(reconcileSnapshot(registryRef.current, snapshot, createWorkbench))
        if (snapshot.activeProjectPath) {
          clearProjectErrors(path, snapshot.activeProjectPath)
          void hydrateProject(snapshot.activeProjectPath)
        }
        if (transitionGenerationRef.current !== generation) return
        return
      }

      if (transitionGenerationRef.current !== generation) return
      commitRegistry(activateProjectWorkspace(registryRef.current, path))
      clearProjectErrors(path)
      void hydrateProject(path)
    } catch (error) {
      if (transitionGenerationRef.current !== generation) return
      const message = error instanceof Error ? error.message : String(error)
      setErrorsByPath((current) => ({ ...current, [path]: message }))
    }
  }, [
    clearProjectErrors,
    commitRegistry,
    createWorkbench,
    enqueueWorkspaceMutation,
    hydrateProject,
    workspaceService,
  ])

  const openProject = useCallback(async (path: string): Promise<RuntimeProject | null> => {
    const generation = transitionGenerationRef.current + 1
    transitionGenerationRef.current = generation

    try {
      if (workspaceService.hasRuntime()) {
        const snapshot = await enqueueWorkspaceMutation(
          () => workspaceService.openProject(path),
        )
        if (!snapshot) return null
        successfulWorkspaceMutationRevisionRef.current += 1
        commitRegistry(reconcileSnapshot(registryRef.current, snapshot, createWorkbench))
        const canonicalPath = snapshot.activeProjectPath
        if (!canonicalPath) return null
        clearProjectErrors(path, canonicalPath)
        const hydration = hydrateProject(canonicalPath)
        if (transitionGenerationRef.current !== generation) {
          void hydration
          return null
        }
        await hydration
        if (transitionGenerationRef.current !== generation) return null
        return (registryRef.current.entriesByPath[canonicalPath]?.project as RuntimeProject | null) ?? null
      }

      const project = await readProjectOverview(path)
      if (transitionGenerationRef.current !== generation) return null
      let next = openProjectWorkspace(registryRef.current, {
        path: project.path,
        project,
        workbench: createWorkbench(),
      })
      next = setProjectWorkspaceHydration(next, project.path, 'ready')
      commitRegistry(next)
      clearProjectErrors(path, project.path)
      return project
    } catch (error) {
      if (transitionGenerationRef.current !== generation) return null
      const message = error instanceof Error ? error.message : String(error)
      setErrorsByPath((current) => ({ ...current, [path]: message }))
      throw error
    }
  }, [
    clearProjectErrors,
    commitRegistry,
    createWorkbench,
    enqueueWorkspaceMutation,
    hydrateProject,
    readProjectOverview,
    workspaceService,
  ])

  const closeProject = useCallback((
    path: string,
    preflight: (projectPath: string) => Promise<ProjectClosePreflightResult>,
  ): Promise<ProjectCloseResult> => {
    const existing = projectClosePromisesRef.current.get(path)
    if (existing) return existing
    if (!registryRef.current.entriesByPath[path]) {
      return Promise.resolve({ closed: false, reason: 'Project workspace is not open.' })
    }

    setCloseCheckingPaths((current) => new Set(current).add(path))
    commitRegistry(setProjectWorkspaceCloseBlockedReason(
      registryRef.current,
      path,
      null,
    ))

    const operation = (async (): Promise<ProjectCloseResult> => {
      let preflightResult: ProjectClosePreflightResult | null = null
      try {
        preflightResult = await preflight(path)
        if (preflightResult.blocked) {
          const reason = preflightResult.reason || 'Project close was blocked.'
          if (registryRef.current.entriesByPath[path]) {
            commitRegistry(setProjectWorkspaceCloseBlockedReason(
              registryRef.current,
              path,
              reason,
            ))
          }
          return { closed: false, reason }
        }

        if (workspaceService.hasRuntime()) {
          const snapshot = await enqueueWorkspaceMutation(
            () => workspaceService.closeProject(path),
          )
          if (!snapshot) throw new Error('Workspace runtime did not return a close snapshot')
          successfulWorkspaceMutationRevisionRef.current += 1
          commitRegistry(reconcileSnapshot(registryRef.current, snapshot, createWorkbench))
          const nextActivePath = snapshot.activeProjectPath
          clearProjectErrors(path, ...(nextActivePath ? [nextActivePath] : []))
          if (nextActivePath) void hydrateProject(nextActivePath)
          return { closed: true, reason: null }
        }

        const result = closeProjectWorkspace(registryRef.current, path)
        if (result.blocked) return { closed: false, reason: result.reason }
        commitRegistry(result.state)
        clearProjectErrors(path)
        if (result.state.activePath) void hydrateProject(result.state.activePath)
        return { closed: true, reason: null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const reason = `Could not close project: ${message}`
        if (registryRef.current.entriesByPath[path]) {
          commitRegistry(setProjectWorkspaceCloseBlockedReason(
            registryRef.current,
            path,
            reason,
          ))
          setErrorsByPath((current) => ({ ...current, [path]: message }))
        }
        return { closed: false, reason }
      } finally {
        preflightResult?.release?.()
        projectClosePromisesRef.current.delete(path)
        setCloseCheckingPaths((current) => {
          if (!current.has(path)) return current
          const next = new Set(current)
          next.delete(path)
          return next
        })
      }
    })()
    projectClosePromisesRef.current.set(path, operation)
    return operation
  }, [
    clearProjectErrors,
    commitRegistry,
    createWorkbench,
    enqueueWorkspaceMutation,
    hydrateProject,
    workspaceService,
  ])

  const rows = useMemo<ProjectWorkspaceRow[]>(() => registry.openOrder.map((path) => {
    const entry = registry.entriesByPath[path]
    return {
      path,
      project: (entry.project as RuntimeProject | null) ?? placeholderProject(path),
      hydration: entry.hydration,
      error: errorsByPath[path] ?? null,
      closeChecking: closeCheckingPaths.has(path),
      closeBlockedReason: entry.closeBlockedReason ?? null,
    }
  }), [closeCheckingPaths, errorsByPath, registry])

  const activeProject = useMemo(() => {
    if (!registry.activePath) return fallbackProject
    return (registry.entriesByPath[registry.activePath]?.project as RuntimeProject | null)
      ?? placeholderProject(registry.activePath)
  }, [fallbackProject, registry])

  const activeWorkbench = useMemo(
    () => selectActiveProjectWorkbench(registry),
    [registry],
  )

  return {
    registry,
    rows,
    activeProject,
    activeWorkbench,
    restoreError,
    getProjectWorkbench,
    getActiveProjectWorkbench,
    updateProjectWorkbench,
    activateProject,
    openProject,
    closeProject,
  }
}
