import { readlink } from "node:fs/promises"
import { FileVerificationError } from "../file-verification"

export type HandlePath = ReturnType<typeof createHandlePath>

/**
 * Names an open file descriptor by the kernel's path for it. One per main instance of the browser plugin: `close`
 * releases the native libraries it opened, in `ctx.onCleanup`, and a reload creates a fresh one. The libraries are
 * registered under names of this instance alone, so a closing instance never closes the next one's.
 */
export function createHandlePath() {
  const id = crypto.randomUUID()
  const libraries: string[] = []
  let native: ReturnType<typeof handleResolver> | undefined
  let reported = false
  let closed = false

  /** Log once per instance at the origin; a page may request hundreds of resources from the same unavailable verifier. */
  const unavailable = (cause?: unknown): never => {
    if (!reported) {
      reported = true
      console.warn(FileVerificationError.code, cause instanceof Error ? cause.message : FileVerificationError.description)
    }

    throw new FileVerificationError()
  }

  async function handleResolver() {
    const ffi = await import("ffi-rs")
    const t = ffi.DataType

    const open = (name: string, path: string) => {
      const library = `${name}-${id}`
      ffi.open({ library, path })
      libraries.push(library)

      return library
    }

    if (process.platform === "win32") {
      const uv = open("oc-preview-uv", process.execPath)
      // Already loaded by Windows as a KnownDLL. Do not turn an environment variable into a native library path.
      const win = open("oc-preview-win", "kernel32.dll")

      return (fd: number) => {
        // Bun and Electron own different CRT descriptor tables. Ask the runtime's own libuv for its borrowed HANDLE.
        const handle = ffi.load({
          library: uv,
          funcName: "uv_get_osfhandle",
          retType: t.I64,
          paramsType: [t.I32],
          paramsValue: [fd],
        })

        const buffer = Buffer.alloc(65536)

        const length = ffi.load({
          library: win,
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
    const mac = open("oc-preview-mac", "/usr/lib/libSystem.B.dylib")

    return (fd: number) => {
      const attrs = Buffer.alloc(24)
      attrs.writeUInt16LE(5) // ATTR_BIT_MAP_COUNT, followed by reserved and five attribute groups
      attrs.writeUInt32LE(0x08000000, 4) // ATTR_CMN_FULLPATH
      const buffer = Buffer.alloc(8192)

      const rc = ffi.load({
        library: mac,
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

  return {
    async path(fd: number) {
      if (closed) return unavailable()

      if (process.platform === "linux") return readlink(`/proc/self/fd/${fd}`).catch(unavailable)

      if (process.platform !== "darwin" && process.platform !== "win32") return unavailable()
      native ??= handleResolver()

      return native.then((resolve) => resolve(fd)).catch(unavailable)
    },
    async close() {
      closed = true
      await native?.catch(() => undefined)

      if (!libraries.length) return
      const { close } = await import("ffi-rs")
      libraries.splice(0).forEach((library) => close(library))
    },
  }
}
