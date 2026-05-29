import type { ReactElement } from 'react'

import { StatusBar } from './StatusBar'
import { Titlebar } from './Titlebar'

const workspace = {
  activeGroupId: 'group-1',
  groups: {
    'group-1': {
      id: 'group-1',
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', title: 'backend', status: 'running' }],
    },
  },
}

const project = {
  name: 'aurora-monorepo',
  branch: 'feature/onboarding-funnel',
  changedFiles: 7,
  ahead: 3,
  behind: 0,
}

const icons = {
  gear: () => <svg />,
  dot: () => <svg />,
  branch: () => <svg />,
}

const translate = (_language: string, key: string) => key

export function renderAppShellContract(): ReactElement {
  return (
    <>
      <Titlebar
        lang="en"
        workspace={workspace}
        providers={[{ state: 'connected' }]}
        project={project}
        icons={icons}
        translate={translate}
        openSettings={() => undefined}
      />
      <StatusBar
        lang="en"
        mode="balanced"
        workspace={workspace}
        project={project}
        icons={icons}
        translate={translate}
      />
    </>
  )
}
