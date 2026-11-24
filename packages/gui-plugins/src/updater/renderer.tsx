import { showToast } from "@opencode/ui/toast"
import { createSignal, lazy, onCleanup, Suspense, untrack } from "solid-js"
import { Command, createKeyed, SettingsPage, TitlebarItem, type SetupContext, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { Updater } from "@opencode/plugin/gui/updater"
import { updaterAction } from "./action"
import {
  ACTION_CHUNK_TIMEOUT_MS,
  initialWindowUpdater,
  transitionWindowUpdater,
  type WindowUpdaterEffect,
  type WindowUpdaterEvent,
} from "./window-machine"
import { webUpdates } from "./web"
import {
  initWhatsNew,
  transitionWhatsNew,
  whatsNewLoading,
  type WhatsNewContent,
  type WhatsNewEffect,
  type WhatsNewEvent,
} from "./whats-new-machine"
import type definition from "./index"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  whatsNew(ctx)

  if (!ctx.desktop) return webUpdates(ctx)
  const updater = ctx.main(Updater)
  // Undefined until main's updater is up and has sent its state, and again while it is gone.
  const state = () => updater.state()
  const [windowState, setWindowState] = createSignal(initialWindowUpdater)

  const dispatchWindow = (event: WindowUpdaterEvent) => {
    const next = transitionWindowUpdater(untrack(windowState), event)

    if (next.state !== untrack(windowState)) setWindowState(next.state)
    next.effects.forEach(runWindow)
  }

  const runWindow = (effect: WindowUpdaterEffect) => {
    if (effect.type === "toast-failed")
      return void showToast({ title: ctx.t("common.requestFailed"), description: effect.message })
    const attempt = effect.attempt
    const chunk = Promise.withResolvers<never>()
    const timer = setTimeout(() => chunk.reject(new Error()), ACTION_CHUNK_TIMEOUT_MS)

    void Promise.race([import("./actions"), chunk.promise])
      .finally(() => clearTimeout(timer))
      .then(
        (module) => {
          if (ctx.signal.aborted) return

          return Promise.try(() => module[effect.action](ctx, updater)).finally(() =>
            dispatchWindow({ type: "action.settled", attempt }),
          )
        },
        (cause: unknown) =>
          dispatchWindow({
            type: "action.failed",
            attempt,
            message: cause instanceof Error && cause.message ? cause.message : undefined,
          }),
      )
  }

  onCleanup(() => dispatchWindow({ type: "disposed" }))

  // Main missing (not loaded yet, failed, or not on this platform) answers that nothing can check or install.
  const act = (name: "check" | "install") =>
    dispatchWindow({ type: "action.requested", action: name, available: state() !== undefined })

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
      title: ctx.t(updaterAction(current, windowState()).label),
      busy: installing,
      run: () => act("install"),
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
      ]
    },
    render: () => (
      <Suspense>
        <Section
          action={() => updaterAction(state(), windowState())}
          run={() => {
            const run = updaterAction(state(), windowState()).run

            if (run) act(run)
          }}
        />
      </Suspense>
    ),
  })

  ctx.add(Command, (): Command => ({ id: "check", title: ctx.t("menu.check"), hidden: true, run: () => act("check") }))

  // Beta builds answer the app menu's Check for Updates in the focused window instead of a native dialog. The
  // listener follows main's updater across restarts.
  updater.on("check", () => act("check"))
}

/**
 * What's New after an update, on every platform: the release highlights since the version last seen. The first run
 * and a disabled What's New only remember the version.
 */
function whatsNew(ctx: SetupContext<typeof definition>) {
  const seen = ctx.stores.seen
  const controller = new AbortController()

  const start = initWhatsNew({
    version: ctx.app.version,
    previousVersion: seen.value.version,
    enabled: ctx.stores.releaseNotes.value.enabled,
  })

  let whatsNewState = start.state
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: WhatsNewEvent) => {
    const next = transitionWhatsNew(whatsNewState, event)

    whatsNewState = next.state
    next.effects.forEach(run)
  }

  const run = (effect: WhatsNewEffect) => {
    if (effect.type === "mark-seen")
      return seen.update((draft) => {
        draft.version = effect.version
      })

    if (effect.type === "abort-load") {
      clearTimeout(timer)
      controller.abort()

      return
    }

    if (effect.type === "open") return void open(effect.content)

    timer = setTimeout(() => dispatch({ type: "load.timed-out" }), effect.timeoutMs)
    void load(effect).then(
      (content) => dispatch({ type: "loaded", content }),
      () => dispatch({ type: "load.failed" }),
    )
  }

  const load = async (effect: Extract<WhatsNewEffect, { type: "load" }>): Promise<WhatsNewContent | undefined> => {
    const { loadWhatsNewHighlights } = await import("./whats-new")

    const highlights = await loadWhatsNewHighlights({
      previous: effect.previousVersion,
      current: effect.version,
      signal: controller.signal,
    })

    return { highlights }
  }

  // The chunk loaded with the notes, so this resolves at once.
  const open = async (content: WhatsNewContent) => {
    const { openWhatsNew } = await import("./whats-new")

    if (!ctx.signal.aborted) openWhatsNew(ctx, content.highlights)
  }

  start.effects.forEach(run)

  if (!whatsNewLoading(whatsNewState)) return

  // Turning release notes off in Settings while the notes load means they never open.
  createKeyed(
    () => !ctx.stores.releaseNotes.value.enabled,
    () => dispatch({ type: "disabled" }),
  )
  onCleanup(() => dispatch({ type: "disposed" }))
}

export default setup
