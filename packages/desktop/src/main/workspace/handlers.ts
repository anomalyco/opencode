import { ipcMain } from "electron";
import { app } from "electron";
import { join } from "path";
import { mkdir, writeFile, readFile, readdir, unlink } from "fs/promises";
import { existsSync } from "fs";

const WORKSPACES_DIR = join(app.getPath("userData"), "workspaces");

interface LinkedProject {
  id: string;
  name: string;
  path: string;
  description?: string;
}

interface Workspace {
  id: string;
  name: string;
  projects: LinkedProject[];
  createdAt: number;
}

async function initWorkspaceSystem() {
  if (!existsSync(WORKSPACES_DIR)) {
    await mkdir(WORKSPACES_DIR, { recursive: true });
  }
}

export function registerWorkspaceIpcHandlers() {
  // Create a new workspace with multiple projects
  ipcMain.handle("workspace:create", async (event, name: string, projectPaths: string[]) => {
    try {
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

      // Create learnings directory for each project
      for (const project of projects) {
        const learningsDir = join(project.path, ".opencode", "agents");
        if (!existsSync(learningsDir)) {
          await mkdir(learningsDir, { recursive: true });
        }
      }

      return { success: true, workspace };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Get a specific workspace
  ipcMain.handle("workspace:get", async (event, id: string) => {
    try {
      const filePath = join(WORKSPACES_DIR, `${id}.json`);
      if (!existsSync(filePath)) {
        return { success: false, error: "Workspace not found" };
      }
      
      const content = await readFile(filePath, "utf-8");
      const workspace = JSON.parse(content) as Workspace;
      return { success: true, workspace };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // List all workspaces
  ipcMain.handle("workspace:list", async () => {
    try {
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

      return { 
        success: true, 
        workspaces: workspaces.map(ws => ({
          id: ws.id,
          name: ws.name,
          projectCount: ws.projects.length,
          projects: ws.projects.map(p => ({ name: p.name, path: p.path }))
        }))
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Update workspace
  ipcMain.handle("workspace:update", async (event, workspace: Workspace) => {
    try {
      const filePath = join(WORKSPACES_DIR, `${workspace.id}.json`);
      await writeFile(filePath, JSON.stringify(workspace, null, 2), "utf-8");
      return { success: true, workspace };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Delete workspace
  ipcMain.handle("workspace:delete", async (event, id: string) => {
    try {
      const filePath = join(WORKSPACES_DIR, `${id}.json`);
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Add project to workspace
  ipcMain.handle("workspace:addProject", async (event, workspaceId: string, projectPath: string) => {
    try {
      const filePath = join(WORKSPACES_DIR, `${workspaceId}.json`);
      if (!existsSync(filePath)) {
        return { success: false, error: "Workspace not found" };
      }
      
      const content = await readFile(filePath, "utf-8");
      const workspace = JSON.parse(content) as Workspace;

      const newProject: LinkedProject = {
        id: `proj_${Date.now()}`,
        name: projectPath.split(/[\\/]/).pop() || `Project ${workspace.projects.length + 1}`,
        path: projectPath,
        description: undefined
      };

      workspace.projects.push(newProject);
      await writeFile(filePath, JSON.stringify(workspace, null, 2), "utf-8");

      // Create learnings directory for new project
      const learningsDir = join(projectPath, ".opencode", "agents");
      if (!existsSync(learningsDir)) {
        await mkdir(learningsDir, { recursive: true });
      }

      return { success: true, workspace };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Remove project from workspace
  ipcMain.handle("workspace:removeProject", async (event, workspaceId: string, projectId: string) => {
    try {
      const filePath = join(WORKSPACES_DIR, `${workspaceId}.json`);
      if (!existsSync(filePath)) {
        return { success: false, error: "Workspace not found" };
      }
      
      const content = await readFile(filePath, "utf-8");
      const workspace = JSON.parse(content) as Workspace;

      workspace.projects = workspace.projects.filter(p => p.id !== projectId);
      await writeFile(filePath, JSON.stringify(workspace, null, 2), "utf-8");

      return { success: true, workspace };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Get workspace context
  ipcMain.handle("workspace:getContext", async (event, workspaceId: string) => {
    try {
      const filePath = join(WORKSPACES_DIR, `${workspaceId}.json`);
      if (!existsSync(filePath)) {
        return { success: false, error: "Workspace not found" };
      }
      
      const content = await readFile(filePath, "utf-8");
      const workspace = JSON.parse(content) as Workspace;

      let context = `Working on workspace: ${workspace.name}\n\n`;
      context += `Linked Projects:\n`;
      
      for (const project of workspace.projects) {
        context += `- ${project.name}: ${project.path}\n`;
        if (project.description) {
          context += `  Description: ${project.description}\n`;
        }
      }
      
      context += `\nAll projects in this workspace are related. Consider cross-project impacts when making changes.\n`;
      
      return { 
        success: true, 
        context,
        workspace: {
          id: workspace.id,
          name: workspace.name,
          projects: workspace.projects
        }
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}
