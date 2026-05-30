export type AsyncStatus = 'idle' | 'pending' | 'success' | 'failed'

export interface TimestampedEntity {
  readonly createdAt: string
  readonly updatedAt?: string
}
