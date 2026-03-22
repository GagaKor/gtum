import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'
import { useWorkspaceStore } from './stores/workspace-store'

type RuntimeInfo = {
  app_name: string
  platform: string
  mode: string
}

function App() {
  const { activeProject, activeContext, panels, togglePanel } =
    useWorkspaceStore()
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)

  useEffect(() => {
    invoke<RuntimeInfo>('get_runtime_info')
      .then(setRuntimeInfo)
      .catch(() => {
        setRuntimeInfo(null)
      })
  }, [])

  return (
    <div className="app-shell">
      {panels.projects ? (
        <aside className="panel sidebar">
          <div className="panel-header">
            <span className="eyebrow">Projects</span>
            <button onClick={() => togglePanel('projects')}>Hide</button>
          </div>
          <h1>gtum</h1>
          <p className="lead">
            Project-centric terminal workspace for agents, code, and live logs.
          </p>
          <div className="stack">
            <article className="card">
              <span className="label">Active Project</span>
              <strong>{activeProject}</strong>
              <p>Branch-aware workspace bootstrapped for Sprint 0.</p>
            </article>
            <article className="card">
              <span className="label">Sprint Focus</span>
              <strong>{activeContext}</strong>
              <p>App shell, layout, state foundation, and runtime handshake.</p>
            </article>
          </div>
        </aside>
      ) : (
        <button className="rail-button left" onClick={() => togglePanel('projects')}>
          Show Projects
        </button>
      )}

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2>Conductor-ready terminal shell</h2>
          </div>
          <div className="pill-row">
            <span className="pill">Sprint 0</span>
            <span className="pill">React + Vite</span>
            <span className="pill">Tauri Runtime</span>
          </div>
        </header>

        <section className="workspace-body">
          <div className="terminal-stage">
            <div className="terminal-tabs">
              <button className="tab active">workspace</button>
              <button className="tab">agents</button>
              <button className="tab">tests</button>
            </div>
            <div className="terminal-window">
              <div className="terminal-line">$ sprint-0:init</div>
              <div className="terminal-line dim">
                Bootstrapped frontend shell and connected runtime probe.
              </div>
              <div className="terminal-line">$ runtime-info</div>
              <div className="terminal-line">
                {runtimeInfo
                  ? `${runtimeInfo.app_name} • ${runtimeInfo.platform} • ${runtimeInfo.mode}`
                  : 'Runtime handshake pending or unavailable in browser-only mode.'}
              </div>
            </div>
          </div>

          <section className="status-grid">
            <article className="card emphasis">
              <span className="label">Runtime Probe</span>
              <strong>{runtimeInfo ? 'Connected' : 'Fallback Mode'}</strong>
              <p>
                Sample Tauri command is wired so Sprint 0 can validate frontend and
                runtime communication.
              </p>
            </article>
            <article className="card">
              <span className="label">State</span>
              <strong>Zustand Ready</strong>
              <p>Workspace UI state is managed through a shared store.</p>
            </article>
            <article className="card">
              <span className="label">Next Step</span>
              <strong>Project Open Flow</strong>
              <p>Sprint 1 can layer project selection and file tree over this shell.</p>
            </article>
          </section>
        </section>
      </main>

      {panels.agents ? (
        <aside className="panel inspector">
          <div className="panel-header">
            <span className="eyebrow">Agents</span>
            <button onClick={() => togglePanel('agents')}>Hide</button>
          </div>
          <div className="stack">
            <article className="card">
              <span className="label">Orchestrator</span>
              <strong>Active</strong>
              <p>Tracking sprint progress against docs and PR flow.</p>
            </article>
            <article className="card">
              <span className="label">Tester</span>
              <strong>Documenting</strong>
              <p>Verification notes and blockers are being captured for Sprint 0.</p>
            </article>
            <article className="card">
              <span className="label">Policy</span>
              <strong>feature → dev → master</strong>
              <p>PR quality gates decide whether to merge or redirect workers.</p>
            </article>
          </div>
        </aside>
      ) : (
        <button className="rail-button right" onClick={() => togglePanel('agents')}>
          Show Agents
        </button>
      )}
    </div>
  )
}

export default App
