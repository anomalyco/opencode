import path from "path"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "browser.binary" })

/**
 * Resolves the agent-browser binary path.
 * Search order:
 * 1. Bundled binary next to the athena executable
 * 2. Global PATH lookup
 * 3. node_modules/.bin (dev mode)
 */
export namespace BrowserBinary {
  let resolved: string | undefined

  export async function resolve(): Promise<string> {
    if (resolved) return resolved

    // 0. Check environment variable override
    if (Flag.ATHENA_BROWSER_EXECUTABLE) {
      log.info("using env ATHENA_BROWSER_EXECUTABLE", { path: Flag.ATHENA_BROWSER_EXECUTABLE })
      resolved = Flag.ATHENA_BROWSER_EXECUTABLE
      return resolved
    }

    // 1. Check bundled path next to athena binary
    const execDir = path.dirname(process.execPath)
    const bundledPath = path.join(execDir, process.platform === "win32" ? "agent-browser.exe" : "agent-browser")
    if (await fileExists(bundledPath)) {
      log.info("using bundled agent-browser", { path: bundledPath })
      resolved = bundledPath
      return resolved
    }

    // 2. Check bin cache directory
    const cachedPath = path.join(
      Global.Path.bin,
      process.platform === "win32" ? "agent-browser.exe" : "agent-browser",
    )
    if (await fileExists(cachedPath)) {
      log.info("using cached agent-browser", { path: cachedPath })
      resolved = cachedPath
      return resolved
    }

    // 3. Check PATH via which/where
    try {
      const cmd = process.platform === "win32" ? "where" : "which"
      const proc = Bun.spawn([cmd, "agent-browser"], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const text = await new Response(proc.stdout).text()
      const exitCode = await proc.exited
      if (exitCode === 0 && text.trim()) {
        const p = text.trim().split("\n")[0]!.trim()
        log.info("using PATH agent-browser", { path: p })
        resolved = p
        return resolved
      }
    } catch {}

    // 4. Check node_modules/.bin (dev mode)
    const nmPath = path.join(
      process.cwd(),
      "node_modules",
      ".bin",
      process.platform === "win32" ? "agent-browser.cmd" : "agent-browser",
    )
    if (await fileExists(nmPath)) {
      log.info("using node_modules agent-browser", { path: nmPath })
      resolved = nmPath
      return resolved
    }

    // 5. Try npx as last resort
    resolved = "npx"
    log.warn("agent-browser binary not found, falling back to npx")
    return resolved
  }

  export function reset() {
    resolved = undefined
  }

  async function fileExists(p: string): Promise<boolean> {
    try {
      const file = Bun.file(p)
      return await file.exists()
    } catch {
      return false
    }
  }
}
