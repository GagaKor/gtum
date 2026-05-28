import type { TimestampedEntity } from '../../../shared/types/status'

export type ProjectId = string

export interface ProjectSummary extends TimestampedEntity {
  readonly id: ProjectId
  readonly name: string
  readonly path: string
  readonly branch?: string
  readonly changedFileCount: number
}
