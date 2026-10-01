import { NodeServices } from "@effect/platform-node"
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Schema, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Cli, MainStorage, Windows, type Setup } from "../sdk/main"
import { SshFailure } from "./command"
import { Ssh, SshConfig } from "./contract"
import { createSshController } from "./controller"

const setup: Setup = async (ctx) => {
  const cli = ctx.use(Cli)
  const saved = ctx.use(MainStorage).store("servers", {
    schema: Schema.Array(SshConfig),
    initial: [],
    from: "settings:ssh.servers",
  })
  const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))
  const scope = await runtime.runPromise(Scope.make())
  const controller = await runtime.runPromise(
    createSshController({
      version: cli.version,
      development: cli.development,
      binary: cli.binary ?? cli.command[0] ?? "opencode",
      command: cli.command,
      configs: saved.get(),
      save: (configs) => Effect.try({ try: () => saved.set(configs), catch: SshFailure.from }),
    }).pipe(Scope.provide(scope)),
  )
  const status = { revision: 0 }
  const provided = ctx.provide(Ssh, {
    // Each window sees only the prompts of the attempts it started.
    state: (window: number) => ({ ...runtime.runSync(controller.state(window)), revision: status.revision }),
    start: async (input, caller) => {
      await runtime.runPromise(controller.start(input, input.background ? undefined : caller.window))
      return push()
    },
    resolve: (input, caller) => runtime.runPromise(controller.resolve(input.id), { signal: caller.signal }),
    respond: (input, caller) =>
      runtime.runPromise(controller.respond(input.id, input.prompt, input.value, caller.window)),
    cancel: (input, caller) => runtime.runPromise(controller.cancel(input.id, caller.window)),
    forget: (input) => runtime.runPromise(controller.forget(input.id).pipe(Effect.orDie)),
  })
  function push() {
    status.revision++
    provided.changed()
    return status.revision
  }
  const changes = runtime.runFork(controller.changes().pipe(Stream.runForEach(() => Effect.sync(push))))
  // A closed window cancels the attempts it was answering.
  ctx.use(Windows).on("close", (win) => void runtime.runPromise(controller.detach(win.id)))
  return async () => {
    await runtime.runPromise(Fiber.interrupt(changes))
    await runtime.runPromise(controller.close)
    await runtime.runPromise(Scope.close(scope, Exit.void))
    await runtime.dispose()
  }
}

export default setup
