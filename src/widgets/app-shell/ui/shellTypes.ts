import type { ReactElement } from 'react'

export type ShellLanguage = 'ko' | 'en' | string

export type ShellTranslate = (language: ShellLanguage, key: string) => string

// Window-chrome platform variant. Drives whether the titlebar renders macOS
// traffic lights (left) or Windows caption buttons (right). Linux maps to 'mac'
// because the design draft only defines mac/windows window chrome.
export type ShellOs = 'mac' | 'windows'

export type ShellIcon = (props?: Record<string, unknown>) => ReactElement

export interface ShellIcons {
  readonly gear: ShellIcon
  readonly dot: ShellIcon
  readonly branch: ShellIcon
}

export interface ShellTab {
  readonly id?: string
  readonly title?: string
  readonly status?: string
}

export interface ShellGroup {
  readonly id?: string
  readonly activeTabId?: string
  readonly tabs?: readonly ShellTab[]
}

export interface ShellWorkspace {
  readonly activeGroupId?: string
  readonly groups?: Record<string, ShellGroup>
}

export interface ShellProject {
  readonly name: string
  readonly branch: string
  readonly changedFiles: number
  readonly ahead: number
  readonly behind: number
}

export interface ShellProvider {
  readonly state?: string
}

export function allShellTabs(workspace: ShellWorkspace): ShellTab[] {
  return Object.values(workspace.groups ?? {}).flatMap((group) => [...(group.tabs ?? [])])
}

export function activeShellTab(workspace: ShellWorkspace): ShellTab | null {
  const group = workspace.groups?.[workspace.activeGroupId ?? '']
  return group?.tabs?.find((tab) => tab.id === group.activeTabId) ?? group?.tabs?.[0] ?? null
}

export function shellWorkspaceStatus(workspace: ShellWorkspace): string {
  const statusRank: Record<string, number> = {
    idle: 0,
    running: 1,
    passing: 2,
    failed: 3,
  }

  return allShellTabs(workspace).reduce((current, tab) => {
    const next = tab.status ?? 'idle'
    return (statusRank[next] ?? 0) > (statusRank[current] ?? 0) ? next : current
  }, 'idle')
}
