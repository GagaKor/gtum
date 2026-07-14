export type WorkbenchTabKind = 'editor' | 'terminal' | 'diff' | 'preview'

export type WorkbenchGroupDirection = 'horizontal' | 'vertical'

export interface WorkbenchTab {
  readonly id: string
  readonly kind: WorkbenchTabKind
  readonly title: string
  readonly projectPath: string
  readonly path?: string
  readonly dirty?: boolean
}

export interface WorkbenchGroup {
  readonly id: string
  readonly activeTabId?: string
  readonly tabs: readonly WorkbenchTab[]
}

export interface WorkbenchLayoutNode {
  readonly id: string
  readonly direction?: WorkbenchGroupDirection
  readonly group?: WorkbenchGroup
  readonly children?: readonly WorkbenchLayoutNode[]
}
