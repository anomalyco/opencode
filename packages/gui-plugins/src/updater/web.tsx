import { Icon } from "@opencode/ui/icon"
import { showToast, toaster } from "@opencode/ui/toast"
import { createSignal, lazy, onCleanup, Suspense } from "solid-js"
import { Command, createKeyed, SettingsPage, TitlebarItem, type SetupContext } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { startWebUpdater } from "./web-driver"
import { initialWebUpdate, webUpdateAction, webUpdatePending, type WebUpdateState } from "./web-machine"
import type definition from "./index"

type Offer = { toast?: number }

/**
 * Updates for the web app and installed web app (PWA): finds the server's newer build, offers it in a toast, the
 * titlebar and Settings › Updates, and moves every open window to it. Settings also offers a full reload from the
 * server for a saved copy that will not update.
 */
export function webUpdates(ctx: SetupContext<typeof definition>) {
  const [state, setState] = createSignal<WebUpdateState>(initialWebUpdate)
  // The one "update ready" toast on screen, replaced when it is offered again.
  const offer: Offer = {}

  const updater = startWebUpdater({
    changed: setState,
    announce: () => {
      if (offer.toast !== undefined) toaster.dismiss(offer.toast)
      offer.toast = showToast({
        title: ctx.t("web.ready.title"),
        description: ctx.t("web.ready.message"),
        persistent: true,
        actions: [
          { label: ctx.t("web.reload"), variant: "primary", onClick: () => updater.apply() },
          { label: ctx.t("dialog.later"), variant: "secondary", onClick: "dismiss" },
        ],
      })
    },
    report: (report) => {
      if (report.result === "up-to-date")
        return void showToast({
          variant: "success",
          icon: () => <Icon name="circle-check" />,
          title: ctx.t("toast.latest.title"),
          description: ctx.t("toast.latest.description", { version: ctx.app.version }),
        })

      showToast({ title: ctx.t("common.requestFailed"), description: report.message || undefined })
    },
  })

  onCleanup(updater.dispose)

  const run = () => {
    const next = webUpdateAction(state()).run

    if (next === "apply") return updater.apply()

    if (next === "check") updater.check()
  }

  const Section = lazy(() => import("./section"))
  onCleanup(onIdle(() => void Section.preload()))

  // Without a service worker (development, an insecure origin) a reload is already the newest build: offer nothing.
  createKeyed(
    () => state().status !== "unavailable",
    () => {
      ctx.add(TitlebarItem, () => {
        const current = state()

        if (!webUpdatePending(current)) return

        return {
          id: "update",
          label: ctx.t("status.label"),
          title: ctx.t(webUpdateAction(current).label),
          busy: current.status !== "ready",
          run,
        }
      })

      ctx.add(SettingsPage, {
        id: "updates",
        page: "general",
        get title() {
          return ctx.t("section.title")
        },
        get entries() {
          return [
            { id: "settings-release-notes", title: ctx.t("releaseNotes.title") },
            { id: "settings-check-updates", title: ctx.t("check.title") },
            { id: "settings-reload-from-server", title: ctx.t("web.reset.title") },
          ]
        },
        render: () => (
          <Suspense>
            <Section action={() => webUpdateAction(state())} run={run} reset={() => updater.reset()} />
          </Suspense>
        ),
      })

      ctx.add(Command, (): Command => ({ id: "check", title: ctx.t("menu.check"), hidden: true, run: updater.check }))
    },
  )
}
