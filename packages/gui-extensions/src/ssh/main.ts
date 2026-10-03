import { NodeServices } from "@effect/platform-node"
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import type { MainSetup } from "../sdk/main"
import { SshFailure } from "./command"
import { Ssh } from "./contract"
import { createSshController } from "./controller"
import type definition from "./index"

const setup: MainSetup<typeof definition> = async (ctx) => {
  const cli = ctx.cli
  const saved = ctx.stores.servers

  const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))
  const scope = await runtime.runPromise(Scope.make())

  const controller = await runtime.runPromise(
    createSshController({
      version: cli.version,
      development: cli.development,
      binary: cli.binary ?? cli.command[0] ?? "opencode",
      command: cli.command,
      configs: saved.value,
      save: (configs) => Effect.try({ try: () => saved.update(() => configs), catch: SshFailure.from }),
    }).pipe(Scope.provide(scope)),
  )

  const status = { revision: 0 }

  const provider = ctx.provide(Ssh, {
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
    provider.changed()

    return status.revision
  }

  const changes = runtime.runFork(controller.changes().pipe(Stream.runForEach(() => Effect.sync(push))))
  // A closed window cancels the attempts it was answering.
  ctx.windows.on("close", (win) => void runtime.runPromise(controller.detach(win.id)))
  // One finalizer, in order: the controller still runs on the runtime it closes last.
  ctx.scope.addFinalizer(async () => {
    await runtime.runPromise(Fiber.interrupt(changes))
    await runtime.runPromise(controller.close)
    await runtime.runPromise(Scope.close(scope, Exit.void))
    await runtime.dispose()
  })
}

export default setup
