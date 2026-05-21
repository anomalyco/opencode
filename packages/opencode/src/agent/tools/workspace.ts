import { Tool } from "../types";
import { getWorkspace, listWorkspaces, createWorkspace, addProjectToWorkspace, removeProjectFromWorkspace, getLinkedContext } from "../workspace/manager";

export const linkProjectsTool: Tool = {
  name: "link_projects",
  description: "Link multiple projects together in a workspace so the agent can work on them simultaneously with shared context. Use this when tasks span across multiple related codebases.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "add", "remove", "list", "get_context"],
        description: "Action to perform"
      },
      workspaceName: {
        type: "string",
        description: "Name for the workspace (required for 'create' action)"
      },
      projectPaths: {
        type: "array",
        items: { type: "string" },
        description: "Array of project paths to link (required for 'create' and 'add' actions)"
      },
      workspaceId: {
        type: "string",
        description: "Workspace ID (required for 'add', 'remove', 'get_context' actions)"
      },
      projectId: {
        type: "string",
        description: "Project ID to remove (required for 'remove' action)"
      }
    },
    required: ["action"]
  },
  execute: async (params: any) => {
    const { action, workspaceName, projectPaths, workspaceId, projectId } = params;

    try {
      switch (action) {
        case "create":
          if (!workspaceName || !projectPaths || projectPaths.length === 0) {
            return { success: false, error: "workspaceName and projectPaths are required for creating a workspace" };
          }
          const newWorkspace = await createWorkspace(workspaceName, projectPaths);
          return {
            success: true,
            message: `Created workspace "${workspaceName}" with ${projectPaths.length} linked projects`,
            workspace: newWorkspace
          };

        case "add":
          if (!workspaceId || !projectPaths || projectPaths.length === 0) {
            return { success: false, error: "workspaceId and projectPaths are required for adding projects" };
          }
          const updatedWorkspace = await addProjectToWorkspace(workspaceId, projectPaths[0]);
          return {
            success: true,
            message: `Added project to workspace "${updatedWorkspace.name}"`,
            workspace: updatedWorkspace
          };

        case "remove":
          if (!workspaceId || !projectId) {
            return { success: false, error: "workspaceId and projectId are required for removing a project" };
          }
          const removedWorkspace = await removeProjectFromWorkspace(workspaceId, projectId);
          return {
            success: true,
            message: `Removed project from workspace "${removedWorkspace.name}"`,
            workspace: removedWorkspace
          };

        case "list":
          const workspaces = await listWorkspaces();
          return {
            success: true,
            workspaces: workspaces.map(ws => ({
              id: ws.id,
              name: ws.name,
              projectCount: ws.projects.length,
              projects: ws.projects.map(p => ({ name: p.name, path: p.path }))
            }))
          };

        case "get_context":
          if (!workspaceId) {
            return { success: false, error: "workspaceId is required" };
          }
          const workspace = await getWorkspace(workspaceId);
          if (!workspace) {
            return { success: false, error: "Workspace not found" };
          }
          const context = await getLinkedContext(workspace);
          return {
            success: true,
            context,
            workspace: {
              id: workspace.id,
              name: workspace.name,
              projects: workspace.projects
            }
          };

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};

export const getWorkspaceContextTool: Tool = {
  name: "get_workspace_context",
  description: "Get the combined context of all linked projects in a workspace. This helps understand relationships between projects.",
  inputSchema: {
    type: "object",
    properties: {
      workspaceId: {
        type: "string",
        description: "ID of the workspace to get context for"
      }
    },
    required: ["workspaceId"]
  },
  execute: async (params: any) => {
    const { workspaceId } = params;
    
    try {
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        return { success: false, error: "Workspace not found" };
      }
      
      const context = await getLinkedContext(workspace);
      return {
        success: true,
        context,
        projects: workspace.projects
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
};
