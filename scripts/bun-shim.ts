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

;(globalThis as any).Bun = BunShim
export default BunShim
