import { NodeFileSystem } from "@effect/platform-node"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Effect, Option } from "effect"
import { Service } from "@opencode-ai/client/effect"
import type { Transport } from "@opencode-ai/client/effect"
import { ServiceConfig } from "../../services/service-config"
import { Standalone } from "../../services/standalone"
import { Updater } from "../../services/updater"

export default Runtime.handler(Commands, (input) =>
  Effect.gen(function* () {
    const directory = Option.getOrUndefined(input.directory)
    if (directory !== undefined) process.chdir(directory)
    const updater = yield* Updater.Service
    yield* updater.check().pipe(Effect.forkScoped)
    const server = Option.getOrUndefined(input.server)
    if (server !== undefined && input.standalone)
      return yield* Effect.fail(new Error("--server and --standalone cannot be combined"))
    const transport = yield* Effect.gen(function* () {
      if (server !== undefined) {
        const password = process.env["OPENCODE_SERVER_PASSWORD"]
        return {
          url: server,
          headers: password ? { authorization: "Basic " + btoa("opencode:" + password) } : undefined,
        } satisfies Transport
      }
      if (input.standalone) return yield* Standalone.transport()
      const options = yield* ServiceConfig.options()
      const found = yield* Service.discover(options)
      return found ?? (yield* Service.start(options))
    })
    const { runTui } = yield* Effect.promise(() => import("../../tui"))
    // The TUI re-runs discover whenever its event stream drops. For an explicit
    // --server or a standalone child the transport is fixed, so reconnects
    // retry the same address; for the managed service discovery re-reads the
    // registration and may start a replacement.
    const serviceOptions = server === undefined && !input.standalone ? yield* ServiceConfig.options() : undefined
    const discover = serviceOptions
      ? () =>
          Effect.runPromise(
            Effect.gen(function* () {
              const found = yield* Service.discover(serviceOptions)
              return found ?? (yield* Service.start(serviceOptions))
            }).pipe(Effect.provide(NodeFileSystem.layer)),
          )
      : () => Promise.resolve(transport)
    yield* runTui(transport, { continue: input.continue, sessionID: Option.getOrUndefined(input.session) }, discover)
  }),
)
