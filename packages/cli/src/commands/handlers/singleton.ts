import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { UpdatePreflight } from "../../services/update-preflight"
import { launch } from "./launch-tui"
import { Env } from "../../env"
import { Global } from "@opencode/util/global"
import { Effect, Option } from "effect"
import { errorMessage } from "../../util/error"
import { startSingletonHttpBridge } from "./singleton-http"

// Single-process mode: run the whole service in this process instead of
// connecting to or starting a background service. The TUI is served by an
// in-memory host; its client fetches straight into the same router.
//
// Optional `--expose [=PORT]` mounts the same in-memory host over node http,
// so SDK/HTTP callers can drive the same session through a loopback port.
export default Runtime.handler(Commands.commands.singleton, (input) =>
  Effect.gen(function* () {
    const global = yield* Global.Service
    const server = yield* ServerConnection.resolve({ inProcess: true, autostart: false })
    const requestedDirectory = Option.getOrUndefined(input.directory)
    const preflight = UpdatePreflight.make()
    yield* Effect.addFinalizer(() => Effect.promise(() => preflight.close()))

    const rawExpose = Option.getOrUndefined(input.expose)
    if (rawExpose !== undefined && server.fetch !== undefined) {
      const portNumber = typeof rawExpose === "string" && rawExpose !== "" ? Number.parseInt(rawExpose, 10) : 49375
      if (!Number.isFinite(portNumber) || portNumber <= 0 || portNumber > 65535) {
        throw new Error(`singleton: --expose expects a port number 1-65535, got ${String(rawExpose)}`)
      }
      const fetchImpl = server.fetch
      const bridge = yield* Effect.tryPromise({
        try: () =>
          startSingletonHttpBridge({ fetch: fetchImpl }, {
            port: portNumber,
            statePath: global.state,
            log: (line) => process.stderr.write(`${line}\n`),
          }),
        catch: (cause) => new Error(errorMessage(cause)),
      })
      yield* Effect.addFinalizer(() => Effect.promise(async () => bridge.close()))
    }

    yield* launch({
      server,
      preflight,
      requestedDirectory,
      session: Option.getOrUndefined(input.session),
      continue: input.continue,
      prompt: Option.getOrUndefined(input.prompt),
      auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
      environment: Env.session(),
    })
  }),
)
