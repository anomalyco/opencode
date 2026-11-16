import { constants } from "node:fs"
import { open, readlink, realpath, stat } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"

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

async function handlePath(fd: number) {
  if (process.platform === "linux") return readlink(`/proc/self/fd/${fd}`)
  if (process.platform !== "darwin" && process.platform !== "win32") return
  native ??= handleResolver()
  return (await native)(fd)
}

let native: ReturnType<typeof handleResolver> | undefined

async function handleResolver() {
  const ffi = await import("ffi-rs")
  const t = ffi.DataType
  if (process.platform === "win32") {
    ffi.open({ library: "oc-preview-uv", path: process.execPath })
    ffi.open({
      library: "oc-preview-win",
      path: join(process.env.SystemRoot ?? "C:\\Windows", "System32", "kernel32.dll"),
    })
    return (fd: number) => {
      // Bun and Electron own different CRT descriptor tables. Ask the runtime's own libuv for its borrowed HANDLE.
      const handle = ffi.load({
        library: "oc-preview-uv",
        funcName: "uv_get_osfhandle",
        retType: t.I64,
        paramsType: [t.I32],
        paramsValue: [fd],
      })
      const buffer = Buffer.alloc(65536)
      const length = ffi.load({
        library: "oc-preview-win",
        funcName: "GetFinalPathNameByHandleW",
        retType: t.U32,
        paramsType: [t.I64, t.U8Array, t.U32, t.U32],
        paramsValue: [handle, buffer, buffer.length / 2, 0],
      })
      if (!length || length >= buffer.length / 2) return
      const path = buffer.toString("utf16le", 0, length * 2)
      if (path.startsWith("\\\\?\\UNC\\")) return `\\\\${path.slice(8)}`
      if (/^\\\\\?\\[a-z]:\\/i.test(path)) return path.slice(4)
    }
  }
  // Darwin's fixed-signature fgetattrlist works on both Intel and arm64 (fcntl is variadic).
  ffi.open({ library: "oc-preview-mac", path: "/usr/lib/libSystem.B.dylib" })
  return (fd: number) => {
    const attrs = Buffer.alloc(24)
    attrs.writeUInt16LE(5) // ATTR_BIT_MAP_COUNT, followed by reserved and five attribute groups
    attrs.writeUInt32LE(0x08000000, 4) // ATTR_CMN_FULLPATH
    const buffer = Buffer.alloc(8192)
    const rc = ffi.load({
      library: "oc-preview-mac",
      funcName: "fgetattrlist",
      retType: t.I32,
      paramsType: [t.I32, t.U8Array, t.U8Array, t.U64, t.U64],
      paramsValue: [fd, attrs, buffer, buffer.length, 0],
    })
    if (rc !== 0) return
    const size = buffer.readUInt32LE(0)
    const start = 4 + buffer.readInt32LE(4) // attrreference_t offsets are relative to the reference itself
    const end = start + buffer.readUInt32LE(8)
    if (start < 12 || end <= start || end > size || size > buffer.length || buffer[end - 1] !== 0) return
    return buffer.toString("utf8", start, end - 1)
  }
}
