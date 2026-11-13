import { spawn } from "node:child_process"
import type { Announced } from "./mdns"

/** How long a responder process has to confirm the announcement before the next backend is tried. */
const READY_TIMEOUT = 10_000

/**
 * Holds an announcement in a child process that the system's responder ties it to: it is live from the line `ready`
 * matches until the process ends, and the responder withdraws it if this app dies without stopping it. Exiting first,
 * printing `failed`, or staying silent rejects; exiting later reports through `onError`.
 */
export function holdInProcess(input: {
  backend: string
  command: string
  args: readonly string[]
  env?: NodeJS.ProcessEnv
  ready: RegExp
  failed?: RegExp
  /** The process withdraws and exits once stdin closes, so it gets a moment before it is killed. */
  stopsOnStdinClose?: boolean
  onError: (error: Error) => void
}) {
  return new Promise<Announced>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      env: input.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })

    const state = { live: false, stopping: false, output: "" }

    const fail = (error: Error) => {
      if (state.live) return void (state.stopping || input.onError(error))
      clearTimeout(timer)
      child.kill()
      reject(error)
    }

    const timer = setTimeout(() => fail(new Error(`${input.backend} did not confirm the announcement`)), READY_TIMEOUT)

    const read = (chunk: Buffer) => {
      if (state.live) return
      // Kept short: only the confirmation or the failure matters.
      state.output = (state.output + chunk.toString("utf8")).slice(-4096)

      if (input.failed?.test(state.output)) return fail(new Error(`${input.backend}: ${state.output.trim()}`))

      if (!input.ready.test(state.output)) return
      clearTimeout(timer)
      state.live = true
      resolve({
        backend: input.backend,
        stop: () =>
          new Promise<void>((done) => {
            state.stopping = true

            if (child.exitCode !== null || child.signalCode !== null) return done()
            child.once("exit", () => done())
            child.stdin.end()
            const kill = setTimeout(() => child.kill(), input.stopsOnStdinClose ? 3_000 : 0)
            child.once("exit", () => clearTimeout(kill))
          }),
      })
    }

    child.stdout.on("data", read)
    child.stderr.on("data", read)
    child.on("error", fail)
    child.on("exit", (code, signal) => fail(new Error(`${input.backend} exited (${signal ?? code}): ${state.output.trim()}`)))
  })
}
