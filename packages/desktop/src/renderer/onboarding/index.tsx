import { ServerConnection, useCurrentRoute, useGlobal, useLanguage, useServers, useTabs } from "@opencode/app/desktop"
import { showToast } from "@opencode/ui/toast"
import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import type { ElectronAPI } from "../api-types"
import type { StartupEvent } from "../startup/machine"
import {
  createOnboardingState,
  selectOnboardingWaiting,
  transitionOnboarding,
  type OnboardingEffect,
  type OnboardingEvent,
} from "./machine"

export function DesktopFirstLaunchOnboarding(props: {
  api: ElectronAPI
  initialUrl: string
  pending: boolean
  /** Startup already shows the app. */
  revealed: boolean
  dispatch: (event: StartupEvent) => void
}) {
  const server = useServers()
  const global = useGlobal()
  const tabs = useTabs()
  const route = useCurrentRoute()
  const language = useLanguage()
  const sidecar = ServerConnection.Key.make("sidecar")

  type Draft = Awaited<ReturnType<typeof tabs.newDraft>>

  // Read once: the window runs onboarding or it does not.
  const [state, setState] = createSignal(createOnboardingState(untrack(() => props.pending)))
  // Events an effect raises wait until every effect of the event before them ran.
  const queue: OnboardingEvent<Draft>[] = []

  const revealed = () => untrack(() => props.revealed)
  const canOpenDraft = () => untrack(() => route().type === "home" && tabs.store.length === 0)

  const dispatch = (event: OnboardingEvent<Draft>) => {
    queue.push(event)

    if (queue.length === 1) drain()
  }

  const drain = () => {
    const event = queue[0]

    if (!event) return

    try {
      const next = transitionOnboarding(untrack(state), event)
      setState(next.state)
      // Each effect runs on its own, so one that throws cannot keep the rest from running.
      next.effects.forEach((effect) =>
        Promise.try(() => run(effect)).catch((error) =>
          console.error("[desktop-onboarding] effect failed", { effect: effect.type, error }),
        ),
      )
    } finally {
      queue.shift()
    }

    drain()
  }

  const run = (effect: OnboardingEffect<Draft>) => {
    switch (effect.type) {
      case "finish-onboarding":
        console.info("[desktop-onboarding] first launch onboarding evaluated", {
          pending: true,
          shouldTrigger: effect.shouldTrigger,
          initialUrl: props.initialUrl,
          tabs: tabs.store.length,
          servers: server.list.map(ServerConnection.key),
        })

        return void props.api.finishFirstLaunchOnboarding(effect.shouldTrigger).then(
          (directory) => dispatch({ type: "finish.succeeded", directory }),
          (error) => dispatch({ type: "finish.failed", error, revealed: revealed() }),
        )

      case "seed-project": {
        console.info("[desktop-onboarding] starting first launch draft", { directory: effect.directory })
        const directory = effect.directory

        // Load the initial provider/model state before the draft transition exposes the composer.
        return void Promise.try(() => {
          const ctx = global.serverCtx(sidecar)

          if (!ctx) return

          return Promise.all([
            ctx.projects.add(directory),
            ctx.data.location.provider.sync({ directory }),
            ctx.data.location.model.sync({ directory }),
          ])
        }).then(
          () => dispatch({ type: "seed.succeeded", revealed: revealed(), canOpenDraft: canOpenDraft() }),
          (error) => dispatch({ type: "seed.failed", error, revealed: revealed() }),
        )
      }

      case "open-draft":
        return void tabs.newDraft({ server: sidecar, directory: effect.directory }).then(
          (tab) => dispatch({ type: "draft.succeeded", tab, revealed: revealed() }),
          (error) => dispatch({ type: "draft.failed", error, revealed: revealed() }),
        )

      case "select-draft":
        return tabs.select(effect.tab)

      case "notify-settled":
        return props.dispatch({ type: "onboarding.settled" })

      // A failure before the app shows reaches its recovery screen.
      case "fail-startup":
        return props.dispatch({ type: "startup.failed", error: effect.error })

      case "show-error-toast":
        return showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: effect.error instanceof Error ? effect.error.message : String(effect.error),
          duration: 10_000,
        })
    }
  }

  createEffect(() => {
    if (!selectOnboardingWaiting(state()) || !tabs.ready() || !tabs.recentReady()) return

    dispatch({
      type: "tabs.hydrated",
      shouldTrigger: untrack(
        () =>
          props.initialUrl === "/" &&
          route().type === "home" &&
          tabs.store.length === 0 &&
          server.list.every(ServerConnection.builtin),
      ),
    })
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return null
}
