import { showToast } from "@opencode/ui/toast"
import { lazy, onCleanup, Suspense } from "solid-js"
import { createKeyed, onIdle, Command, SettingsPage, TitlebarItem, type Setup, type SetupContext } from "../sdk"
import { updaterAction } from "./action"
import type definition from "./index"

const setup: Setup<typeof definition> = (ctx) => {
  whatsNew(ctx)

  if (!ctx.desktop) return
  const updater = ctx.uses.updater

  const state = () => {
    const live = updater()

    return live.status === "active" ? live.value.state() : undefined
  }

  const act = (name: "check" | "install") => {
    const live = updater()

    if (live.status === "active") return void import("./actions").then((module) => module[name](ctx, live.value))

    // Not loaded yet, or gone (disabled, failed, restarting): nothing can check or install.
    showToast({ title: ctx.t("common.requestFailed") })
  }

  const Section = lazy(() => import("./section"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void Section.preload()))

  ctx.add(TitlebarItem, () => {
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

  ctx.add(SettingsPage, {
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

  // Beta builds answer the app menu's Check for Updates in the focused window instead of a native dialog. The
  // listener ends with the generation of the main side that sends it.
  createKeyed(updater, (client) => void client.on("check", () => act("check")))
}

/**
 * What's New after an update, on every platform: the release highlights since the version last seen. The first run
 * and a disabled What's New only remember the version.
 */
function whatsNew(ctx: SetupContext<typeof definition>) {
  const version = ctx.build.version
  const seen = ctx.stores.seen
  const previous = seen.value.version

  if (!version || previous === version) return

  const markSeen = () =>
    seen.update((draft) => {
      draft.version = version
    })

  if (!previous || !ctx.stores.releaseNotes.value.enabled) return markSeen()

  void import("./whats-new").then((module) => {
    if (ctx.signal.aborted) return

    module.showWhatsNew(ctx, { previous, current: version, markSeen })
  })
}

export default setup
