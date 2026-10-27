import { execFile } from "node:child_process"
import { powerSaveBlocker } from "electron"
import { Schema } from "effect"
import { builtinMainContext } from "@opencode/plugin/gui/builtin"
import type { Plugin } from "@opencode/plugin/gui/main"
import { Pairing } from "./contract"

/** The display sleep blocker this instance holds, if any. */
type Blocker = { id?: number }

/** The last `opencode service` command; the next one starts after it settles. */
type Queue = { tail: Promise<unknown> }

const setup: Plugin.MainSetup = (ctx) => {
  // Whether main keeps the display awake; stored before in the desktop's own settings namespace.
  const stored = builtinMainContext(ctx).storage.store("keepScreenActive", {
    schema: Schema.Boolean,
    initial: false,
    from: { state: ["opencode.settings", "keepScreenActive"] },
  })

  const cli = ctx.cli
  const log = ctx.log
  const blocker: Blocker = {}
  const queue: Queue = { tail: Promise.resolve() }

  const release = () => {
    if (blocker.id === undefined) return
    powerSaveBlocker.stop(blocker.id)
    blocker.id = undefined
  }

  const keepScreenActive = (enabled: boolean) => {
    if (enabled && blocker.id === undefined) blocker.id = powerSaveBlocker.start("prevent-display-sleep")

    if (!enabled) release()
    stored.set(enabled)
  }

  // Remote access is a setting of the background service, so it changes through the CLI the app runs, as with
  // `opencode pair --remote`. A change restarts the service, so commands run one at a time.
  const service = (args: readonly string[], signal: AbortSignal) => {
    const run = queue.tail.then(
      () =>
        new Promise<string>((resolve, reject) => {
          execFile(
            cli.command[0] ?? "opencode",
            [...cli.command.slice(1), "service", ...args],
            { signal, windowsHide: true },
            (error, stdout, stderr) => {
              if (!error) return resolve(stdout.trim())
              log.write("error", "pairing service command failed", { args, error: error.message, stderr })
              reject(error)
            },
          )
        }),
    )

    queue.tail = run.catch(() => undefined)

    return run
  }

  if (stored.value) keepScreenActive(true)
  ctx.onCleanup(release)

  ctx.provide(Pairing, {
    remote: async (_, caller) => (await service(["get", "remote"], caller.signal)) === "true",
    // Changing the setting stops the service. Starting it here brings it back, with the tunnel when remote access is
    // on. A window that closes meanwhile does not cancel the change.
    setRemote: async (enabled) => {
      await service(["set", "remote", String(enabled)], ctx.signal)
      await service(["start"], ctx.signal)
    },
    screenActive: () => blocker.id !== undefined && powerSaveBlocker.isStarted(blocker.id),
    setScreenActive: (enabled) => keepScreenActive(enabled),
  })
}

export default setup
