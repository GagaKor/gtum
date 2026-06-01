import type { ReactElement } from 'react'

import { StatusBar } from './StatusBar'
import { Titlebar } from './Titlebar'

const workspace = {
  activeGroupId: 'group-empty',
  groups: {
    'group-empty': {
      id: 'group-empty',
      tabs: [],
    },
  },
}

const project = {
  name: 'Open a project',
  branch: 'no-project',
  changedFiles: 0,
  ahead: 0,
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
        os="mac"
        maximized={false}
        workspace={workspace}
        providers={[{ state: 'connected' }]}
        project={project}
        icons={icons}
        translate={translate}
        openSettings={() => undefined}
        onMinimize={() => undefined}
        onToggleMax={() => undefined}
        onClose={() => undefined}
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
