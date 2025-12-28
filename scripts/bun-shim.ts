import fs from "fs/promises"
import path from "path"
import toml from "toml"
import fg from "fast-glob"
import { execa } from "execa"
import { spawn as spawnNative } from "child_process"

function makeFile(pathStr: string) {
  return {
    async text() {
      return await fs.readFile(pathStr, "utf8")
    },
    async json() {
      return JSON.parse(await fs.readFile(pathStr, "utf8"))
    },
    async arrayBuffer() {
      const buf = await fs.readFile(pathStr)
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    },
    async exists() {
      try {
        await fs.access(pathStr)
        return true
      } catch {
        return false
      }
    },
    async write(content: any) {
      if (content instanceof Uint8Array || Buffer.isBuffer(content)) {
        return await fs.writeFile(pathStr, Buffer.from(content))
      }
      return await fs.writeFile(pathStr, content, "utf8")
    },
  }
}

class Glob {
  pattern: string
  constructor(pattern: string) {
    this.pattern = pattern
  }
  scan(opts: { absolute?: boolean } = {}) {
    const pattern = this.pattern
    const absolute = !!opts.absolute
    const iter = (async function* () {
      const results = await fg(pattern, { dot: true, absolute })
      for (const r of results) yield r
    })()
    return iter
  }
}

function make$() {
  // A tagged template builder that returns a wrapper with utility methods and is awaitable
  return function $fn(parts: TemplateStringsArray, ...args: any[]) {
    const cmd = String.raw(parts, ...args)
    const exec = async () => {
      const res = await execa.command(cmd, { shell: true })
      return res
    }

    const wrapper: any = {
      then: (onFulfilled: any, onRejected: any) => exec().then(onFulfilled, onRejected),
      async text() {
        return (await exec()).stdout
      },
      async json() {
        return JSON.parse((await exec()).stdout)
      },
      async nothrow() {
        try {
          return await exec()
        } catch (e) {
          return { stdout: "", exitCode: 1 }
        }
      },
    }
    return wrapper
  }
}

const BunShim: any = {
  file(p: string) {
    return makeFile(p)
  },
  async write(p: string, content: any) {
    if (content instanceof Uint8Array || Buffer.isBuffer(content)) return await fs.writeFile(p, Buffer.from(content))
    return await fs.writeFile(p, content, "utf8")
  },
  TOML: {
    parse(s: string) {
      return toml.parse(s)
    },
  },
  Glob,
  $: make$(),
  color(name: string, _format?: string) {
    const map: Record<string, string> = {
      gray: "\x1b[90m",
      red: "\x1b[91m",
      green: "\x1b[92m",
      yellow: "\x1b[93m",
      blue: "\x1b[94m",
      magenta: "\x1b[95m",
      cyan: "\x1b[96m",
      white: "\x1b[97m",
    }
    return map[name] ?? ""
  },
  spawn(...args: any[]) {
    let cp
    if (Array.isArray(args[0])) {
      const [cmd, ...rest] = args[0]
      cp = spawnNative(cmd, rest, { stdio: "inherit" })
    } else {
      cp = spawnNative(...args)
    }
    return {
      pid: cp.pid,
      exited: new Promise((resolve) => cp.on("close", resolve)),
      child: cp,
    }
  },
}

const _existingBun = (globalThis as any).Bun
if (_existingBun === undefined) {
  try {
    Object.defineProperty(globalThis, 'Bun', { value: BunShim, configurable: true, enumerable: false, writable: true })
  } catch (err) {
    // fallback if environment prevents defineProperty
    (globalThis as any).Bun = BunShim
  }
} else {
  // merge any missing helpers into existing Bun object
  for (const k of Object.keys(BunShim)) {
    if ((_existingBun as any)[k] === undefined) (_existingBun as any)[k] = (BunShim as any)[k]
  }
}

// Prevent crash when a module attempts to require a native .dll that isn't present in the packaged bundle.
try {
  const _require = (globalThis as any).require ?? (typeof require !== 'undefined' ? require : undefined)
  if (_require) {
    try {
      const Module = _require('module')
      if (Module && Module._load) {
        const origLoad = Module._load
        Module._load = function (request: any, parent: any, isMain: any) {
          if (typeof request === 'string' && request.toLowerCase().endsWith('.dll')) {
            try {
              return origLoad.apply(this, arguments as any)
            } catch (e) {
              // Missing optional native: try to resolve from common candidate locations before giving up
              try {
                const fs = (globalThis as any).require ? (globalThis as any).require('fs') : require('fs')
                const path = (globalThis as any).require ? (globalThis as any).require('path') : require('path')
                const candidates = [] as string[]
                const basename = (typeof request === 'string') ? path.basename(request) : undefined
                if (basename) {
                  // same dir as running exe
                  try { candidates.push(path.join(path.dirname(process.execPath), basename)) } catch (_) {}
                  // possible sidecars next to exe
                  try { candidates.push(path.join(path.dirname(process.execPath), 'sidecars', basename)) } catch (_) {}
                  // current working dir
                  try { candidates.push(path.join(process.cwd(), basename)) } catch (_) {}
                  // repo-side sidecars (in dev / unpacked builds)
                  try { candidates.push(path.join(__dirname || '.', '..', '..', 'packages', 'tauri', 'src-tauri', 'sidecars', basename)) } catch (_) {}
                }
                for (const c of candidates) {
                  try {
                    if (c && fs.existsSync(c)) {
                      try { console.warn(`Found native module at fallback path: ${c}; loading` ) } catch (_) {}
                      return origLoad.call(this, c, parent, isMain)
                    }
                  } catch (_) {}
                }
              } catch (_) {}

              // Still missing: warn and return empty object so consumer can guard at runtime.
              try { console.warn(`Optional native module not found: ${request}`) } catch (_) {}
              return {}
            }
          }
          return origLoad.apply(this, arguments as any)
        }
      }
    } catch (_) {}

    // Bun does not necessarily use Node Module._load in the same way; wrap the global require as a last-resort fallback
    try {
      const globalReq = (globalThis as any).require ?? undefined
      if (typeof globalReq === 'function') {
        const origReqFn = globalReq.bind(globalThis)
        (globalThis as any).require = function (request: any, ...args: any[]) {
          try {
            return origReqFn(request, ...args)
          } catch (e: any) {
            try {
              if (typeof request === 'string' && request.toLowerCase().endsWith('.dll')) {
                const fs = (globalThis as any).require ? (globalThis as any).require('fs') : require('fs')
                const path = (globalThis as any).require ? (globalThis as any).require('path') : require('path')
                const basename = path.basename(request)
                const candidates = [
                  path.join(path.dirname(process.execPath), basename),
                  path.join(path.dirname(process.execPath), 'sidecars', basename),
                  path.join(process.cwd(), basename),
                  path.join(__dirname || '.', '..', '..', 'packages', 'tauri', 'src-tauri', 'sidecars', basename),
                ]
                for (const c of candidates) {
                  try { if (fs.existsSync(c)) { try { console.warn(`Found native at fallback path: ${c}; loading`); return origReqFn(c, ...args) } catch (_) {} } } catch (_) {}
                }
                try { console.warn(`Bun/require: optional native module not found: ${request} — returning empty placeholder`) } catch (_) {}
                return {}
              }
            } catch (_) {}
            throw e
          }
        }
      }
    } catch (_) {}
  }
} catch (_) {}

export default BunShim
