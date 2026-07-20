import { Context, Effect, FileSystem, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { Config } from "../../config"
import { resolve } from "@opencode-ai/tui/config"

export default Runtime.handler(Commands.commands.mini, (input) =>
  Effect.gen(function* () {
    const { runMini, validateMiniTerminal } = yield* Effect.promise(() => import("../../mini"))
    yield* Effect.promise(async () => validateMiniTerminal())
    const serverURL = Option.getOrUndefined(input.server)
    const server = yield* ServerConnection.resolve({ server: serverURL, standalone: input.standalone })
    const config = yield* Config.Service
    const resolved = resolve(yield* config.get(), { terminalSuspend: process.platform !== "win32" })
    const fileSystem = yield* FileSystem.FileSystem
    const runServicePromise = Effect.runPromiseWith(Context.make(FileSystem.FileSystem, fileSystem))
    const service = server.service
    yield* Effect.promise(() =>
      runMini({
        server: {
          endpoint: server.endpoint,
          reconnect: service ? (signal) => runServicePromise(service.reconnect(), { signal }) : undefined,
        },
        continue: input.continue,
        session: Option.getOrUndefined(input.session),
        fork: input.fork,
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
        prompt: Option.getOrUndefined(input.prompt),
        replay: input.replay,
        replayLimit: Option.getOrUndefined(input.replayLimit),
        demo: input.demo,
        tuiConfig: resolved,
      }),
    )
  }),
)
