import { createEffect, lazy, onCleanup, Suspense } from "solid-js"
import { onIdle, Command, Native, Setting, Status, type Setup } from "../sdk"
import { updaterAction } from "./action"
import { Updater } from "./contract"

const setup: Setup = (ctx) => {
  if (!ctx.use(Native)) return
  const updater = ctx.use(Updater)
  const state = () => updater()?.state()
  const act = (name: "check" | "install") => {
    const client = updater()
    if (client) void import("./actions").then((module) => module[name](ctx, client))
  }
  const Section = lazy(() => import("./section"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  ctx.cleanup(onIdle(() => void Section.preload()))

  ctx.add(Status, () => {
    const current = state()
    const installing = current?.status === "installing"
    const ready = current?.status === "ready" || current?.status === "download-required"
    if (!ready && !installing) return
    return {
      id: "update",
      label: ctx.t("status.label"),
      title: ctx.t(updaterAction(current).label),
      busy: installing,
      run: () => act("install"),
    }
  })

  ctx.add(Setting, {
    id: "updates",
    page: "general",
    available: "desktop",
    get title() {
      return ctx.t("section.title")
    },
    get entries() {
      return [
        { id: "settings-release-notes", title: ctx.t("releaseNotes.title") },
        { id: "settings-check-updates", title: ctx.t("check.title") },
      ]
    },
    render: () => (
      <Suspense>
        <Section
          state={state}
          run={() => {
            const run = updaterAction(state()).run
            if (run) act(run)
          }}
        />
      </Suspense>
    ),
  })

  ctx.add(Command, {
    id: "check",
    get title() {
      return ctx.t("menu.check")
    },
    hidden: true,
    run: () => act("check"),
  })

  // Beta builds answer the app menu's Check for Updates in the focused window instead of a native dialog.
  createEffect(() => {
    const client = updater()
    if (client) onCleanup(client.on("check", () => act("check")))
  })
}

export default setup
