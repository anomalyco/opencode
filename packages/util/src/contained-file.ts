import { constants } from "node:fs"
import { open, realpath, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"
import { handlePath } from "#handle-path"

/** `root` is the authorized physical directory. Only the kernel's name for the open object authorizes a read;
 * preflight checks keep an ordinary request from opening a device or pipe but cannot establish containment. */
export async function openContained(root: string, path: string) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) return
  if (
    process.platform === "win32" &&
    path
      .split(/[\\/]/)
      .some((part) => /:|[. ]$|^(?:con(?:in\$|out\$)?|nul|prn|aux|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
  )
    return
  const target = await realpath(join(root, path))
  if (!inside(root, target) || !(await stat(target)).isFile()) return
  const file = await open(target, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await file.stat({ bigint: true })
    if (info.isFile() && info.size <= BigInt(Number.MAX_SAFE_INTEGER)) {
      const name = await handlePath(file.fd)
      if (name && inside(root, name)) return { file, path: name, size: Number(info.size) }
    }
  } catch (error) {
    await file.close()
    throw error
  }
  await file.close()
}

function inside(root: string, name: string) {
  // Physical names compare case-exactly even on Windows (NTFS directories may be case sensitive).
  return isAbsolute(name) && pathToFileURL(name).href.startsWith(`${pathToFileURL(root).href.replace(/\/$/, "")}/`)
}
