import { constants, type Dirent } from "node:fs"
import { open, readdir, realpath, type FileHandle } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

/** Opens a regular file below a trusted physical root without following child symlinks. */
export async function openWorkspaceFile(root: string, relative: string): Promise<FileHandle> {
  childSegments(relative)
  const entry = await openWorkspaceEntry(root, relative)
  if (entry.type === "file") return entry.file
  await entry.directory.close()
  throw new Error("Workspace path is not a regular file")
}

/** Opens either supported entry kind without a separate pathname lookup. */
export async function openWorkspaceEntry(root: string, relative: string) {
  if (!relative) return { type: "directory" as const, directory: await openWorkspaceDirectory(root, relative) }
  const segments = childSegments(relative)
  const expected = join(root, ...segments)

  const parent = await openDirectory(root, segments.slice(0, -1))
  try {
    await requireIdentity(parent, join(root, ...segments.slice(0, -1)))
    const file = await open(
      `/proc/self/fd/${parent.fd}/${segments[segments.length - 1]}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY,
    )
    try {
      const kind = await file.stat()
      await requireIdentity(file, expected)
      if (kind.isFile()) return { type: "file" as const, file }
      if (kind.isDirectory()) return { type: "directory" as const, directory: directoryLease(file, expected) }
      throw new Error("Workspace path is not a regular file or directory")
    } catch (error) {
      await file.close()
      throw error
    }
  } finally {
    await parent.close()
  }
}

/** A directory descriptor retained for enumeration and a child-process anchor. */
export async function openWorkspaceDirectory(root: string, relative: string) {
  const segments = childSegments(relative, true)
  const directory = await openDirectory(root, segments)
  return directoryLease(directory, join(root, ...segments))
}

function directoryLease(directory: FileHandle, expected: string) {
  let closed = false
  const pending = new Set<Promise<Dirent[]>>()

  return {
    /** Valid until close(); callers must constrain child traversal separately and await child exit first. */
    childPath: `/proc/${process.pid}/fd/${directory.fd}`,
    async readEntries(): Promise<Dirent[]> {
      if (closed) throw new Error("Workspace directory is closed")
      const read = (async () => {
        await requireIdentity(directory, expected)
        return readdir(`/proc/self/fd/${directory.fd}`, { withFileTypes: true })
      })()
      pending.add(read)
      try {
        return await read
      } finally {
        pending.delete(read)
      }
    },
    async close() {
      if (closed) return
      closed = true
      await Promise.allSettled([...pending])
      await directory.close()
    },
  }
}

function childSegments(relative: string, allowRoot = false) {
  if (allowRoot && relative === "") return []
  const segments = relative.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error("Workspace path must contain only relative child segments")
  }
  return segments
}

async function openDirectory(root: string, segments: string[]) {
  if (process.platform !== "linux") throw new Error("Guarded workspace reads require Linux")
  if (!isAbsolute(root) || (await realpath(root)) !== root) throw new Error("Workspace root must be canonical")

  let parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    await requireIdentity(parent, root)
    for (const [index, segment] of segments.entries()) {
      await requireIdentity(parent, join(root, ...segments.slice(0, index)))
      const next = await open(
        `/proc/self/fd/${parent.fd}/${segment}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      try {
        await requireIdentity(next, join(root, ...segments.slice(0, index + 1)))
      } catch (error) {
        await next.close()
        throw error
      }
      await parent.close()
      parent = next
    }
    return parent
  } catch (error) {
    await parent.close()
    throw error
  }
}

async function requireIdentity(handle: FileHandle, expected: string) {
  if ((await realpath(`/proc/self/fd/${handle.fd}`)) !== expected) throw new Error("Workspace path changed during open")
}
