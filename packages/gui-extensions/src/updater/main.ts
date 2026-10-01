import { dialog } from "electron"
import { Effect, Exit, Schema, Scope } from "effect"
import { MainApp, MainStorage, Menubar, type Setup } from "../sdk/main"
import { Updater } from "./contract"
import { logContext } from "./log"
import { make } from "./machine"

const setup: Setup = async (ctx) => {
  const app = ctx.use(MainApp)
  const enabled = app.packaged && app.channel !== "dev"
  // Holds no resources, so the restart handoff can still log after this extension is disposed.
  const context = logContext(app.log)
  const runPromise = Effect.runPromiseWith(context)
  const runFork = Effect.runForkWith(context)
  const ready = ctx.use(MainStorage).store("ready", {
    schema: Schema.NullOr(Schema.Struct({ version: Schema.String })),
    initial: null,
    from: "settings:opencode.updater/ready",
  })
  // electron-updater loads only in packaged builds that update, after the first window is up.
  const platform = enabled
    ? await import("./platform").then((module) => runPromise(module.make(app.channel)))
    : undefined
  const scope = Scope.makeUnsafe()
  ctx.cleanup(() => runPromise(Scope.close(scope, Exit.void)))
  const publish = { changed: () => {} }
  const updater = await runPromise(
    make({
      currentVersion: app.version,
      platform,
      restart: (handoff) =>
        Effect.tryPromise({ try: () => app.restart(() => runPromise(handoff)), catch: (error) => error }),
      persistence: {
        get: Effect.sync(() => ready.get() ?? undefined),
        set: (value) => Effect.sync(() => ready.set(value)),
        clear: Effect.sync(() => ready.set(null)),
      },
      changed: () => publish.changed(),
    }).pipe(Scope.provide(scope)),
  )
  const provided = ctx.provide(Updater, {
    state: () => updater.state(),
    check: () => runPromise(updater.check),
    install: () => runPromise(updater.install),
  })
  publish.changed = () => provided.changed()

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
    Menubar,
    (): Menubar => ({
      menu: "app",
      id: "check",
      label: ctx.t("menu.check"),
      after: "about",
      enabled: () => enabled,
      run(window) {
        // Beta builds check in the focused window, which can offer the stable installer.
        if (app.channel !== "beta") return void runFork(show)
        if (window) provided.emit("check", null, window.id)
      },
    }),
  )
}

function promise<A>(evaluate: () => Promise<A>) {
  return Effect.tryPromise(evaluate).pipe(Effect.orDie)
}

export default setup
