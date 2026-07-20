import { expect, test } from '@playwright/test'

import {
  activateProjectWorkspace,
  assertProjectWorkspaceStore,
  closeProjectWorkspace,
  closeProjectWorkspaceState,
  createProjectWorkspaceStore,
  openProjectWorkspace,
  selectActiveProjectWorkbench,
  selectProjectWorkbench,
  selectProjectWorkspaceCloseStatus,
  selectProjectWorkspaceEntry,
  setProjectWorkbench,
  setProjectWorkspaceCloseBlockedReason,
  setProjectWorkspaceHydration,
  setProjectWorkspaceMetadata,
  updateProjectWorkbench,
  type ProjectWorkspaceStore,
} from '../../src/features/projects/model/projectWorkspaceStore'
import type { RuntimeProject } from '../../src/shared/api/runtimeProjects'

type Workbench = { selectedFile: string | null; tabs: string[] }

const A = '/Workspaces/Alpha'
const B = '/workspaces/beta'
const C = '/workspaces/charlie'
const workbenchA: Workbench = { selectedFile: 'src/a.ts', tabs: ['editor-a'] }
const workbenchB: Workbench = { selectedFile: 'src/b.ts', tabs: ['editor-b'] }
const workbenchC: Workbench = { selectedFile: null, tabs: ['terminal-c'] }

const project = (path: string, name: string): RuntimeProject => ({
  id: path,
  name,
  path,
  branch: 'main',
  branchType: 'local',
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  fileTree: [],
  runtimeBacked: true,
})
const open = (
  state: ProjectWorkspaceStore<Workbench>,
  path: string,
  workbench: Workbench,
  metadata?: RuntimeProject | null,
) =>
  openProjectWorkspace(state, {
    path,
    workbench,
    ...(metadata === undefined ? {} : { project: metadata }),
  })
const invariant = (state: ProjectWorkspaceStore<Workbench>) =>
  expect(state.activePath === null || state.openOrder.includes(state.activePath)).toBe(true)

test('opens in insertion order and reopens without replacing project work', () => {
  const initialMetadata = project(A, 'Alpha')
  const refreshedMetadata = { ...initialMetadata, branch: 'feature/multi-project' }
  const replacement: Workbench = { selectedFile: null, tabs: ['replacement'] }
  let state = createProjectWorkspaceStore<Workbench>()

  state = open(state, `  ${A}  `, workbenchA, initialMetadata)
  state = open(state, B, workbenchB)
  expect(state.openOrder).toEqual([A, B])
  expect(state.activePath).toBe(B)

  state = open(state, A, replacement, refreshedMetadata)
  expect(state.openOrder).toEqual([A, B])
  expect(state.activePath).toBe(A)
  expect(state.entriesByPath[A]).toMatchObject({
    path: A,
    project: refreshedMetadata,
    workbench: workbenchA,
    hydration: 'idle',
  })
  expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  invariant(state)
})

test('activates only open paths and preserves path case', () => {
  let state = createProjectWorkspaceStore<Workbench>()
  expect(() => open(state, '   ', workbenchA)).toThrow(/path.*blank/i)
  state = open(state, '/Repos/Example', workbenchA)
  state = open(state, '/repos/example', workbenchB)
  expect(state.openOrder).toEqual(['/Repos/Example', '/repos/example'])

  state = activateProjectWorkspace(state, '/Repos/Example')
  const snapshot = JSON.stringify(state)
  expect(() => activateProjectWorkspace(state, '/not-open')).toThrow(/not open/i)
  expect(JSON.stringify(state)).toBe(snapshot)
  invariant(state)
})

test('updates one workbench by replacement or updater without mutating prior state', () => {
  let state = open(open(createProjectWorkspaceStore<Workbench>(), A, workbenchA), B, workbenchB)
  const previous = state
  const previousSnapshot = JSON.stringify(previous)
  const entryA = previous.entriesByPath[A]
  const entryB = previous.entriesByPath[B]
  let received: unknown

  state = updateProjectWorkbench(state, A, (current) => {
    received = current
    return { ...current, tabs: [...current.tabs, 'terminal-a'] }
  })
  expect(received).toBe(workbenchA)
  expect(state.entriesByPath[A]).not.toBe(entryA)
  expect(state.entriesByPath[B]).toBe(entryB)
  expect(state.entriesByPath[B].workbench).toBe(workbenchB)
  expect(JSON.stringify(previous)).toBe(previousSnapshot)
  expect(entryA.workbench.tabs).toEqual(['editor-a'])

  const replacement: Workbench = { selectedFile: 'next.ts', tabs: ['next'] }
  state = setProjectWorkbench(state, A, replacement)
  expect(selectProjectWorkspaceEntry(state, A)).toBe(state.entriesByPath[A])
  expect(selectProjectWorkbench(state, A)).toBe(replacement)
  state = activateProjectWorkspace(state, A)
  expect(selectActiveProjectWorkbench(state)).toBe(replacement)
})

