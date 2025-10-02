import { Workspace } from "."
import { Permission } from "../permission"
import { Filesystem } from "../util/filesystem"
import path from "path"

export namespace PathValidation {
  /**
   * Validate a path and request permission if needed
   * Returns true if path is allowed, throws if denied
   */
  export async function validate(
    filepath: string,
    ctx: {
      sessionID: string
      messageID: string
      callID?: string
      bypass?: boolean
    },
  ): Promise<void> {
    // Bypass check if explicitly allowed (e.g., for file attachments)
    if (ctx.bypass) return

    // Resolve to absolute path
    const resolved = path.isAbsolute(filepath) ? filepath : path.resolve(filepath)

    // Check if path is in workspace
    if (await Workspace.contains(resolved)) return

    // Path is outside workspace - request permission
    await Permission.ask({
      type: "path-access",
      pattern: resolved,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      title: `Access ${resolved}?`,
      metadata: {
        filepath: resolved,
      },
    })
  }

  /**
   * Get the first allowed directory that contains this path, or undefined
   */
  export async function getAllowedParent(filepath: string): Promise<string | undefined> {
    const resolved = path.isAbsolute(filepath) ? filepath : path.resolve(filepath)
    const allowed = await Workspace.getAllowedDirectories()
    return allowed.find((dir) => Filesystem.contains(dir, resolved))
  }
}
