import { spawn, type ChildProcess } from "child_process"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { Shell } from "../shell/shell"

export namespace Recorder {
  export interface Handle {
    stop(): Promise<string>
    abort(): void
    file: string
  }

  export function start(opts: { sox: string; max: number }): Handle {
    const file = path.join(os.tmpdir(), `opencode-voice-${Date.now()}.wav`)
    let exited = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const proc: ChildProcess = spawn(opts.sox, ["-q", "-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer", "-t", "wav", file], {
      stdio: ["ignore", "ignore", "ignore"],
      detached: process.platform !== "win32",
    })

    proc.once("exit", () => {
      exited = true
    })
    proc.once("error", () => {
      exited = true
    })

    timer = setTimeout(() => {
      if (!exited) Shell.killTree(proc, { exited: () => exited })
    }, opts.max * 1000)

    return {
      file,
      async stop() {
        if (timer) clearTimeout(timer)
        if (!exited) {
          await Shell.killTree(proc, { exited: () => exited })
        }
        return file
      },
      abort() {
        if (timer) clearTimeout(timer)
        if (!exited) {
          void Shell.killTree(proc, { exited: () => exited })
        }
        fs.unlink(file).catch(() => {})
      },
    }
  }
}
