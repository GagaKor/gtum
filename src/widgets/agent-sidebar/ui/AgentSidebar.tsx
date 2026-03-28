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
import { formatModeLabel } from '../../../shared/lib/formatters'
import { extractLineReference } from '../../../shared/lib/file-context'

type ProviderRequestPreview = {
  project: string
  file: string
  terminal: string
  lines: number
}

type AgentSidebarProps = {
  visible: boolean
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
  if (!visible) {
    return (
      <button className="rail-button right" onClick={onToggle}>
        Show Agents
      </button>
    )
  }

  const diagnosticsByProvider = new Map(providerDiagnostics.map((entry) => [entry.provider, entry]))
  const selectedProviderContract = selectedConnection ? buildProviderUiContract(selectedConnection) : null

  return (
    <aside className="panel inspector">
      <div className="panel-header">
        <span className="eyebrow">Agent Panel</span>
        <button onClick={onToggle}>Hide</button>
      </div>
      <div className="stack agent-panel-stack">
        <article className="card agent-stage-card" data-testid="provider-auth-panel">
          <span className="label">Step 1 · Provider</span>
          <strong>{selectedConnection ? selectedProviderContract?.statusLabel : 'No provider selected'}</strong>
          <p>
            {selectedConnection
              ? selectedProviderContract?.guidance
              : 'Choose a provider, then use the matching contract state to unlock the request flow.'}
          </p>
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
                  <div className="terminal-actions">
                    {contract.canDisconnect ? (
                      <button
                        data-testid={`provider-action-${connection.provider}`}
                        onClick={() => onDisconnectProvider(connection.provider)}
                      >
                        {contract.primaryActionLabel}
                      </button>
                    ) : (
                      <button
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
                      <button onClick={onOpenCodexLogin}>Open Codex Login</button>
                    ) : null}
                    {contract.canCompleteMock ? (
                      <button onClick={() => onSimulateMockCallback(connection.provider)}>
                        Complete Mock Callback
                      </button>
                    ) : null}
                  </div>
                  <div className="status-pill-row">
                    <span className="status-badge scopes">
                      scopes: {connection.requiredScopes.length > 0 ? connection.requiredScopes.join(', ') : 'none'}
                    </span>
                  </div>
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
                    {connection.callbackUrl ? <code>{connection.callbackUrl}</code> : null}
                    {connection.authUrl ? <code>{connection.authUrl}</code> : null}
                  </details>
                  {connection.lastError ? <p className="error-text">{connection.lastError}</p> : null}
                </div>
              )
            })}
            {authError ? <p className="error-text">{authError}</p> : null}
          </div>
        </article>

        <article className="card agent-stage-card">
          <span className="label">Step 2 · Context</span>
          <strong>{selectedFileAnchorLabel ?? requestContextSnapshot?.tabTitle ?? 'No Active Context Yet'}</strong>
          <p>
            The request uses the selected file, optional line anchor, plus the active terminal and keeps the
            latest 50 lines ready for Codex.
          </p>
          <div className="context-block">
            <span className="context-meta">Selected file</span>
            {selectedFileSnippet ? (
              <code>{selectedFileSnippet}</code>
            ) : (
              <p>Select a file from the project tree to attach code context.</p>
            )}
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
                      <button
                        type="button"
                        className="line-reference-button"
                        onClick={() => onOpenLineReference(line)}
                      >
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
        </article>

        <article className="card agent-stage-card" data-testid="provider-request-preview">
          <span className="label">Step 3 · Request Contract</span>
          <strong>{providerRequestPreview.project}</strong>
          <p>{providerRequestPreview.file}</p>
          <p>{providerRequestPreview.terminal}</p>
          <p>{providerRequestPreview.lines} active log line(s) prepared for the provider request.</p>
        </article>

        <article className="card agent-stage-card" data-testid="execution-mode-panel">
          <span className="label">Execution Mode</span>
          <strong>{formatModeLabel(executionMode)}</strong>
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
          <p>
            {executionMode === 'fast'
              ? 'Ask quickly with a shorter, lighter review path.'
              : executionMode === 'balanced'
                ? 'Use the default review path with the active terminal context.'
                : 'Use the fullest review path before approving the next command.'}
          </p>
        </article>

        <article className="card agent-stage-card" data-testid="agent-request-panel">
          <span className="label">Step 4 · Request</span>
          <strong>{selectedConnection?.displayName ?? 'No Provider Selected'}</strong>
          <p>
            Submit a task request using the selected provider, project metadata, selected file context, and
            the latest active terminal logs.
          </p>
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
          <div className="terminal-actions">
            <button onClick={onSubmitAgentRequest} disabled={!canSubmitAgentSuggestion}>
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

        <article className="card agent-stage-card" data-testid="agent-suggestions-panel">
          <span className="label">Step 5 · Review And Approve</span>
          <strong>{agentSuggestions.length > 0 ? 'Pending Review' : 'No Suggestions Yet'}</strong>
          <div className="stack compact">
            {agentSuggestions.length > 0 ? (
              agentSuggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className="suggestion-card"
                  data-testid={`suggestion-card-${suggestion.provider}`}
                >
                  <strong>{suggestion.providerLabel}</strong>
                  <p>{suggestion.summary}</p>
                  {suggestion.command ? <code>{suggestion.command}</code> : null}
                  <p>
                    {suggestion.projectLabel} • {suggestion.fileLabel ?? 'No file context'} •{' '}
                    {suggestion.terminalLabel} • {suggestion.attachedLogLines} log line(s)
                  </p>
                  <p>Status: {suggestion.status} • confidence: {suggestion.confidence}</p>
                  {suggestion.error ? <p className="error-text">{suggestion.error}</p> : null}
                  <div className="terminal-actions">
                    <button
                      onClick={() => onApproveSuggestion(suggestion, 'current-tab')}
                      disabled={suggestion.status !== 'pending' || !suggestion.command || Boolean(suggestion.error)}
                    >
                      Approve In Current Tab
                    </button>
                    <button
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
    </aside>
  )
}
