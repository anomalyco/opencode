import { constants } from "node:fs"
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { openWorkspaceDirectory, openWorkspaceFile } from "./guarded-read.js"

const segments = (relative: string) => {
  const parts = relative.split("/")
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\0")))
    throw new Error("Invalid workspace mutation path")
  if (parts.includes(".git")) throw new Error("Workspace Git metadata cannot be mutated")
  return parts
}

export async function readWorkspaceBytes(root: string, relative: string) {
  const file = await openWorkspaceFile(root, relative)
  try {
    if ((await file.stat()).size > 64 * 1024 * 1024) throw new Error("Workspace file exceeds 64 MiB read limit")
    return await file.readFile()
  } finally {
    await file.close()
  }
}

/** Publish bytes via an anchored parent descriptor. Existing inodes are never modified in place. */
export async function replaceWorkspaceFile(
  root: string,
  relative: string,
  bytes: Uint8Array,
  verify: () => Promise<void>,
) {
  const parts = segments(relative)
  await verify()
  for (let index = 0; index < parts.length - 1; index++) {
    const parent = await openWorkspaceDirectory(root, parts.slice(0, index).join("/"))
    try {
      await verify()
      await mkdir(path.join(parent.childPath, parts[index])).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error
      })
    } finally {
      await parent.close()
    }
    const directory = await openWorkspaceDirectory(root, parts.slice(0, index + 1).join("/"))
    await directory.close()
  }
  const parentRelative = parts.slice(0, -1).join("/")
  const parent = await openWorkspaceDirectory(root, parentRelative)
  const destination = path.join(parent.childPath, parts.at(-1)!)
  const temporary = path.join(parent.childPath, `.opencode-${randomUUID()}.tmp`)
  try {
    const before = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (before && (!before.isFile() || before.nlink !== 1))
      throw new Error("Workspace target is not a single-link regular file")
    await verify()
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await file.writeFile(bytes)
      if (before) {
        if (before.uid !== process.getuid?.() || before.gid !== process.getgid?.())
          throw new Error("Workspace target owner differs from current process")
        await file.chmod(before.mode & 0o777)
      } else {
        await file.chmod(0o666 & ~process.umask())
      }
      await file.sync()
    } finally {
      await file.close()
    }
    await verify()
    if ((await realpath(parent.childPath)) !== path.join(root, parentRelative))
      throw new Error("Workspace parent changed before publication")
    const current = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (before?.dev !== current?.dev || before?.ino !== current?.ino)
      throw new Error("Workspace target changed before publication")
    await rename(temporary, destination)
    return { existed: before !== undefined }
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
    await parent.close()
  }
}
