import { dialog } from "electron"
import { Effect, Exit, Schema, Scope } from "effect"
import { builtinMainContext } from "@opencode/plugin/gui/builtin"
import { MenubarItem, type Plugin } from "@opencode/plugin/gui/main"
import { Updater } from "@opencode/plugin/gui/updater"
import { logContext } from "./log"
import { make } from "./machine"

const setup: Plugin.MainSetup = async (ctx) => {
  const builtin = builtinMainContext(ctx)
  const build = ctx.app
  const lifecycle = builtin.lifecycle
  const enabled = build.packaged
  // Holds no resources, so it needs no cleanup.
  const context = logContext(ctx.log.write)
  const runPromise = Effect.runPromiseWith(context)
  const runFork = Effect.runForkWith(context)

  // The update main staged for the next start; stored before in the updater's settings file.
  const ready = builtin.storage.store("ready", {
    schema: Schema.NullOr(Schema.Struct({ version: Schema.String })),
    initial: null,
    from: { settings: "ready", file: "opencode.updater" },
  })

  // electron-updater loads only in packaged builds, after the first window is up.
  const platform = enabled
    ? await import("./platform").then((module) => runPromise(module.make(build.channel)))
    : undefined

  if (ctx.signal.aborted) return
  const scope = Scope.makeUnsafe()
  ctx.onCleanup(() => runPromise(Scope.close(scope, Exit.void)))
  const publish = { changed: () => {} }

  const updater = await runPromise(
    make({
      currentVersion: build.version,
      platform,
      // The updater stays active through the handoff, so a failed install returns to a state the user can retry.
      restart: (handoff) =>
        Effect.tryPromise({
          try: () => lifecycle.restart(() => runPromise(handoff)),
          catch: (error) => error,
        }),
      persistence: {
        get: Effect.sync(() => ready.value ?? undefined),
        set: (value) => Effect.sync(() => ready.set(value)),
        clear: Effect.sync(() => ready.set(null)),
      },
      changed: () => publish.changed(),
    }).pipe(Scope.provide(scope)),
  )

  const provider = ctx.provide(Updater, {
    state: () => updater.state(),
    check: () => runPromise(updater.check),
    install: () => runPromise(updater.install),
  })

  publish.changed = () => provider.changed()

  const show = Effect.gen(function* () {
    const state = yield* updater.check

    if (state.status === "error") {
      yield* promise(() =>
        dialog.showMessageBox({
          type: "error",
          message: ctx.t("dialog.checkFailed.message"),
          title: ctx.t("dialog.checkFailed.title"),
        }),
      )

      return
    }

    if (state.status === "up-to-date") {
      yield* promise(() =>
        dialog.showMessageBox({
          type: "info",
          message: ctx.t("dialog.upToDate.message"),
          title: ctx.t("dialog.upToDate.title"),
        }),
      )

      return
    }

    if (state.status !== "ready") return

    const response = yield* promise(() =>
      dialog.showMessageBox({
        type: "info",
        message: ctx.t("dialog.ready.message", { version: state.version }),
        title: ctx.t("dialog.ready.title"),
        buttons: [ctx.t("dialog.restart"), ctx.t("dialog.later")],
        defaultId: 0,
        cancelId: 1,
      }),
    )

    if (response.response === 0) yield* updater.install
  })

  ctx.add(
    MenubarItem,
    (): MenubarItem => ({
      menu: "app",
      id: "check",
      label: ctx.t("menu.check"),
      after: "about",
      enabled: () => enabled,
      run(window) {
        // Beta builds check in the focused window, which reports the result in-app.
        if (build.channel !== "beta") return void runFork(show)

        if (window) provider.emit("check", null, window.id)
      },
    }),
  )
}

function promise<A>(evaluate: () => Promise<A>) {
  return Effect.tryPromise(evaluate).pipe(Effect.orDie)
}

export default setup