test('updates one workbench without traversing active or foreign project metadata trees', () => {
  let state = open(
    open(createProjectWorkspaceStore<Workbench>(), A, workbenchA, project(A, 'Alpha')),
    B,
    workbenchB,
    project(B, 'Beta'),
  )
  let activeMetadataReads = 0
  let foreignMetadataReads = 0
  const watchedTree = <Tree extends readonly unknown[]>(
    tree: Tree,
    onRead: () => void,
  ): Tree => new Proxy(tree, {
    get(target, key, receiver) {
      onRead()
      return Reflect.get(target, key, receiver)
    },
    getOwnPropertyDescriptor(target, key) {
      onRead()
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    getPrototypeOf(target) {
      onRead()
      return Reflect.getPrototypeOf(target)
    },
    ownKeys(target) {
      onRead()
      return Reflect.ownKeys(target)
    },
  })
  const activeTree = watchedTree(
    state.entriesByPath[A].project!.fileTree,
    () => { activeMetadataReads += 1 },
  )
  const foreignTree = watchedTree(
    state.entriesByPath[B].project!.fileTree,
    () => { foreignMetadataReads += 1 },
  )
  state = {
    ...state,
    entriesByPath: {
      ...state.entriesByPath,
      [A]: {
        ...state.entriesByPath[A],
        project: {
          ...state.entriesByPath[A].project!,
          fileTree: activeTree,
        },
      },
      [B]: {
        ...state.entriesByPath[B],
        project: {
          ...state.entriesByPath[B].project!,
          fileTree: foreignTree,
        },
      },
    },
  }

  const next = updateProjectWorkbench(state, A, (current) => ({
    ...current,
    tabs: [...current.tabs, 'terminal-a'],
  }))

  expect(activeMetadataReads).toBe(0)
  expect(foreignMetadataReads).toBe(0)
  expect(next.entriesByPath[A].workbench.tabs).toEqual(['editor-a', 'terminal-a'])
  expect(next.entriesByPath[B]).toBe(state.entriesByPath[B])
  expect(() => updateProjectWorkbench(state, C, (current) => current)).toThrow(/not open/i)
  expect(() => updateProjectWorkbench(state, A, () => ({
    selectedFile: null,
    tabs: [undefined],
  } as unknown as Workbench))).toThrow(/JSON-safe/i)

  const invalidTarget = {
    ...state,
    entriesByPath: {
      ...state.entriesByPath,
      [A]: { ...state.entriesByPath[A], hydration: 'stale' },
    },
  } as unknown as ProjectWorkspaceStore<Workbench>
  expect(() => updateProjectWorkbench(invalidTarget, A, (current) => current)).toThrow(/hydration/i)
})

test('isolates hydration and metadata changes from other projects', () => {
  const metadata = project(A, 'Hydrated Alpha')
  let state = open(open(createProjectWorkspaceStore<Workbench>(), A, workbenchA), B, workbenchB)
  const entryB = state.entriesByPath[B]

  state = setProjectWorkspaceHydration(state, A, 'loading')
  state = setProjectWorkspaceMetadata(state, A, metadata)
  expect(state.entriesByPath[A]).toMatchObject({ hydration: 'loading', project: metadata })
  expect(state.entriesByPath[B]).toBe(entryB)
  expect(state.entriesByPath[B].workbench).toBe(workbenchB)
  state = setProjectWorkspaceMetadata(state, A, null)
  expect(state.entriesByPath[A].project).toBeNull()
})

test('closes inactive and active projects with deterministic neighbors', () => {
  let state = open(open(open(createProjectWorkspaceStore<Workbench>(), A, workbenchA), B, workbenchB), C, workbenchC)
  state = activateProjectWorkspace(state, A)
  const entryA = state.entriesByPath[A]
  let result = closeProjectWorkspace(state, B)
  expect(result).toMatchObject({ blocked: false, reason: null })
  expect(result.state.entriesByPath[A]).toBe(entryA)
  expect(result.state.openOrder).toEqual([A, C])
  expect(result.state.activePath).toBe(A)

  state = open(result.state, B, workbenchB)
  state = activateProjectWorkspace(state, C)
  result = closeProjectWorkspace(state, C)
  expect(result.state.activePath).toBe(B)
  result = closeProjectWorkspace(result.state, B)
  expect(result.state.activePath).toBe(A)
  result = closeProjectWorkspace(result.state, A)
  expect(result.state).toEqual({ openOrder: [], activePath: null, entriesByPath: {} })
  expect(selectActiveProjectWorkbench(result.state)).toBeNull()
})

test('reports blocked close and supports a state-only close transition', () => {
  const reason = 'An Agent job is still running'
  let state = open(createProjectWorkspaceStore<Workbench>(), A, workbenchA)
  expect(selectProjectWorkspaceCloseStatus(state, A)).toEqual({ blocked: false, reason: null })

  state = setProjectWorkspaceCloseBlockedReason(state, A, reason)
  expect(selectProjectWorkspaceCloseStatus(state, A)).toEqual({ blocked: true, reason })
  expect(closeProjectWorkspace(state, A)).toEqual({ state, blocked: true, reason })
  expect(closeProjectWorkspaceState(state, A)).toBe(state)

  state = setProjectWorkspaceCloseBlockedReason(state, A, null)
  const previous = state
  state = closeProjectWorkspaceState(state, A)
  expect(state.activePath).toBeNull()
  expect(previous.entriesByPath[A].workbench).toBe(workbenchA)
})

test('rejects every structural store corruption before transitions run', () => {
  const base = open(createProjectWorkspaceStore<Workbench>(), A, workbenchA)
  const withB = open(base, B, workbenchB)
  const entry = base.entriesByPath[A]
  const corruptions: Array<[string, RegExp, ProjectWorkspaceStore<Workbench>]> = [
    ['duplicate', /duplicate/i, { ...base, openOrder: [A, A] }],
    ['missing', /missing.*entry/i, { ...base, entriesByPath: {} }],
    [
      'mismatch',
      /path.*match/i,
      { ...base, entriesByPath: { [A]: { ...entry, path: B } } },
    ],
    ['orphan', /orphan/i, { ...withB, openOrder: [A], activePath: A }],
    ['missing active', /active.*required/i, { ...base, activePath: null }],
    [
      'untrimmed',
      /trimmed/i,
      { ...base, openOrder: [` ${A}`], entriesByPath: { [` ${A}`]: { ...entry, path: ` ${A}` } } },
    ],
    ['blank', /blank/i, { ...base, openOrder: [''], activePath: null, entriesByPath: { '': { ...entry, path: '' } } }],
    ['active', /active.*open/i, { ...base, activePath: B }],
    [
      'hydration',
      /hydration/i,
      { ...base, entriesByPath: { [A]: { ...entry, hydration: 'stale' as 'idle' } } },
    ],
    [
      'close reason',
      /close.*reason/i,
      {
        ...base,
        entriesByPath: {
          [A]: { ...entry, closeBlockedReason: 42 as unknown as string },
        },
      },
    ],
  ]

  for (const [label, expected, corrupted] of corruptions) {
    expect(() => assertProjectWorkspaceStore(corrupted), label).toThrow(expected)
  }

  let initializerCalls = 0
  expect(() =>
    openProjectWorkspace(corruptions[0][2], {
      path: B,
      createWorkbench: () => {
        initializerCalls += 1
        return workbenchB
      },
    }),
  ).toThrow(/duplicate/i)
  expect(initializerCalls).toBe(0)
})

test('validates RuntimeProject shape and project-key ownership at every boundary', () => {
  const base = open(createProjectWorkspaceStore<Workbench>(), A, workbenchA)
  const entry = base.entriesByPath[A]
  const valid = project(A, 'Alpha')
  const invalid: Array<[string, RegExp, unknown]> = [
    ['empty metadata', /metadata.*id/i, {}],
    ['invalid branch', /branch.*string/i, { ...valid, branch: 42 }],
    ['invalid count', /ahead.*finite/i, { ...valid, ahead: Number.NaN }],
    ['invalid tree', /fileTree.*array/i, { ...valid, fileTree: {} }],
    ['invalid runtime flag', /runtimeBacked.*boolean/i, { ...valid, runtimeBacked: 'yes' }],
    ['path mismatch', /path.*entry/i, { ...valid, path: B }],
    ['id mismatch', /id.*entry/i, { ...valid, id: B }],
  ]

  for (const [label, expected, metadata] of invalid) {
    const corrupted = {
      ...base,
      entriesByPath: { [A]: { ...entry, project: metadata as RuntimeProject } },
    }
    expect(() => assertProjectWorkspaceStore(corrupted), label).toThrow(expected)
  }

  expect(() =>
    openProjectWorkspace(createProjectWorkspaceStore<Workbench>(), {
      path: A,
      project: project(B, 'Beta'),
      workbench: workbenchA,
    }),
  ).toThrow(/path.*entry/i)
  expect(() => setProjectWorkspaceMetadata(base, A, project(B, 'Beta'))).toThrow(
    /path.*entry/i,
  )
})

test('validates RuntimeProject file-tree nodes recursively', () => {
  const base = open(createProjectWorkspaceStore<Workbench>(), A, workbenchA)
  const entry = base.entriesByPath[A]
  const leaf = { name: 'index.ts', type: 'ts', runtimePath: `${A}/index.ts` }
  const invalid: Array<[string, RegExp, unknown]> = [
    ['non-object node', /tree node.*plain object/i, 42],
    ['missing name', /node name.*string/i, { type: 'dir' }],
    ['non-string name', /node name.*string/i, { name: 42, type: 'dir' }],
    ['missing type', /node type.*string/i, { name: 'src' }],
    ['non-string type', /node type.*string/i, { name: 'src', type: 42 }],
    ['invalid open', /node open.*boolean/i, { ...leaf, open: 'yes' }],
    ['invalid changed', /node changed.*boolean/i, { ...leaf, changed: 'yes' }],
    ['invalid selected', /node selected.*boolean/i, { ...leaf, selected: 'yes' }],
    ['invalid truncated', /node truncated.*boolean/i, { ...leaf, truncated: 'yes' }],
    ['invalid runtimePath', /runtimePath.*string/i, { ...leaf, runtimePath: 42 }],
    ['invalid children', /children.*array/i, { ...leaf, children: {} }],
    [
      'malformed nested child',
      /node type.*string/i,
      { name: 'src', type: 'dir', children: [{ name: 'nested' }] },
    ],
  ]

  for (const [label, expected, node] of invalid) {
    const metadata = { ...project(A, 'Alpha'), fileTree: [node] } as RuntimeProject
    const corrupted = {
      ...base,
      entriesByPath: { [A]: { ...entry, project: metadata } },
    }
    expect(() => assertProjectWorkspaceStore(corrupted), label).toThrow(expected)
  }

  const metadata = {
    ...project(A, 'Alpha'),
    fileTree: [
      {
        name: 'src',
        type: 'dir',
        open: true,
        changed: false,
        selected: true,
        truncated: false,
        runtimePath: `${A}/src`,
        children: [leaf],
      },
    ],
  }
  expect(() =>
    openProjectWorkspace(createProjectWorkspaceStore<Workbench>(), {
      path: A,
      project: metadata,
      workbench: workbenchA,
    }),
  ).not.toThrow()
})

test('rejects simultaneous eager and lazy workbench inputs', () => {
  let initializerCalls = 0

  expect(() =>
    openProjectWorkspace(createProjectWorkspaceStore<Workbench>(), {
      path: A,
      workbench: workbenchA,
      createWorkbench: () => {
        initializerCalls += 1
        return workbenchB
      },
    }),
  ).toThrow(/both.*workbench/i)
  expect(initializerCalls).toBe(0)
})

test('rejects invalid and cyclic workbenches without rejecting shared references', () => {
  class NonPlain {
    value = 'invalid'
  }
  const invalid: Array<[string, unknown]> = [
    ['function', () => undefined],
    ['bigint', 1n],
    ['symbol', Symbol('invalid')],
    ['undefined', undefined],
    ['nested undefined', { value: undefined }],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['Set', new Set()],
    ['class', new NonPlain()],
  ]
  for (const [label, value] of invalid) {
    expect(
      () =>
        openProjectWorkspace(createProjectWorkspaceStore<Workbench>(), {
          path: A,
          workbench: value as Workbench,
        }),
      label,
    ).toThrow(/JSON-safe/i)
  }

  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  expect(() =>
    openProjectWorkspace(createProjectWorkspaceStore<Workbench>(), {
      path: A,
      workbench: cyclic as Workbench,
    }),
  ).toThrow(/cycle/i)

  const shared = { value: 'shared' }
  expect(() =>
    openProjectWorkspace(createProjectWorkspaceStore(), {
      path: A,
      workbench: { left: shared, right: shared },
    }),
  ).not.toThrow()
})

test('initializes new workbenches lazily and preserves true no-op identity', () => {
  const metadata = project(A, 'Alpha')
  let calls = 0
  const state = openProjectWorkspace(createProjectWorkspaceStore<Workbench>(), {
    path: A,
    project: metadata,
    createWorkbench: () => {
      calls += 1
      return workbenchA
    },
  })
  expect(calls).toBe(1)
  expect(() =>
    openProjectWorkspace(createProjectWorkspaceStore<Workbench>(), { path: A }),
  ).toThrow(/workbench.*required/i)

  expect(
    openProjectWorkspace(state, {
      path: A,
      createWorkbench: () => {
        calls += 1
        return workbenchB
      },
    }),
  ).toBe(state)
  expect(calls).toBe(1)
  expect(activateProjectWorkspace(state, A)).toBe(state)
  expect(setProjectWorkbench(state, A, workbenchA)).toBe(state)
  expect(updateProjectWorkbench(state, A, (current) => current)).toBe(state)
  expect(setProjectWorkspaceHydration(state, A, 'idle')).toBe(state)
  expect(setProjectWorkspaceMetadata(state, A, metadata)).toBe(state)
  expect(setProjectWorkspaceCloseBlockedReason(state, A, null)).toBe(state)
})
