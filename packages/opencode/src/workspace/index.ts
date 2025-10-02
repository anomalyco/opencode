import z from "zod/v4"
import { Instance } from "../project/instance"
import { Storage } from "../storage/storage"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import path from "path"

export namespace Workspace {
  const log = Log.create({ service: "workspace" })

  export const Info = z
    .object({
      directories: z.array(z.string()).describe("List of allowed directories in the workspace"),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "Workspace",
    })
  export type Info = z.infer<typeof Info>

  /**
   * Get all allowed directories for the current project
   * Always includes Instance.directory and Instance.worktree
   * Also loads directories from opencode.json workspace config
   */
  export async function getAllowedDirectories(): Promise<string[]> {
    const workspace = await Storage.read<Info>(["workspace", Instance.project.id]).catch(() => null)
    const directories = new Set<string>()

    // Always allow Instance.directory and Instance.worktree
    directories.add(Instance.directory)
    if (Instance.worktree !== Instance.directory) {
      directories.add(Instance.worktree)
    }

    // Add directories from opencode.json config
    const { Config } = await import("../config/config")
    const config = await Config.get()
    if (config.workspace?.directories) {
      for (const dir of config.workspace.directories) {
        const resolved = path.isAbsolute(dir) ? dir : path.resolve(Instance.worktree, dir)
        directories.add(resolved)
      }
    }

    // Add configured workspace directories from storage
    if (workspace?.directories) {
      for (const dir of workspace.directories) {
        const resolved = path.isAbsolute(dir) ? dir : path.resolve(Instance.worktree, dir)
        directories.add(resolved)
      }
    }

    return Array.from(directories)
  }

  /**
   * Add a directory to the workspace allowlist
   */
  export async function addDirectory(directory: string) {
    const resolved = path.resolve(directory)
    log.info("adding directory to workspace", { directory: resolved, projectID: Instance.project.id })

    const existing = await Storage.read<Info>(["workspace", Instance.project.id]).catch(() => null)
    const directories = new Set(existing?.directories || [])
    directories.add(resolved)

    const workspace: Info = {
      directories: Array.from(directories),
      time: {
        created: existing?.time.created ?? Date.now(),
        updated: Date.now(),
      },
    }

    await Storage.write<Info>(["workspace", Instance.project.id], workspace)
    return workspace
  }

  /**
   * Remove a directory from the workspace allowlist
   */
  export async function removeDirectory(directory: string) {
    const resolved = path.resolve(directory)
    log.info("removing directory from workspace", { directory: resolved, projectID: Instance.project.id })

    const existing = await Storage.read<Info>(["workspace", Instance.project.id]).catch(() => null)
    if (!existing) return

    const directories = existing.directories.filter((d) => d !== resolved)

    if (directories.length === 0) {
      const workspace: Info = {
        directories: [],
        time: {
          created: existing.time.created,
          updated: Date.now(),
        },
      }
      await Storage.write<Info>(["workspace", Instance.project.id], workspace)
      return workspace
    }

    const workspace: Info = {
      directories,
      time: {
        created: existing.time.created,
        updated: Date.now(),
      },
    }

    await Storage.write<Info>(["workspace", Instance.project.id], workspace)
    return workspace
  }

  /**
   * List all directories in the workspace
   */
  export async function list() {
    const workspace = await Storage.read<Info>(["workspace", Instance.project.id]).catch(() => null)
    return workspace?.directories || []
  }

  /**
   * Check if a path is within any allowed directory
   */
  export async function contains(filepath: string): Promise<boolean> {
    const allowed = await getAllowedDirectories()
    return allowed.some((dir) => Filesystem.contains(dir, filepath))
  }

  /**
   * Clear all workspace directories (reset to defaults)
   */
  export async function clear() {
    log.info("clearing workspace", { projectID: Instance.project.id })
    const workspace: Info = {
      directories: [],
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }
    await Storage.write<Info>(["workspace", Instance.project.id], workspace)
  }
}
