import path from "path"
import fs from "fs"

export async function createWorkspace(
  root: string,
  agentId: string,
  manifest?: Record<string, unknown>,
): Promise<string> {
  const ws = path.join(root, ".opencode", "workspaces", `workspace-${agentId}`)
  const scratch = path.join(ws, "scratch")
  await fs.promises.mkdir(scratch, { recursive: true })
  const manifestData = manifest ?? { agent_id: agentId, created_at: Date.now() }
  await fs.promises.writeFile(path.join(ws, "manifest.json"), JSON.stringify(manifestData, null, 2))
  return ws
}

export async function removeWorkspace(root: string, agentId: string): Promise<void> {
  const ws = path.join(root, ".opencode", "workspaces", `workspace-${agentId}`)
  await fs.promises.rm(ws, { recursive: true, force: true })
}

export async function createWorktree(
  projectRoot: string,
  workspace: string,
  agentId: string,
  name: string,
): Promise<string> {
  const wtDir = path.join(workspace, ".worktrees", name)
  await fs.promises.mkdir(path.dirname(wtDir), { recursive: true })
  const branch = `team/${agentId}/${name}`
  return wtDir
}

export async function removeWorktree(workspace: string, name: string): Promise<void> {
  const wtDir = path.join(workspace, ".worktrees", name)
  await fs.promises.rm(wtDir, { recursive: true, force: true })
}

export function resolveWorkspaceURI(uri: string, agentId: string, projectRoot: string): string {
  if (uri.startsWith("workspace://")) {
    const rest = uri.slice("workspace://".length)
    const firstSlash = rest.indexOf("/")
    const targetAgent = firstSlash >= 0 ? rest.slice(0, firstSlash) : rest
    const filePath = firstSlash >= 0 ? rest.slice(firstSlash + 1) : ""
    return path.join(projectRoot, ".opencode", "workspaces", `workspace-${targetAgent}`, filePath)
  }
  if (uri.startsWith("team://")) {
    return path.join(projectRoot, uri.slice("team://".length))
  }
  if (uri.startsWith("shared://")) {
    return path.join(projectRoot, ".opencode", "team", "shared", uri.slice("shared://".length))
  }
  if (uri.startsWith("worktree://")) {
    const rest = uri.slice("worktree://".length)
    const parts = rest.split("/")
    const targetAgent = parts[0]
    const wtName = parts[1]
    const filePath = parts.slice(2).join("/")
    return path.join(projectRoot, ".opencode", "workspaces", `workspace-${targetAgent}`, ".worktrees", wtName, filePath)
  }
  throw new Error(`Unknown URI scheme: ${uri}`)
}

export function isOwnWorkspace(filePath: string, agentId: string): boolean {
  return filePath.includes(`workspace-${agentId}`)
}

export function isOwnWorktree(filePath: string, agentId: string): boolean {
  return filePath.includes(`workspace-${agentId}`) && filePath.includes(".worktrees")
}

export function isOtherAgentWorkspace(filePath: string, agentId: string): boolean {
  const match = filePath.match(/workspace-([a-zA-Z0-9_-]+)/)
  if (!match) return false
  return match[1] !== agentId
}

export function isTeamWorkspace(filePath: string, projectRoot: string): boolean {
  return filePath.startsWith(projectRoot) && !filePath.includes(".opencode/workspaces")
}

export function isProtectedPath(filePath: string, protectedPaths: string[]): boolean {
  return protectedPaths.some((p) => filePath.includes(p))
}

export async function calculateDiskUsage(dir: string): Promise<number> {
  let total = 0
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        total += await calculateDiskUsage(fullPath)
      } else {
        const stat = await fs.promises.stat(fullPath)
        total += stat.size
      }
    }
  } catch {}
  return total
}
