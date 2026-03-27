import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import path, { resolve as pathResolve } from "path"
import { spawn, type ChildProcess } from "child_process"
import { realpathSync } from "fs"
import { setTimeout as sleep } from "node:timers/promises"

const SIGKILL_TIMEOUT_MS = 200

export namespace Shell {
  export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
    const pid = proc.pid
    if (!pid || opts?.exited?.()) return

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        })
        killer.once("exit", () => resolve())
        killer.once("error", () => resolve())
      })
      return
    }

    try {
      process.kill(-pid, "SIGTERM")
      await sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        process.kill(-pid, "SIGKILL")
      }
    } catch (_e) {
      proc.kill("SIGTERM")
      await sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    }
  }
  const BLACKLIST = new Set(["fish", "nu"])

  function winbash() {
    const bash = which("bash.exe") || which("bash")
    if (bash && Filesystem.stat(bash)?.size) {
      try {
        return realpathSync.native(bash)
      } catch {
        return bash
      }
    }
    const git = which("git")
    if (!git) return null
    const list = [git]
    try {
      list.push(realpathSync.native(git))
    } catch {}
    for (const item of list) {
      const direct = pathResolve(item, "..", "bash.exe")
      if (Filesystem.stat(direct)?.size) {
        try {
          return realpathSync.native(direct)
        } catch {
          return direct
        }
      }
      const bin = pathResolve(item, "..", "..", "bin", "bash.exe")
      if (Filesystem.stat(bin)?.size) {
        try {
          return realpathSync.native(bin)
        } catch {
          return bin
        }
      }
    }
    return null
  }

  function fallback() {
    if (process.platform === "win32") {
      if (Flag.OPENCODE_GIT_BASH_PATH) return Flag.OPENCODE_GIT_BASH_PATH
      const bash = winbash()
      if (bash) return bash
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") return "/bin/zsh"
    const bash = which("bash")
    if (bash) return bash
    return "/bin/sh"
  }

  export const preferred = lazy(() => {
    const s = process.env.SHELL
    if (s) return s
    return fallback()
  })

  export const acceptable = lazy(() => {
    const s = process.env.SHELL
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return fallback()
  })
}
