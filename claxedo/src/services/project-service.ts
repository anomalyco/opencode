import { getConvex } from "../clients/index.ts";
import { api } from "../../convex/_generated/api.js";
import { memoizePromise } from "../server/lib/memoize.ts";
import { normalizeDirectory } from "../server/lib/paths.ts";

export interface ProjectMetadata {
  id: string;
  name: string;
  repoUrl?: string;
  branch?: string;
  createdAt: number;
  updatedAt: number;
  workspaces: any[];
}

// Internal function to fetch project by directory
async function _getProjectByDirectory(directory: string): Promise<ProjectMetadata | null> {
  const convex = getConvex();
  
  // 1. Map Directory -> Workspace
  const workspace = await convex.query(api.workspaces.getByDirectory, { directory });
  if (!workspace) return null;

  const projectId = String((workspace as any).projectId || "");
  if (!projectId) return null;

  // 2. Map Workspace -> Project
  const project = await convex.query(api.projects.getById, { id: projectId as any });
  if (!project) return null;

  // 3. List All Workspaces for Project (for "sandboxes" list)
  // We can use the new optimized aggregation query if available, or just listByProject
  // Since we only need one project, listByProject is fine, but we should cache it.
  const workspaces = await convex
    .query(api.workspaces.listByProject, { projectId: projectId as any })
    .catch(() => []);

  return {
    id: (project as any).externalId || String((project as any)._id),
    name: (project as any).name || "Project",
    repoUrl: (project as any).repoUrl,
    branch: (project as any).branch,
    createdAt: (project as any).createdAt,
    updatedAt: (project as any).updatedAt,
    workspaces: workspaces || [],
  };
}

/**
 * Cached lookup for project metadata from a directory.
 * Solves the 2.7s latency on /project/current
 */
export const getProjectByDirectory = memoizePromise(
  _getProjectByDirectory,
  5 * 1000, // 5s TTL
  15 * 60 * 1000 // 15m SWR
);
