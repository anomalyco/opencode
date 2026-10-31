import { Context, Effect, FileSystem, Option } from "effect"
import { Commands } from "../commands"
import { Runtime, type Input } from "../../framework/runtime"
import { Env } from "../../env"
import { ServerConnection } from "../../services/server-connection"
import { Config } from "../../config"
import { resolve } from "@opencode/tui/config"
import { Global } from "@opencode/util/global"

export const start = (input: Input<typeof Commands.commands.mini>) =>
  Effect.gen(function* () {
    const { runMini, validateMiniTerminal } = yield* Effect.promise(() => import("../../mini"))
    yield* Effect.promise(async () => validateMiniTerminal())
    const server = yield* ServerConnection.resolve({
      mismatch: "replace",
    })
    const config = yield* Config.Service
    const global = yield* Global.Service
    const resolved = resolve(yield* config.get(), { terminalSuspend: process.platform !== "win32" })
    const screenReader =
      Option.getOrUndefined(input.screenReader) ?? (yield* Env.screenReader) ?? resolved.screen_reader ?? false
    const noColor = (yield* Env.noColor) !== ""
    const auto = input.auto || input.yolo || input.dangerouslySkipPermissions
    const fileSystem = yield* FileSystem.FileSystem
    const runServicePromise = Effect.runPromiseWith(Context.make(FileSystem.FileSystem, fileSystem))
    const service = server.service
    if (screenReader) process.stdout.write("Screen reader mode on.\n")
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
        replay: Option.getOrUndefined(input.replay) ?? resolved.mini?.replay ?? true,
        replayLimit: Option.getOrUndefined(input.replayLimit) ?? resolved.mini?.replay_limit,
        demo: input.demo,
        tuiConfig: {
          ...resolved,
          screen_reader: screenReader,
          ...(screenReader && { animations: false }),
          // Only the flag auto-approves here; the config setting never did in this interface.
          session: { ...resolved.session, permissions: auto ? ("autoaccept" as const) : ("prompt" as const) },
          mini: {
            ...resolved.mini,
            ...(screenReader ? { splash: "hide" as const, footer: "hide" as const, mono: true } : noColor && { mono: true }),
          },
        },
        config: {
          update: (update) => runServicePromise(config.update(update)),
        },
        paths: { home: global.home, state: global.state, log: global.log },
      }),
    )
  })

export default Runtime.handler(Commands.commands.mini, start)
