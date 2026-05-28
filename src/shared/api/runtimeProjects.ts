import { invoke } from "@tauri-apps/api/core";

export type RuntimeProjectNodeKind = "directory" | "file";

export type RuntimeProjectTreeNode = {
  name: string;
  path: string;
  kind: RuntimeProjectNodeKind;
  truncated?: boolean;
  children?: RuntimeProjectTreeNode[];
};

export type RuntimeProjectMetadata = {
  name?: string;
  path: string;
};

export type RuntimeProjectMetadataShape = RuntimeProjectMetadata & Record<string, unknown>;

export type RuntimeGitOverview = {
  isRepository?: boolean;
  branch?: string | null;
  branchType?: string | null;
  changedFilesCount?: number;
};

export type RuntimeProjectOverview = {
  metadata: RuntimeProjectMetadataShape;
  tree?: RuntimeProjectTreeNode | null;
  git?: RuntimeGitOverview | null;
};

export type RuntimeProjectFileSnapshot = {
  filePath: string;
  displayPath?: string | null;
  content?: string | null;
  isText?: boolean;
  truncated?: boolean;
};

export type ProjectTreeNode = {
  name: string;
  type: "dir" | string;
  open?: boolean;
  changed?: boolean;
  selected?: boolean;
  runtimePath?: string;
  truncated?: boolean;
  children?: ProjectTreeNode[];
};

export type RuntimeProject = {
  id: string;
  name: string;
  path: string;
  branch: string;
  branchType: string;
  ahead: number;
  behind: number;
  changedFiles: number;
  fileTree: ProjectTreeNode[];
  runtimeBacked: boolean;
};

export type ProjectFileSnapshot = {
  id: string;
  type: "editor";
  title: string;
  path: string;
  displayPath: string;
  lang: string;
  content: string;
  isText: boolean;
  truncated: boolean;
  dirty: boolean;
  status: "idle";
  cwd: ".";
  cmd: null;
  shell: null;
  lines: string[];
};

export type ProjectRuntimeBridgeState = {
  desktop: boolean;
  projectPath: string;
  runtimeBacked: boolean;
};

export type ProjectOverviewResult = {
  project: RuntimeProject;
  raw: RuntimeProjectOverview | null;
  bridge: ProjectRuntimeBridgeState;
};

export type RuntimeInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type RuntimeAvailability = () => boolean;

export type ProjectRuntimeServiceOptions = {
  fallbackProject?: RuntimeProject;
  hasRuntime?: RuntimeAvailability;
  invokeRuntime?: RuntimeInvoker;
};

export type ProjectRuntimeService = {
  hasRuntime: RuntimeAvailability;
  getBridgeState(project?: RuntimeProject): ProjectRuntimeBridgeState;
  readProjectOverview(path?: string): Promise<ProjectOverviewResult>;
  readProjectFile(
    project: Pick<RuntimeProject, "path" | "runtimeBacked"> | null | undefined,
    filePath: string,
    fallbackName?: string,
  ): Promise<ProjectFileSnapshot>;
};

const FALLBACK_PROJECT: RuntimeProject = {
  name: "aurora-monorepo",
  path: "~/code/aurora-monorepo",
  id: "~/code/aurora-monorepo",
  branch: "feature/onboarding-funnel",
  branchType: "feature",
  ahead: 3,
  behind: 0,
  changedFiles: 7,
  runtimeBacked: false,
  fileTree: [
    {
      name: "apps",
      type: "dir",
      open: true,
      children: [
        {
          name: "web",
          type: "dir",
          open: true,
          children: [
            {
              name: "src",
              type: "dir",
              open: true,
              children: [
                { name: "OnboardingFunnel.tsx", type: "ts", changed: true, selected: true },
                { name: "useFunnelState.ts", type: "ts", changed: true },
                { name: "main.tsx", type: "ts" },
              ],
            },
            { name: "package.json", type: "json" },
            { name: "vite.config.ts", type: "ts" },
          ],
        },
        {
          name: "api",
          type: "dir",
          open: true,
          children: [
            { name: "src", type: "dir", open: false },
            { name: "server.ts", type: "ts", changed: true },
            { name: "package.json", type: "json", changed: true },
          ],
        },
      ],
    },
    { name: "packages", type: "dir", open: false },
    {
      name: "tests",
      type: "dir",
      open: true,
      children: [
        { name: "funnel.spec.ts", type: "ts", changed: true },
        { name: "checkout.spec.ts", type: "ts" },
      ],
    },
    { name: "package.json", type: "json" },
    { name: "pnpm-workspace.yaml", type: "yaml" },
    { name: "README.md", type: "md" },
  ],
};

export const fallbackRuntimeProject: RuntimeProject = FALLBACK_PROJECT;

export const hasTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined";

export const basenameOfPath = (value: string | null | undefined): string => {
  const parts = String(value || "").replace(/\\/g, "/").split("/").filter(Boolean);

  return parts.at(-1) || "workspace";
};

