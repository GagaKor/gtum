import { useCallback, useState } from 'react'
import type { RecordTask, TaskHistoryEntry, TaskHistoryStatus } from './types'

const TASK_HISTORY_LIMIT = 12

export const useTaskHistory = (initialTaskHistory: TaskHistoryEntry[] = []) => {
  const [taskHistory, setTaskHistory] = useState<TaskHistoryEntry[]>(initialTaskHistory)

  const recordTask = useCallback<RecordTask>(
    (title: string, detail: string, status: TaskHistoryStatus = 'done') => {
      setTaskHistory((current) =>
        [
          {
            id: `task-${Date.now()}-${current.length}`,
            title,
            detail,
            status,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ].slice(0, TASK_HISTORY_LIMIT),
      )
    },
    [],
  )

  return {
    taskHistory,
    setTaskHistory,
    recordTask,
  }
}
