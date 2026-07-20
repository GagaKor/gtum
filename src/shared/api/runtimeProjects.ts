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
  readonly projectPath: string;
  filePath: string;
  displayPath?: string | null;
  content?: string | null;
  contentHash?: string | null;
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
  readonly projectPath: string;
  id: string;
  type: "editor";
  title: string;
  path: string;
  displayPath: string;
  lang: string;
  content: string;
  contentHash: string | null;
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

export type FallbackProjectFileReader = (
  filePath: string,
  fallbackName?: string,
  projectPath?: string,
) => ProjectFileSnapshot;

export type ProjectRuntimeServiceOptions = {
  fallbackProject?: RuntimeProject;
  fallbackFileReader?: FallbackProjectFileReader;
  hasRuntime?: RuntimeAvailability;
  invokeRuntime?: RuntimeInvoker;
};

type RuntimeProjectOverride = {
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
  saveProjectFile(
    project: Pick<RuntimeProject, "path" | "runtimeBacked"> | null | undefined,
    file: Pick<ProjectFileSnapshot, "projectPath" | "path" | "content" | "contentHash">,
  ): Promise<ProjectFileSnapshot>;
  applyProjectPatch(
    project: Pick<RuntimeProject, "path" | "runtimeBacked"> | null | undefined,
    edits: Array<
      Pick<ProjectFileSnapshot, "projectPath" | "path" | "content" | "contentHash">
    >,
  ): Promise<ProjectFileSnapshot[]>;
};

const FALLBACK_PROJECT: RuntimeProject = {
  name: "Open a project",
  path: "",
  id: "",
  branch: "no-project",
  branchType: "none",
  ahead: 0,
  behind: 0,
  changedFiles: 0,
  runtimeBacked: false,
  fileTree: [],
};

export const fallbackRuntimeProject: RuntimeProject = FALLBACK_PROJECT;

export const hasTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined";

const projectOverride = (): RuntimeProjectOverride | null => {
  if (typeof window === "undefined") return null;

  return (
    (window as Window & { __GTUM_PROJECT_RUNTIME__?: RuntimeProjectOverride })
      .__GTUM_PROJECT_RUNTIME__ ?? null
  );
};

export const basenameOfPath = (value: string | null | undefined): string => {
  const parts = String(value || "").replace(/\\/g, "/").split("/").filter(Boolean);

  return parts.at(-1) || "workspace";
};

export const extensionOf = (name: string | null | undefined): string => {
  const ext = String(name || "").split(".").pop();

  return ext && ext !== name ? ext.toLowerCase() : "txt";
};

