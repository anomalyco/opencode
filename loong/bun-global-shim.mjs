import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

function widthOf(ch) {
  const c = ch.codePointAt(0)
  // combining marks / zero width
  if ((c >= 0x0300 && c <= 0x036f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  // wide ranges (CJK, fullwidth, hangul, etc.)
  if (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff)
  )
    return 2
  return 1
}

export function stringWidth(s) {
  if (s == null) return 0
  let w = 0
  for (const ch of String(s)) w += widthOf(ch)
  return w
}

function bunFile(p) {
  const resolved = typeof p === "number" ? p : path.resolve(String(p))
  return {
    get size() {
      try {
        return fs.statSync(resolved).size
      } catch {
        return 0
      }
    },
    get type() {
      return ""
    },
    name: String(p),
    text: () => fsp.readFile(resolved, "utf8"),
    json: async () => JSON.parse(await fsp.readFile(resolved, "utf8")),
    arrayBuffer: async () => {
      const b = await fsp.readFile(resolved)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
    },
    bytes: () => fsp.readFile(resolved),
    stream: () => fs.createReadStream(resolved),
    exists: async () => fs.existsSync(resolved),
    lastModified: () => {
      try {
        return Math.floor(fs.statSync(resolved).mtimeMs)
      } catch {
        return 0
      }
    },
  }
}

export function makeBun() {
  const Bun = {
    file: bunFile,
    write: (p, data) => fsp.writeFile(path.resolve(String(p)), data),
    read: async (p) => fsp.readFile(path.resolve(String(p))),
    stringWidth,
    env: process.env,
    cwd: () => process.cwd(),
    which: async () => null,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    version: "1.1.0-loong-patch",
    $: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    spawn: () => {
      throw new Error("Bun.spawn not implemented in loong node shim")
    },
    stdout: { text: async () => "" },
    stderr: { text: async () => "" },
    stdin: { text: async () => "" },
    main: {
      file() {
        return process.argv[1] || ""
      },
    },
    isMainThread: true,
  }
  return Bun
}

export default makeBun()