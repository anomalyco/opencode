import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions, enforceLoopbackWithoutAuth } from "../network"
import { UI } from "../ui"

export const DaemonCommand = effectCmd({
  command: "daemon",
  describe: "keep a warm bolt server running so one-shot commands skip boot",
  // The daemon serves instances per-request via the x-opencode-directory
  // header, exactly like `bolt serve`; no ambient project instance is needed.
  instance: false,
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .option("stop", {
        type: "boolean",
        describe: "stop the running daemon",
      })
      .option("status", {
        type: "boolean",
        describe: "print the running daemon, if any",
      })
      .conflicts("stop", "status"),
  handler: Effect.fn("Cli.daemon")(function* (args) {
    const { Daemon } = yield* Effect.promise(() => import("../daemon"))

    if (args.stop) {
      const info = yield* Effect.promise(() => Daemon.read())
      if (!info) return yield* fail("no daemon is running")
      if (Daemon.alive(info.pid)) process.kill(info.pid)
      Daemon.clear()
      UI.println(`stopped daemon (pid ${info.pid})`)
      return
    }

    if (args.status) {
      const info = yield* Effect.promise(() => Daemon.detect())
      if (!info) return yield* fail("no daemon is running")
      UI.println(`daemon running at ${info.url} (pid ${info.pid})`)
      return
    }

    const existing = yield* Effect.promise(() => Daemon.detect())
    if (existing) return yield* fail(`daemon already running at ${existing.url} (pid ${existing.pid})`)

    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    const resolved = yield* resolveNetworkOptions(args)
    const guard = enforceLoopbackWithoutAuth(resolved)
    if (!guard.ok) return yield* fail(guard.error)
    const server = yield* Effect.promise(() => Server.listen(guard.opts))
    const url = `http://${server.hostname}:${server.port}`
    yield* Effect.promise(() => Daemon.write({ url, pid: process.pid, started: Date.now() }))

    // Remove the discovery record on shutdown so one-shots stop probing a
    // dead server; signal handlers funnel through the exit hook.
    process.on("exit", () => Daemon.clear())
    process.on("SIGINT", () => process.exit(0))
    process.on("SIGTERM", () => process.exit(0))

    console.log(`bolt daemon listening on ${url}`)
    yield* Effect.never
  }),
})
