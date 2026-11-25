import { constants } from "node:fs"
import { open, realpath, type FileHandle } from "node:fs/promises"
import { isAbsolute } from "node:path"

/** Opens a regular file below a trusted physical root without following child symlinks. */
export async function openWorkspaceFile(root: string, relative: string): Promise<FileHandle> {
  if (process.platform !== "linux") throw new Error("Guarded workspace reads require Linux")
  if (!isAbsolute(root) || (await realpath(root)) !== root) throw new Error("Workspace root must be canonical")

  const segments = relative.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error("Workspace file path must contain only relative child segments")
  }

  let parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    // The proc fd path keeps every lookup relative to the already opened parent directory.
    if ((await realpath(`/proc/self/fd/${parent.fd}`)) !== root) throw new Error("Workspace root changed during open")

    for (const segment of segments.slice(0, -1)) {
      const next = await open(
        `/proc/self/fd/${parent.fd}/${segment}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      const previous = parent
      parent = next
      await previous.close()
    }

    const file = await open(
      `/proc/self/fd/${parent.fd}/${segments[segments.length - 1]}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY,
    )
    try {
      if (!(await file.stat()).isFile()) throw new Error("Workspace path is not a regular file")
      if ((await realpath(`/proc/self/fd/${file.fd}`)) !== `${root}/${relative}`)
        throw new Error("Workspace file changed during open")
      return file
    } catch (error) {
      await file.close()
      throw error
    }
  } finally {
    await parent.close()
  }
}
