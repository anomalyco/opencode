import z from "zod"
import path from "path"
import { Global } from "../global"
import { Git } from "../git"
import { Identifier } from "../id/id"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { fn } from "../util/fn"
import { Names } from "./names"
import { Session } from "../session"

export namespace Workspace {
  const log = Log.create({ service: "workspace" })

  export const Info = z
    .object({
      id: Identifier.schema("workspace"),
      name: z.string(),
      branch: z.string(),
      repoID: z.string(),
      repoRoot: z.string(),
      worktreePath: z.string(),
      time: z.object({
        created: z.number(),
        accessed: z.number(),
      }),
    })
    .meta({
      ref: "Workspace",
    })
  export type Info = z.output<typeof Info>

  const CreateInput = z.object({
    name: z.string().optional(),
    repoRoot: z.string(),
  })

  /**
   * Create a new workspace with a git worktree
   */
  export const create = fn(CreateInput, async (input) => {
    const repoID = await Git.getRepoID(input.repoRoot)
    if (!repoID) {
      throw new Error("Not a git repository or repository has no commits")
    }

    // Generate name if not provided
    const name = input.name ?? (await Names.generateRandomName())

    // Use name as branch name (sanitized)
    const branch = Names.sanitizeForBranch(name)

    // Create worktree path
    const worktreePath = path.join(Global.Path.workspaces, repoID, branch)

    // Create the worktree
    await Git.createWorktree(input.repoRoot, worktreePath, branch)

    const now = Date.now()
    const workspace: Info = {
      id: Identifier.ascending("workspace"),
      name,
      branch,
      repoID,
      repoRoot: input.repoRoot,
      worktreePath,
      time: {
        created: now,
        accessed: now,
      },
    }

    log.info("created workspace", { workspace })
    await Storage.write(["workspace", repoID, workspace.id], workspace)

    return workspace
  })

  /**
   * Get a workspace by name for a given repo
   */
  export async function get(name: string, repoRoot: string): Promise<Info | null> {
    const repoID = await Git.getRepoID(repoRoot)
    if (!repoID) {
      return null
    }

    const workspaces = await list(repoID)
    return workspaces.find((w) => w.name === name) ?? null
  }

  /**
   * Get a workspace by ID
   */
  export async function getByID(id: string): Promise<Info | null> {
    // We need to scan all repos to find by ID since we don't know the repoID
    const keys = await Storage.list(["workspace"])
    for (const key of keys) {
      try {
        const workspace = await Storage.read<Info>(key)
        if (workspace.id === id) {
          return workspace
        }
      } catch {
        continue
      }
    }
    return null
  }

  /**
   * List all workspaces for a repository
   */
  export async function list(repoID: string): Promise<Info[]> {
    const keys = await Storage.list(["workspace", repoID])
    const workspaces: Info[] = []

    for (const key of keys) {
      try {
        const workspace = await Storage.read<Info>(key)
        workspaces.push(workspace)
      } catch {
        continue
      }
    }

    // Sort by last accessed time (most recent first)
    workspaces.sort((a, b) => b.time.accessed - a.time.accessed)

    return workspaces
  }

  /**
   * List all workspaces across all repositories, grouped by repoID
   */
  export async function listAll(): Promise<Map<string, Info[]>> {
    const result = new Map<string, Info[]>()
    const keys = await Storage.list(["workspace"])

    for (const key of keys) {
      // key format: ["workspace", repoID, workspaceID]
      if (key.length < 3) continue

      try {
        const workspace = await Storage.read<Info>(key)
        const repoID = workspace.repoID

        if (!result.has(repoID)) {
          result.set(repoID, [])
        }
        result.get(repoID)!.push(workspace)
      } catch {
        continue
      }
    }

    // Sort workspaces within each repo by last accessed time (most recent first)
    for (const workspaces of result.values()) {
      workspaces.sort((a, b) => b.time.accessed - a.time.accessed)
    }

    return result
  }

  /**
   * Check if a workspace exists by name
   */
  export async function exists(name: string, repoRoot: string): Promise<boolean> {
    const workspace = await get(name, repoRoot)
    return workspace !== null
  }

  /**
   * Remove a workspace and its associated worktree.
   * Also removes all sessions associated with this workspace (if Instance context is available).
   */
  export const remove = fn(Identifier.schema("workspace"), async (id) => {
    const workspace = await getByID(id)
    if (!workspace) {
      log.warn("workspace not found for removal", { id })
      return
    }

    log.info("removing workspace", { workspace })

    // Remove all sessions associated with this workspace
    // This requires Instance context to look up sessions by project
    try {
      const sessions = await Session.listByWorkspace(id)
      for (const session of sessions) {
        log.info("removing session associated with workspace", { sessionID: session.id, workspaceID: id })
        await Session.remove(session.id)
      }
    } catch (e) {
      // If no Instance context available, we can't look up sessions
      // This is expected when called outside of a project context
      log.info("skipping session cascade delete - no Instance context", { workspaceID: id })
    }

    // Remove from storage first - this ensures cleanup even if git operations fail
    await Storage.remove(["workspace", workspace.repoID, workspace.id])

    // Remove the git worktree and branch (may fail if repo is already gone)
    try {
      await Git.removeWorktree(workspace.repoRoot, workspace.worktreePath)
      await Git.deleteBranch(workspace.repoRoot, workspace.branch)
    } catch (e) {
      // Git operations may fail if the repo no longer exists, that's okay
      log.info("git cleanup failed (repo may be gone)", { workspaceID: id, error: e })
    }
  })

  /**
   * Update the last accessed time for a workspace
   */
  export async function touch(id: string): Promise<void> {
    const workspace = await getByID(id)
    if (!workspace) {
      return
    }

    await Storage.update<Info>(["workspace", workspace.repoID, workspace.id], (draft) => {
      draft.time.accessed = Date.now()
    })
  }

  /**
   * Update a workspace
   */
  export async function update(id: string, editor: (workspace: Info) => void): Promise<Info | null> {
    const workspace = await getByID(id)
    if (!workspace) {
      return null
    }

    const updated = await Storage.update<Info>(["workspace", workspace.repoID, workspace.id], editor)
    return updated
  }
}
