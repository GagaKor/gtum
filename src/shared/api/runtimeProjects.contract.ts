import {
  type ProjectFileSnapshot,
  type ProjectRuntimeService,
  type RuntimeProject,
  type RuntimeProjectOverview,
} from './runtimeProjects'
import type { WorkbenchTab } from '../../features/workbench/model/types'

export async function assertRuntimeProjectContracts(
  service: ProjectRuntimeService,
): Promise<void> {
  const overview = await service.readProjectOverview('/workspace')
  const project: RuntimeProject = overview.project
  const rawOverview: RuntimeProjectOverview | null = overview.raw

  const snapshot = await service.readProjectFile(project, 'src/main.tsx', 'main.tsx')
  const fileSnapshot: ProjectFileSnapshot = snapshot
  const tab: WorkbenchTab = {
    id: fileSnapshot.id,
    kind: 'editor',
    title: fileSnapshot.title,
    projectPath: fileSnapshot.projectPath,
    path: fileSnapshot.path,
  }

  project.runtimeBacked satisfies boolean
  rawOverview?.metadata.path satisfies string | undefined
  fileSnapshot.content satisfies string
  fileSnapshot.projectPath satisfies string
  fileSnapshot.isText satisfies boolean
  tab.projectPath satisfies string
}