export const extensionOf = (name: string | null | undefined): string => {
  const ext = String(name || "").split(".").pop();

  return ext && ext !== name ? ext.toLowerCase() : "txt";
};

export const projectTreeNodeFromRuntime = (node: RuntimeProjectTreeNode): ProjectTreeNode => {
  const isDir = node.kind === "directory";

  return {
    name: node.name || basenameOfPath(node.path),
    type: isDir ? "dir" : extensionOf(node.name),
    open: isDir,
    changed: false,
    runtimePath: node.path,
    truncated: Boolean(node.truncated),
    children: (node.children || []).map(projectTreeNodeFromRuntime),
  };
};

export const projectFromRuntimeOverview = (
  overview: RuntimeProjectOverview,
  fallbackProject: RuntimeProject = fallbackRuntimeProject,
): RuntimeProject => {
  const tree = overview.tree;
  const rootChildren = tree?.children?.length ? tree.children : tree ? [tree] : [];
  const branch = overview.git?.branch || (overview.git?.isRepository ? "main" : "no-git");
  const projectPath = overview.metadata.path || fallbackProject.path;

  return {
    id: projectPath,
    name: overview.metadata.name || basenameOfPath(projectPath) || fallbackProject.name,
    path: projectPath,
    branch,
    branchType: overview.git?.branchType || "local",
    ahead: 0,
    behind: 0,
    changedFiles: overview.git?.changedFilesCount || 0,
    fileTree: rootChildren.map(projectTreeNodeFromRuntime),
    runtimeBacked: true,
  };
};

export const fileSnapshotFromFallback = (
  filePath: string,
  fallbackName?: string,
): ProjectFileSnapshot => {
  const displayPath = fallbackName || filePath || "file";
  const title = basenameOfPath(displayPath);

  return {
    id: "ed-" + String(filePath || displayPath).replace(/[^a-z0-9]+/gi, "-"),
    type: "editor",
    title,
    path: filePath || displayPath,
    displayPath,
    lang: extensionOf(displayPath),
    content: `// ${displayPath}\n// Browser preview is using bundled project data.`,
    isText: true,
    truncated: false,
    dirty: false,
    status: "idle",
    cwd: ".",
    cmd: null,
    shell: null,
    lines: [],
  };
};

export const fileSnapshotFromRuntime = (
  snapshot: RuntimeProjectFileSnapshot,
  fallbackName?: string,
): ProjectFileSnapshot => {
  const displayPath = snapshot.displayPath || fallbackName || snapshot.filePath || "file";
  const tabPath = snapshot.filePath || displayPath;
  const isText = snapshot.isText !== false;
  const content = isText
    ? snapshot.content || ""
    : `// ${displayPath}\n// Binary file preview is not available in gtum.`;
  const truncatedNote = snapshot.truncated && isText
    ? "\n\n// File preview truncated by the desktop runtime."
    : "";

  return {
    id: "ed-" + String(tabPath).replace(/[^a-z0-9]+/gi, "-"),
    type: "editor",
    title: basenameOfPath(displayPath),
    path: tabPath,
    displayPath,
    lang: extensionOf(displayPath),
    content: content + truncatedNote,
    isText,
    truncated: Boolean(snapshot.truncated),
    dirty: false,
    status: "idle",
    cwd: ".",
    cmd: null,
    shell: null,
    lines: [],
  };
};

export const createProjectRuntimeService = (
  options: ProjectRuntimeServiceOptions = {},
): ProjectRuntimeService => {
  const fallbackProject = options.fallbackProject || fallbackRuntimeProject;
  const hasRuntime = options.hasRuntime || hasTauriRuntime;
  const invokeRuntime = options.invokeRuntime || invoke as RuntimeInvoker;

  const getBridgeState = (project: RuntimeProject = fallbackProject): ProjectRuntimeBridgeState => ({
    desktop: hasRuntime(),
    projectPath: project.path,
    runtimeBacked: Boolean(project.runtimeBacked),
  });

  return {
    hasRuntime,
    getBridgeState,
    async readProjectOverview(path?: string): Promise<ProjectOverviewResult> {
      if (!hasRuntime()) {
        return {
          project: fallbackProject,
          raw: null,
          bridge: getBridgeState(fallbackProject),
        };
      }

      const raw = await invokeRuntime<RuntimeProjectOverview>("read_project_overview", {
        path: path || fallbackProject.path,
      });
      const project = projectFromRuntimeOverview(raw, fallbackProject);

      return {
        project,
        raw,
        bridge: getBridgeState(project),
      };
    },
    async readProjectFile(project, filePath, fallbackName): Promise<ProjectFileSnapshot> {
      if (!project?.runtimeBacked || !hasRuntime()) {
        return fileSnapshotFromFallback(filePath, fallbackName);
      }

      const snapshot = await invokeRuntime<RuntimeProjectFileSnapshot>("read_project_file", {
        projectPath: project.path,
        filePath,
      });

      return fileSnapshotFromRuntime(snapshot, fallbackName);
    },
  };
};

export const projectRuntimeService = createProjectRuntimeService();
