import type { PointerEvent as ReactPointerEvent } from 'react'
import type {
  AgentConnectionSnapshot,
  AgentProviderDiagnostics,
  ExecutionMode,
} from '../../../lib/runtime'
import type { AgentContextSnapshot } from '../../../stores/workspace-store'
import {
  buildProviderUiContract,
  formatProviderSetupStateBadgeClass,
  formatProviderSetupStateLabel,
} from '../../../features/auth/model/provider-ui'
import type { AgentSuggestion, AgentSuggestionTarget } from '../../../features/agents/model/types'
import { extractLineReference } from '../../../shared/lib/file-context'
import { formatModeLabel } from '../../../shared/lib/formatters'

type ProviderRequestPreview = {
  project: string
  file: string
  terminal: string
  lines: number
}

type AgentSidebarProps = {
  visible: boolean
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void
  onToggle: () => void
  agentConnections: AgentConnectionSnapshot[]
  providerDiagnostics: AgentProviderDiagnostics[]
  authError: string | null
  selectedProvider: AgentConnectionSnapshot['provider']
  onSelectProvider: (provider: AgentConnectionSnapshot['provider']) => void
  onStartProviderLogin: (provider: AgentConnectionSnapshot['provider']) => void
  onDisconnectProvider: (provider: AgentConnectionSnapshot['provider']) => void
  onOpenCodexLogin: () => void
  onSimulateMockCallback: (provider: AgentConnectionSnapshot['provider']) => void
  selectedConnection: AgentConnectionSnapshot | null
  selectedFileAnchorLabel: string
  selectedFileSnippet: string | null
  requestContextSnapshot: AgentContextSnapshot | null
  onOpenLineReference: (line: string) => void
  providerRequestPreview: ProviderRequestPreview
  executionMode: ExecutionMode
  onSelectExecutionMode: (mode: ExecutionMode) => void
  agentRequestInput: string
  onAgentRequestInputChange: (value: string) => void
  canSubmitAgentSuggestion: boolean
  onSubmitAgentRequest: () => void
  agentRequestError: string | null
  agentSuggestions: AgentSuggestion[]
  onApproveSuggestion: (suggestion: AgentSuggestion, target: AgentSuggestionTarget) => void
}

