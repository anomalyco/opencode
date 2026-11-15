import { NodeServices } from "@effect/platform-node"
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Schema, Scope, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { builtinMainContext } from "@opencode/plugin/gui/builtin"
import type { Plugin } from "@opencode/plugin/gui/main"
import { SshFailure } from "./command"
import { Ssh, SshConfig } from "./contract"
import { createSshController } from "./controller"

const setup: Plugin.MainSetup = async (ctx) => {
  const cli = ctx.cli

  // The saved hosts; stored before in the desktop settings file.
  const saved = builtinMainContext(ctx).storage.store("servers", {
    schema: Schema.Array(SshConfig),
    initial: [],
    from: { settings: "ssh.servers" },
  })

  // Each resource's teardown is registered as it is acquired, so a setup that fails or is aborted part way releases
  // what it holds. The scope runs finalizers in reverse: the changes, the controller, its scope, then the runtime.
  const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))
  ctx.onCleanup(() => runtime.dispose())

  const scope = await runtime.runPromise(Scope.make())
  ctx.onCleanup(() => runtime.runPromise(Scope.close(scope, Exit.void)))

  if (ctx.signal.aborted) return

  const controller = await runtime.runPromise(
    createSshController({
      version: cli.version,
      development: cli.development,
      binary: cli.binary ?? cli.command[0] ?? "opencode",
      command: cli.command,
      configs: saved.value,
      save: (configs) => Effect.try({ try: () => saved.set(configs), catch: SshFailure.from }),
    }).pipe(Scope.provide(scope)),
  )

  ctx.onCleanup(() => runtime.runPromise(controller.close))

  if (ctx.signal.aborted) return

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
  ctx.onCleanup(() => runtime.runPromise(Fiber.interrupt(changes)))
  // A closed window cancels the attempts it was answering.
  ctx.windows.on("close", (win) => void runtime.runPromise(controller.detach(win.id)))
}

export default setup
