import { mkdir, writeFile, readFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

export interface LinkedProject {
  id: string;
  name: string;
  path: string;
  description?: string;
}

export interface Workspace {
  id: string;
  name: string;
  projects: LinkedProject[];
  createdAt: number;
}

const WORKSPACES_DIR = join(process.cwd(), ".opencode", "workspaces");

export async function initWorkspaceSystem() {
  if (!existsSync(WORKSPACES_DIR)) {
    await mkdir(WORKSPACES_DIR, { recursive: true });
  }
}

export async function createWorkspace(name: string, projectPaths: string[]): Promise<Workspace> {
  await initWorkspaceSystem();
  
  const id = `ws_${Date.now()}`;
  const projects: LinkedProject[] = projectPaths.map((path, index) => ({
    id: `proj_${index}_${Date.now()}`,
    name: path.split(/[\\/]/).pop() || `Project ${index + 1}`,
    path,
    description: undefined
  }));

  const workspace: Workspace = {
    id,
    name,
    projects,
    createdAt: Date.now()
  };

  const filePath = join(WORKSPACES_DIR, `${id}.json`);
  await writeFile(filePath, JSON.stringify(workspace, null, 2), "utf-8");

  // Create learnings directory for each project in workspace
  for (const project of projects) {
    const learningsDir = join(project.path, ".opencode", "agents");
    if (!existsSync(learningsDir)) {
      await mkdir(learningsDir, { recursive: true });
    }
  }

  return workspace;
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const filePath = join(WORKSPACES_DIR, `${id}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  
  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content) as Workspace;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  await initWorkspaceSystem();
  
  const files = await readdir(WORKSPACES_DIR);
  const workspaces: Workspace[] = [];

  for (const file of files) {
    if (file.endsWith(".json")) {
      const filePath = join(WORKSPACES_DIR, file);
      const content = await readFile(filePath, "utf-8");
      workspaces.push(JSON.parse(content) as Workspace);
    }
  }

  return workspaces;
}

export async function updateWorkspace(workspace: Workspace): Promise<void> {
  const filePath = join(WORKSPACES_DIR, `${workspace.id}.json`);
  await writeFile(filePath, JSON.stringify(workspace, null, 2), "utf-8");
}

export async function deleteWorkspace(id: string): Promise<void> {
  const filePath = join(WORKSPACES_DIR, `${id}.json`);
  if (existsSync(filePath)) {
    const fs = await import("fs/promises");
    await fs.unlink(filePath);
  }
}

export async function addProjectToWorkspace(workspaceId: string, projectPath: string): Promise<Workspace> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  const newProject: LinkedProject = {
    id: `proj_${Date.now()}`,
    name: projectPath.split(/[\\/]/).pop() || `Project ${workspace.projects.length + 1}`,
    path: projectPath,
    description: undefined
  };

  workspace.projects.push(newProject);
  await updateWorkspace(workspace);

  // Create learnings directory for new project
  const learningsDir = join(projectPath, ".opencode", "agents");
  if (!existsSync(learningsDir)) {
    await mkdir(learningsDir, { recursive: true });
  }

  return workspace;
}

export async function removeProjectFromWorkspace(workspaceId: string, projectId: string): Promise<Workspace> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  workspace.projects = workspace.projects.filter(p => p.id !== projectId);
  await updateWorkspace(workspace);

  return workspace;
}

export async function getLinkedContext(workspace: Workspace): Promise<string> {
  let context = `Working on workspace: ${workspace.name}\n\n`;
  context += `Linked Projects:\n`;
  
  for (const project of workspace.projects) {
    context += `- ${project.name}: ${project.path}\n`;
    if (project.description) {
      context += `  Description: ${project.description}\n`;
    }
  }
  
  context += `\nAll projects in this workspace are related. Consider cross-project impacts when making changes.\n`;
  
  return context;
}
