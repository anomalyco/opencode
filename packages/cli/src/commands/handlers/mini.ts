import { Effect, FileSystem, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { Config } from "../../config"
import { resolve } from "@opencode/tui/config"
import { Global } from "@opencode/util/global"

export default Runtime.handler(Commands.commands.mini, (input) =>
  Effect.gen(function* () {
    const { runMini, validateMiniTerminal } = yield* Effect.promise(() => import("../../mini"))
    yield* Effect.promise(async () => validateMiniTerminal())
    const server = yield* ServerConnection.resolve({
      mismatch: "replace",
    })
    const config = yield* Config.Service
    const global = yield* Global.Service
    const resolved = resolve(yield* config.get(), { terminalSuspend: process.platform !== "win32" })
    const context = yield* Effect.context<FileSystem.FileSystem>()
    const runPromise = Effect.runPromiseWith(context)
    const service = server.service
    yield* Effect.promise(() =>
      runMini({
        server: {
          endpoint: server.endpoint,
          reconnect: service ? (signal) => runPromise(service.reconnect(), { signal }) : undefined,
        },
        continue: input.continue,
        session: Option.getOrUndefined(input.session),
        fork: input.fork,
        model: Option.getOrUndefined(input.model),
        agent: Option.getOrUndefined(input.agent),
        prompt: Option.getOrUndefined(input.prompt),
        replay: Option.getOrUndefined(input.replay) ?? resolved.mini?.replay ?? true,
        replayLimit: Option.getOrUndefined(input.replayLimit) ?? resolved.mini?.replay_limit,
        demo: input.demo,
        tuiConfig: resolved,
        config: {
          update: (update) => runPromise(config.update(update)),
        },
        paths: { home: global.home, state: global.state, log: global.log },
      }),
    )
  }),
)
