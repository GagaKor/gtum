export type TaskHistoryStatus = 'done' | 'pending' | 'error'

export type TaskHistoryEntry = {
  id: string
  title: string
  detail: string
  status: TaskHistoryStatus
  createdAt: string
}

export type RecordTask = (
  title: string,
  detail: string,
  status?: TaskHistoryStatus,
) => void