export function AgentSidebar({
  visible,
  onToggle,
  agentConnections,
  providerDiagnostics,
  authError,
  selectedProvider,
  onSelectProvider,
  onStartProviderLogin,
  onDisconnectProvider,
  onOpenCodexLogin,
  onSimulateMockCallback,
  selectedConnection,
  selectedFileAnchorLabel,
  selectedFileSnippet,
  requestContextSnapshot,
  onOpenLineReference,
  providerRequestPreview,
  executionMode,
  onSelectExecutionMode,
  agentRequestInput,
  onAgentRequestInputChange,
  canSubmitAgentSuggestion,
  onSubmitAgentRequest,
  agentRequestError,
  agentSuggestions,
  onApproveSuggestion,
}: AgentSidebarProps) {
  const diagnosticsByProvider = new Map(providerDiagnostics.map((entry) => [entry.provider, entry]))
  const selectedProviderContract = selectedConnection ? buildProviderUiContract(selectedConnection) : null
  const selectedDiagnostics = selectedConnection ? diagnosticsByProvider.get(selectedConnection.provider) : null
  const activeModelLabel =
    selectedDiagnostics?.model ??
    (selectedConnection?.provider === 'codex'
      ? 'Codex CLI session'
      : selectedConnection?.displayName ?? 'No provider selected')
  const activeProviderMark = selectedConnection?.displayName.slice(0, 2).toUpperCase() ?? 'AI'

  return (
    <aside className="agent right-dock" data-testid="right-dock">
      <div className="agent-header">
        <div className={`provider-mark ${selectedConnection?.provider ?? 'codex'}`}>
          {activeProviderMark}
        </div>
        <div className="who">
          <div className="nm">
            Agent Chat
            <span>· {selectedConnection?.displayName ?? 'Provider pending'}</span>
          </div>
          <div className="sub">Conductor + workers · {formatModeLabel(executionMode)}</div>
        </div>
        <button
          type="button"
          className="rail-toggle"
          onClick={onToggle}
          aria-label={visible ? 'Collapse agent panel' : 'Open agent panel'}
          title={visible ? 'Collapse agent panel' : 'Open agent panel'}
        >
          {visible ? '접기' : '열기'}
        </button>
      </div>

      {visible ? (
        <div className="right-panel-scroll agent-scroll">
          <div className="agent-model-row" data-testid="agent-model-row">
            <div className="agent-model-copy">
              <span>Active model</span>
              <strong>{activeModelLabel}</strong>
            </div>
            <ModePill executionMode={executionMode} onSelectExecutionMode={onSelectExecutionMode} />
          </div>

          <div className="context-summary">
            <div className="h">Request Context</div>
            <div className="row">
              <span className="k">file:</span>
              <span className="v">{providerRequestPreview.file}</span>
            </div>
            <div className="row">
              <span className="k">terminal:</span>
              <span className="v">
                {providerRequestPreview.terminal} · {providerRequestPreview.lines} lines
              </span>
            </div>
            <div className="row">
              <span className="k">project:</span>
              <span className="v">{providerRequestPreview.project}</span>
            </div>
          </div>

          <article className="agent-card" data-testid="provider-auth-panel">
            <div className="section-head">
              <strong>Provider</strong>
              <span>{selectedConnection?.displayName ?? 'none'}</span>
            </div>
            <div className="provider-selector" role="radiogroup" aria-label="Provider Selection">
              {agentConnections.map((connection) => (
                <label key={`selector-${connection.provider}`} className="provider-selector-option">
                  <input
                    type="radio"
                    name="provider-selection"
                    checked={selectedProvider === connection.provider}
                    onChange={() => onSelectProvider(connection.provider)}
                  />
                  <span>{connection.displayName}</span>
                </label>
              ))}
            </div>

            <div className="stack compact">
              {agentConnections.map((connection) => {
                const contract = buildProviderUiContract(connection)
                const diagnostics = diagnosticsByProvider.get(connection.provider)
                const displayedSetupState =
                  diagnostics && connection.connectionKind === 'real' && connection.status === 'error'
                    ? 'needs_setup'
                    : diagnostics?.setupState

                return (
                  <div
                    key={connection.provider}
                    className={`provider-card ${selectedProvider === connection.provider ? 'selected' : ''}`}
                    data-testid={`provider-card-${connection.provider}`}
                  >
                    <div className="provider-card-header">
                      <strong>{connection.displayName}</strong>
                      <div className="status-pill-row">
                        <span className={`status-badge kind-${connection.connectionKind}`}>
                          {connection.connectionKind === 'mock'
                            ? 'Mock'
                            : connection.connectionKind === 'prototype'
                              ? 'Prototype'
                              : 'Real'}
                        </span>
                        <span className={`status-badge state-${connection.status}`}>
                          {connection.status === 'connected'
                            ? 'Connected'
                            : connection.status === 'pending'
                              ? 'Pending'
                              : connection.status === 'error'
                                ? 'Attention Needed'
                                : 'Needs Connection'}
                        </span>
                      </div>
                    </div>
                    <p>
                      {connection.accountLabel
                        ? `${connection.accountLabel} is ready for requests.`
                        : contract.guidance}
                    </p>
                    <div className="inline-actions">
                      {contract.canDisconnect ? (
                        <button
                          type="button"
                          data-testid={`provider-action-${connection.provider}`}
                          onClick={() => onDisconnectProvider(connection.provider)}
                        >
                          {contract.primaryActionLabel}
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid={`provider-action-${connection.provider}`}
                          onClick={() => onStartProviderLogin(connection.provider)}
                          disabled={!contract.canStartLogin}
                        >
                          {contract.primaryActionLabel}
                        </button>
                      )}
                      {connection.provider === 'codex' &&
                      connection.connectionKind !== 'mock' &&
                      !contract.canDisconnect ? (
                        <button type="button" className="ghost-button" onClick={onOpenCodexLogin}>
                          Open Codex Login
                        </button>
                      ) : null}
                      {contract.canCompleteMock ? (
                        <button type="button" className="ghost-button" onClick={() => onSimulateMockCallback(connection.provider)}>
                          Complete Mock Callback
                        </button>
                      ) : null}
                    </div>
                    <p className="provider-selection-note">
                      scopes: {connection.requiredScopes.length > 0 ? connection.requiredScopes.join(', ') : 'none'}
                    </p>
                    {selectedProvider === connection.provider ? (
                      <p className="provider-selection-note">Selected provider for the next request.</p>
                    ) : null}
                    <details
                      className="subtle-disclosure"
                      data-testid={`provider-diagnostics-${connection.provider}`}
                    >
                      <summary>Diagnostics</summary>
                      {diagnostics ? (
                        <div className="stack compact">
                          <p>{diagnostics.summary}</p>
                          <p>{diagnostics.guidance}</p>
                          <div className="status-pill-row">
                            <span
                              className={`status-badge state-${formatProviderSetupStateBadgeClass(
                                displayedSetupState ?? diagnostics.setupState,
                              )}`}
                            >
                              {formatProviderSetupStateLabel(displayedSetupState ?? diagnostics.setupState)}
                            </span>
                            <span className="status-badge scopes">{diagnostics.connectionPath}</span>
                          </div>
                          {diagnostics.model ? <code>model: {diagnostics.model}</code> : null}
                          {diagnostics.baseUrl ? <code>base URL: {diagnostics.baseUrl}</code> : null}
                          {diagnostics.requirements.map((requirement) => (
                            <p key={`${connection.provider}-${requirement.name}`}>
                              {requirement.required ? 'required' : 'optional'} check • {requirement.name} •{' '}
                              {requirement.present ? 'present' : 'missing'}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p>Provider diagnostics are not available yet.</p>
                      )}
                    </details>
                    {connection.lastError ? <p className="error-text">{connection.lastError}</p> : null}
                  </div>
                )
              })}
              {authError ? <p className="error-text">{authError}</p> : null}
            </div>
          </article>

          <article className="agent-card thread-card">
            <div className="section-head">
              <strong>Thread</strong>
              <span>{selectedConnection?.displayName ?? 'No Provider Selected'}</span>
            </div>
            <div className="thread-stack">
              <div className="thread-bubble user">
                <div className="bubble-head">
                  <span>Request Contract</span>
                  <span>{formatModeLabel(executionMode)}</span>
                </div>
                <p data-testid="provider-request-preview">
                  {providerRequestPreview.project} · {providerRequestPreview.file} · {providerRequestPreview.terminal} ·{' '}
                  {providerRequestPreview.lines} active log line(s) prepared for the provider request.
                </p>
              </div>
              <div className="thread-bubble">
                <div className="bubble-head">
                  <span>Context</span>
                  <span>{selectedFileAnchorLabel}</span>
                </div>
                <div className="context-block">
                  <span className="context-meta">Selected file</span>
                  {selectedFileSnippet ? <code>{selectedFileSnippet}</code> : <p>Select a file from the project tree to attach code context.</p>}
                </div>
                {requestContextSnapshot ? (
                  <div className="context-block" data-testid="agent-context-buffer">
                    <span className="context-meta">{requestContextSnapshot.capturedAt}</span>
                    {requestContextSnapshot.lines.map((line, index) => {
                      const reference = extractLineReference(line)

                      return (
                        <div className="context-line" key={`${requestContextSnapshot.tabId}-${index}`}>
                          <code>{line}</code>
                          {reference ? (
                            <button type="button" className="line-reference-button" onClick={() => onOpenLineReference(line)}>
                              Open {reference.label}
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="context-block" data-testid="agent-context-buffer">
                    <p>Once the active terminal has output, gtum will auto-attach the latest 50 lines for the next request.</p>
                  </div>
                )}
              </div>
            </div>
          </article>

          <article className="agent-card execution-mode-card" data-testid="execution-mode-panel">
            <div className="section-head">
              <strong>Execution Mode</strong>
              <span>{formatModeLabel(executionMode)}</span>
            </div>
            <div className="provider-selector" role="radiogroup" aria-label="Execution Mode">
              {(['fast', 'balanced', 'deep'] as ExecutionMode[]).map((mode) => (
                <label key={mode} className="provider-selector-option">
                  <input
                    type="radio"
                    name="execution-mode"
                    checked={executionMode === mode}
                    onChange={() => onSelectExecutionMode(mode)}
                  />
                  <span>{formatModeLabel(mode)}</span>
                </label>
              ))}
            </div>
          </article>

          <article className="agent-card composer-card" data-testid="agent-request-panel">
            <div className="section-head">
              <strong>Request</strong>
              <span>{selectedConnection?.displayName ?? 'No Provider Selected'}</span>
            </div>
            <label className="field-block">
              <span className="label">Task Request</span>
              <textarea
                aria-label="Task Request"
                className="request-textarea"
                value={agentRequestInput}
                onChange={(event) => onAgentRequestInputChange(event.target.value)}
                placeholder="Analyze the failing test logs and suggest the next command."
              />
            </label>
            <div className="inline-actions">
              <button type="button" onClick={onSubmitAgentRequest} disabled={!canSubmitAgentSuggestion}>
                {selectedProvider === 'codex' ? 'Ask Codex' : 'Request Suggestion'}
              </button>
            </div>
            {!selectedProviderContract?.canRequestSuggestion ? (
              <p className="provider-selection-note">
                Connect Codex after the desktop Codex CLI session is ready, then use the validated request flow.
              </p>
            ) : null}
            {agentRequestError ? <p className="error-text">{agentRequestError}</p> : null}
          </article>

          <article className="agent-card" data-testid="agent-suggestions-panel">
            <div className="section-head">
              <strong>지금 처리할 제안</strong>
              <span>{agentSuggestions.length}</span>
            </div>
            <div className="stack compact">
              {agentSuggestions.length > 0 ? (
                agentSuggestions.map((suggestion) => (
                  <div key={suggestion.id} className="suggestion-card" data-testid={`suggestion-card-${suggestion.provider}`}>
                    <strong>{suggestion.providerLabel}</strong>
                    <p>{suggestion.summary}</p>
                    {suggestion.command ? <code>{suggestion.command}</code> : null}
                    <p>
                      {suggestion.projectLabel} • {suggestion.fileLabel ?? 'No file context'} •{' '}
                      {suggestion.terminalLabel} • {suggestion.attachedLogLines} log line(s)
                    </p>
                    <p>Status: {suggestion.status} • confidence: {suggestion.confidence}</p>
                    {suggestion.error ? <p className="error-text">{suggestion.error}</p> : null}
                    <div className="inline-actions">
                      <button
                        type="button"
                        onClick={() => onApproveSuggestion(suggestion, 'current-tab')}
                        disabled={suggestion.status !== 'pending' || !suggestion.command || Boolean(suggestion.error)}
                      >
                        Approve In Current Tab
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => onApproveSuggestion(suggestion, 'new-tab')}
                        disabled={suggestion.status !== 'pending' || !suggestion.command || Boolean(suggestion.error)}
                      >
                        Approve In New Tab
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p>Connect Codex and submit a task request to generate the next CLI-backed command suggestion.</p>
              )}
            </div>
          </article>
        </div>
      ) : null}

    </aside>
  )
}

function ModePill({
  executionMode,
  onSelectExecutionMode,
}: {
  executionMode: ExecutionMode
  onSelectExecutionMode: (mode: ExecutionMode) => void
}) {
  return (
    <div className="mode-pill" aria-label="Execution mode">
      {(['fast', 'balanced', 'deep'] as ExecutionMode[]).map((mode) => (
        <button
          key={mode}
          type="button"
          className={executionMode === mode ? 'active' : ''}
          onClick={() => onSelectExecutionMode(mode)}
        >
          {formatModeLabel(mode)}
        </button>
      ))}
    </div>
  )
}
