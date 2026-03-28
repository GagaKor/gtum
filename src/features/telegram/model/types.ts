export type TelegramReportState = {
  status: 'idle' | 'draft-ready' | 'queued'
  preview: string
  generatedAt: string | null
  queuedAt: string | null
}

export const emptyTelegramReportState = (): TelegramReportState => ({
  status: 'idle',
  preview: '',
  generatedAt: null,
  queuedAt: null,
})
