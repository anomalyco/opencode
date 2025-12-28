import fs from "fs/promises"
import path from "path"
import toml from "toml"
import fg from "fast-glob"
import execa from "execa"
import { spawn as spawnNative } from "child_process"

function makeFile(pathStr: string) {
  return {
    async text() {
      return await fs.readFile(pathStr, "utf8")
    },
    async write(content: string) {
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
  async write(p: string, content: string) {
    await fs.writeFile(p, content, "utf8")
  },
  TOML: {
    parse(s: string) {
      return toml.parse(s)
    },
  },
  Glob,
  $: make$(),
  spawn(...args: any[]) {
    const cp = spawnNative(...args)
    return {
      pid: cp.pid,
      exited: new Promise((resolve) => cp.on("close", resolve)),
      child: cp,
    }
  },
}

;(globalThis as any).Bun = BunShim
export default BunShim
