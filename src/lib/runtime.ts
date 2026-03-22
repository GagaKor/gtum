import { invoke } from '@tauri-apps/api/core'

export type RuntimeInfo = {
  app_name: string
  platform: string
  mode: string
}

export type ProjectMetadata = {
  name: string
  path: string
  exists: boolean
  isDirectory: boolean
}

export type FileTreeNode = {
  name: string
  path: string
  kind: 'file' | 'directory'
  children: FileTreeNode[]
  truncated: boolean
}

export type GitOverview = {
  isRepository: boolean
  branch: string | null
  branchType: string | null
  isDirty: boolean
  changedFilesCount: number
}

export type ProjectOverview = {
  metadata: ProjectMetadata
  tree: FileTreeNode
  git: GitOverview
}

const mockTree: FileTreeNode = {
  name: 'demo-project',
  path: '/mock/demo-project',
  kind: 'directory',
  truncated: false,
  children: [
    {
      name: 'src',
      path: '/mock/demo-project/src',
      kind: 'directory',
      truncated: false,
      children: [
        {
          name: 'App.tsx',
          path: '/mock/demo-project/src/App.tsx',
          kind: 'file',
          truncated: false,
          children: [],
        },
      ],
    },
    {
      name: 'package.json',
      path: '/mock/demo-project/package.json',
      kind: 'file',
      truncated: false,
      children: [],
    },
  ],
}

const shouldUseMockRuntime = () => {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('e2eMock') === '1'
}

export const getRuntimeInfo = async () => {
  if (shouldUseMockRuntime()) {
    return {
      app_name: 'gtum',
      platform: 'mock-web',
      mode: 'e2e',
    } satisfies RuntimeInfo
  }

  return invoke<RuntimeInfo>('get_runtime_info')
}

export const readProjectOverview = async (path: string) => {
  if (shouldUseMockRuntime()) {
    return {
      metadata: {
        name: path.split('/').filter(Boolean).at(-1) || 'demo-project',
        path: path || '/mock/demo-project',
        exists: true,
        isDirectory: true,
      },
      tree: {
        ...mockTree,
        name: path.split('/').filter(Boolean).at(-1) || mockTree.name,
        path: path || mockTree.path,
      },
      git: {
        isRepository: true,
        branch: 'feature/mock-project-open',
        branchType: 'feature',
        isDirty: true,
        changedFilesCount: 3,
      },
    } satisfies ProjectOverview
  }

  return invoke<ProjectOverview>('read_project_overview', { path })
}
