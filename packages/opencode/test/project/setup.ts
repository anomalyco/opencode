import { mock } from "bun:test"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const gitModule = await import("../../src/util/git")
const original = gitModule.git

export type Mode = "none" | "head-fail" | "top-fail" | "common-dir-fail"

let mode: Mode = "none"

mock.module("../../src/util/git", () => ({
  git: (args: string[], opts: { cwd: string; env?: Record<string, string> }) => {
    const cmd = ["git", ...args].join(" ")
    if (mode === "head-fail" && cmd.includes("git rev-parse") && cmd.includes("--verify") && cmd.includes("HEAD")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => "",
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "top-fail" && cmd.includes("git rev-parse") && cmd.includes("--show-toplevel")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => "",
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    if (mode === "common-dir-fail" && cmd.includes("git rev-parse") && cmd.includes("--git-common-dir")) {
      return Promise.resolve({
        exitCode: 128,
        text: () => "",
        stdout: Buffer.from(""),
        stderr: Buffer.from("fatal"),
      })
    }
    return original(args, opts)
  },
}))

export async function withMode(next: Mode, run: () => Promise<void>) {
  const prev = mode
  mode = next
  try {
    await run()
  } finally {
    mode = prev
  }
}

export async function loadProject() {
  return (await import("../../src/project/project")).Project
}
