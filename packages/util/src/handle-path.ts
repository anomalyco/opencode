import { readlink } from "node:fs/promises"
import { verificationUnavailable } from "./file-verification.js"

export async function handlePath(fd: number) {
  if (process.platform === "linux") return readlink(`/proc/self/fd/${fd}`).catch(verificationUnavailable)
  if (process.platform !== "darwin" && process.platform !== "win32") return verificationUnavailable()
  native ??= handleResolver()
  return native.then((resolve) => resolve(fd)).catch(verificationUnavailable)
}

let native: ReturnType<typeof handleResolver> | undefined

async function handleResolver() {
  const ffi = await import("ffi-rs")
  const t = ffi.DataType
  if (process.platform === "win32") {
    ffi.open({ library: "oc-preview-uv", path: process.execPath })
    ffi.open({
      library: "oc-preview-win",
      // Already loaded by Windows as a KnownDLL. Do not turn an environment variable into a native library path.
      path: "kernel32.dll",
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
