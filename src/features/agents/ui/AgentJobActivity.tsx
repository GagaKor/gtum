import type { AgentJobView } from '../model/useAgentJobLifecycle'

type AgentJobActivityProps = {
  jobs: AgentJobView[]
  onCancel(jobId: number): void
}

const statusLabel = (status: AgentJobView['snapshot']['status']): string =>
  status === 'cancelling' ? 'Cancelling' : status[0].toUpperCase() + status.slice(1)

export const AgentJobActivity = ({
  jobs,
  onCancel,
}: AgentJobActivityProps) => {
  if (jobs.length === 0) return null

  return (
    <section className="agent-job-activity" aria-label="Agent jobs">
      <div className="agent-job-activity-header">
        <span>Agent jobs</span>
        <small>{jobs.length}</small>
      </div>
      <div className="agent-job-list">
        {jobs.map((view) => {
          const { snapshot } = view
          const errors = [
            { kind: 'log-read', label: 'Log read', value: view.logError },
            { kind: 'action', label: 'Action', value: view.actionError },
            {
              kind: 'log-capture',
              label: 'Log capture',
              value: snapshot.logCaptureError,
            },
            { kind: 'process', label: 'Process', value: snapshot.processError },
            {
              kind: 'persistence',
              label: 'Persistence',
              value: snapshot.persistenceError,
            },
          ].filter(
            (error): error is { kind: string; label: string; value: string } =>
              Boolean(error.value),
          )

          return (
            <article
              className="agent-job-row"
              data-job-id={snapshot.jobId}
              data-status={snapshot.status}
              data-owner-project-path={view.projectPath}
              data-owner-session-id={view.sessionId ?? ''}
              key={snapshot.jobId}
            >
              <div className="agent-job-summary">
                <span className="agent-job-name">{snapshot.name}</span>
                <span className="agent-job-id">#{snapshot.jobId}</span>
                <span className="agent-job-status">{statusLabel(snapshot.status)}</span>
                {snapshot.exitCode != null && (
                  <span className="agent-job-exit">Exit {snapshot.exitCode}</span>
                )}
                {snapshot.status === 'running' && !view.cancelPending && (
                  <button
                    className="agent-job-cancel"
                    type="button"
                    onClick={() => onCancel(snapshot.jobId)}
                  >
                    Cancel
                  </button>
                )}
                {view.cancelPending && (
                  <span className="agent-job-cancelling">Cancelling…</span>
                )}
              </div>
              <code className="agent-job-command">{snapshot.command}</code>
              {view.entries.length > 0 && (
                <div className="agent-job-logs" aria-label={`Logs for job ${snapshot.jobId}`}>
                  {view.entries.slice(-6).map((entry) => (
                    <div
                      className="agent-job-log"
                      data-sequence={entry.sequence}
                      data-stream={entry.stream}
                      key={entry.sequence}
                    >
                      <span>{entry.stream}</span>
                      <code>{entry.text}</code>
                    </div>
                  ))}
                </div>
              )}
              {errors.map((error) => (
                <div
                  className="agent-job-error"
                  data-error-kind={error.kind}
                  key={`${error.kind}:${error.value}`}
                >
                  <strong>{error.label}</strong>
                  <span>{error.value}</span>
                </div>
              ))}
            </article>
          )
        })}
      </div>
    </section>
  )
}
