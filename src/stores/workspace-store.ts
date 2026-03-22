import { create } from 'zustand'

type PanelKey = 'projects' | 'agents'

type WorkspaceState = {
  activeProject: string
  activeContext: string
  panels: Record<PanelKey, boolean>
  setActiveProject: (project: string) => void
  setActiveContext: (context: string) => void
  togglePanel: (panel: PanelKey) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeProject: 'gtum',
  activeContext: 'Sprint 0 App Shell',
  panels: {
    projects: true,
    agents: true,
  },
  setActiveProject: (activeProject) => set({ activeProject }),
  setActiveContext: (activeContext) => set({ activeContext }),
  togglePanel: (panel) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [panel]: !state.panels[panel],
      },
    })),
}))