const requiredNonBlankString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is missing.`);
  }

  return value;
};

const assertSameProjectOwner = (
  expected: string,
  actual: unknown,
  label: string,
): string => {
  const actualOwner = requiredNonBlankString(actual, label);
  if (expected !== actualOwner) {
    throw new Error(`${label} does not match the immutable project owner.`);
  }

  return actualOwner;
};

const assertPatchResponseFiles = (
  requestedFilePaths: readonly string[],
  appliedFiles: RuntimeProjectFileSnapshot[],
): void => {
  if (appliedFiles.length !== requestedFilePaths.length) {
    throw new Error("Runtime patch file result count does not match the requested edits.");
  }

  const expectedFileCounts = new Map<string, number>();
  for (const path of requestedFilePaths) {
    expectedFileCounts.set(path, (expectedFileCounts.get(path) || 0) + 1);
  }

  for (const snapshot of appliedFiles) {
    const path = requiredNonBlankString(snapshot.filePath, "Runtime patch file path");
    const remaining = expectedFileCounts.get(path) || 0;
    if (remaining === 0) {
      throw new Error("Runtime patch file path does not match the requested edits.");
    }

    if (remaining === 1) expectedFileCounts.delete(path);
    else expectedFileCounts.set(path, remaining - 1);
  }

  if (expectedFileCounts.size > 0) {
    throw new Error("Runtime patch file paths do not include every requested edit.");
  }
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
  projectPath = "",
): ProjectFileSnapshot => {
  const displayPath = fallbackName || filePath || "file";
  const title = basenameOfPath(displayPath);

  return {
    projectPath,
    id: "ed-" + String(filePath || displayPath).replace(/[^a-z0-9]+/gi, "-"),
    type: "editor",
    title,
    path: filePath || displayPath,
    displayPath,
    lang: extensionOf(displayPath),
    content: `// ${displayPath}\n// Desktop runtime is not connected. Open a real project folder in the installed app to read file contents.`,
    contentHash: null,
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
    projectPath: requiredNonBlankString(snapshot.projectPath, "Runtime file project owner"),
    id: "ed-" + String(tabPath).replace(/[^a-z0-9]+/gi, "-"),
    type: "editor",
    title: basenameOfPath(displayPath),
    path: tabPath,
    displayPath,
    lang: extensionOf(displayPath),
    content: content + truncatedNote,
    contentHash: snapshot.contentHash || null,
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
  const override = projectOverride();
  const fallbackProject = options.fallbackProject || fallbackRuntimeProject;
  const fallbackFileReader = options.fallbackFileReader || fileSnapshotFromFallback;
  const hasRuntime = options.hasRuntime || override?.hasRuntime || hasTauriRuntime;
  const invokeRuntime = options.invokeRuntime || override?.invokeRuntime || invoke as RuntimeInvoker;

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
        const projectPath = project?.path || "";
        return {
          ...fallbackFileReader(filePath, fallbackName, projectPath),
          projectPath,
        };
      }

      const snapshot = await invokeRuntime<RuntimeProjectFileSnapshot>("read_project_file", {
        projectPath: project.path,
        filePath,
      });

      return fileSnapshotFromRuntime(snapshot, fallbackName);
    },
    async saveProjectFile(project, file): Promise<ProjectFileSnapshot> {
      const fileOwner = requiredNonBlankString(file.projectPath, "File project owner");
      if (!project?.runtimeBacked || !hasRuntime()) {
        throw new Error("Saving files is available in the installed desktop app after opening a real project.");
      }
      const projectOwner = requiredNonBlankString(project.path, "Project owner");
      assertSameProjectOwner(fileOwner, projectOwner, "Selected project owner");

      const snapshot = await invokeRuntime<RuntimeProjectFileSnapshot>("write_project_file", {
        request: {
          projectPath: fileOwner,
          filePath: file.path,
          content: file.content,
          expectedContentHash: file.contentHash || undefined,
        },
      });

      assertSameProjectOwner(fileOwner, snapshot.projectPath, "Runtime save project owner");
      return fileSnapshotFromRuntime(snapshot);
    },
    async applyProjectPatch(project, edits): Promise<ProjectFileSnapshot[]> {
      if (edits.length === 0) {
        throw new Error("Patch must include at least one project-owned file edit.");
      }
      const patchOwner = requiredNonBlankString(edits[0].projectPath, "Patch project owner");
      for (const edit of edits) {
        assertSameProjectOwner(patchOwner, edit.projectPath, "Patch edit project owner");
      }
      if (!project?.runtimeBacked || !hasRuntime()) {
        throw new Error("Applying patches is available in the installed desktop app after opening a real project.");
      }
      const projectOwner = requiredNonBlankString(project.path, "Project owner");
      assertSameProjectOwner(patchOwner, projectOwner, "Selected project owner");
      const patchEdits = edits.map((edit) => ({
        filePath: requiredNonBlankString(edit.path, "Patch edit file path"),
        content: edit.content,
        expectedContentHash: edit.contentHash || undefined,
      }));
      const requestedFilePaths = patchEdits.map((edit) => edit.filePath);

      const result = await invokeRuntime<{ appliedFiles: RuntimeProjectFileSnapshot[] }>(
        "apply_project_patch",
        {
          request: {
            projectPath: patchOwner,
            edits: patchEdits,
          },
        },
      );

      if (!Array.isArray(result?.appliedFiles)) {
        throw new Error("Runtime patch file results are missing.");
      }
      for (const snapshot of result.appliedFiles) {
        assertSameProjectOwner(
          patchOwner,
          snapshot.projectPath,
          "Runtime patch project owner",
        );
      }
      assertPatchResponseFiles(requestedFilePaths, result.appliedFiles);

      return result.appliedFiles.map((snapshot) => fileSnapshotFromRuntime(snapshot));
    },
  };
};

export const projectRuntimeService = createProjectRuntimeService();
