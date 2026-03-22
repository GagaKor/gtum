import { create } from 'zustand'

type PanelKey = 'projects' | 'agents'

const RECENT_PROJECTS_KEY = 'gtum.recent-projects'

const loadRecentProjects = () => {
  if (typeof window === 'undefined') {
    return [] as string[]
  }

  try {
    const value = window.localStorage.getItem(RECENT_PROJECTS_KEY)
    return value ? (JSON.parse(value) as string[]) : []
  } catch {
    return []
  }
}

const saveRecentProjects = (projects: string[]) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects))
}

type WorkspaceState = {
  activeProject: string
  activeContext: string
  activeProjectPath: string
  projectPathInput: string
  recentProjects: string[]
  panels: Record<PanelKey, boolean>
  setActiveProject: (project: string) => void
  setActiveContext: (context: string) => void
  setActiveProjectPath: (path: string) => void
  setProjectPathInput: (path: string) => void
  rememberProject: (path: string) => void
  togglePanel: (panel: PanelKey) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeProject: 'gtum',
  activeContext: 'Sprint 1 Project Workspace',
  activeProjectPath: '',
  projectPathInput: '',
  recentProjects: loadRecentProjects(),
  panels: {
    projects: true,
    agents: true,
  },
  setActiveProject: (activeProject) => set({ activeProject }),
  setActiveContext: (activeContext) => set({ activeContext }),
  setActiveProjectPath: (activeProjectPath) => set({ activeProjectPath }),
  setProjectPathInput: (projectPathInput) => set({ projectPathInput }),
  rememberProject: (path) =>
    set((state) => {
      const recentProjects = [path, ...state.recentProjects.filter((entry) => entry !== path)].slice(
        0,
        6,
      )

      saveRecentProjects(recentProjects)

      return { recentProjects }
    }),
  togglePanel: (panel) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [panel]: !state.panels[panel],
      },
    })),
}))
