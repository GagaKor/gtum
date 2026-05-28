import {
  type ProjectFileSnapshot,
  type ProjectRuntimeService,
  type RuntimeProject,
  type RuntimeProjectOverview,
} from './runtimeProjects'

export async function assertRuntimeProjectContracts(
  service: ProjectRuntimeService,
): Promise<void> {
  const overview = await service.readProjectOverview('/workspace')
  const project: RuntimeProject = overview.project
  const rawOverview: RuntimeProjectOverview | null = overview.raw

  const snapshot = await service.readProjectFile(project, 'src/main.tsx', 'main.tsx')
  const fileSnapshot: ProjectFileSnapshot = snapshot

  project.runtimeBacked satisfies boolean
  rawOverview?.metadata.path satisfies string | undefined
  fileSnapshot.content satisfies string
  fileSnapshot.isText satisfies boolean
}
