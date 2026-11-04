import type { FormAnswer } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useData } from "@/runtime/server/current"
import { createMemo, createSignal, onCleanup, untrack } from "solid-js"
import {
  connectMethods,
  selectProviderConnectView,
  startProviderConnect,
  transitionProviderConnect,
  type ProviderConnectEffect,
  type ProviderConnectEvent,
  type ProviderConnectMethod,
} from "./machine"

// The OpenCode Console account is the `opencode` integration. OpenCode Go is its own integration
// and connects with its own methods, the same as the TUI.
export const CONSOLE_INTEGRATION = "opencode"

export const CLAUDE_AGENT_INTEGRATION = "claude-agent"

export function createProviderConnectionController(options: {
  provider: string
  directory?: string
  onComplete: (method: ProviderConnectMethod) => void
  /** Skips auto-selecting a lone method; the caller starts it. */
  manual?: () => boolean
  /** Runs after the catalogs refresh; returning false keeps the dialog on a retryable error. */
  prepare?: (method: ProviderConnectMethod, active: () => boolean) => Promise<boolean>
  pollInterval?: number
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const data = useData()
  const location = options.directory ? { directory: options.directory } : undefined
  const isConsole = options.provider === CONSOLE_INTEGRATION
  const initial = startProviderConnect()
  // Not createResource: the dialog is owned by whichever page opened it, so reading a pending
  // resource here would suspend that page's <Suspense> and blank the screen behind the dialog.
  const [state, setState] = createSignal(initial.state)
  const view = createMemo(() => selectProviderConnectView(state()))
  // The machine decides when polling stops; this only holds the timer so `poll.stop` can clear it.
  let pollTimer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ProviderConnectEvent) => {
    const result = transitionProviderConnect(untrack(state), event)
    setState(result.state)
    result.effects.forEach(run)
  }

  const run = (effect: ProviderConnectEffect) => {
    if (effect.type === "load") {
      void serverSDK.api.integration
        .get({ integrationID: options.provider, location })
        .then((result) => result.data)
        .catch(() => undefined)
        .then((integration) =>
          dispatch({
            type: "integration.loaded",
            attempt: effect.attempt,
            // An integration the server could not describe can still take an API key; one it describes
            // without interactive methods (environment only) has nothing to connect here.
            catalog: {
              integration,
              methods: integration
                ? connectMethods(integration)
                : [{ type: "key", label: language.t("provider.connect.method.apiKey") }],
            },
            manual: !!options.manual?.(),
          }),
        )

      return
    }

    if (effect.type === "start") return start(effect)

    if (effect.type === "open.browser") {
      void Promise.resolve()
        .then(() => {
          if (platform.openBrowser) return platform.openBrowser(effect.url)
          platform.openExternal(effect.url)

          return true
        })
        .catch(() => false)
        .then((opened) => dispatch({ type: "browser.opened", attemptID: effect.attemptID, opened }))

      return
    }

    if (effect.type === "poll") {
      clearTimeout(pollTimer)
      pollTimer = undefined

      if (!effect.delay) return poll(effect)
      const interval = effect.signIn.kind === "command" ? 500 : (options.pollInterval ?? 1_000)
      pollTimer = setTimeout(() => poll(effect), interval)

      return
    }

    if (effect.type === "poll.stop") {
      clearTimeout(pollTimer)
      pollTimer = undefined

      return
    }

    if (effect.type === "cancel") {
      const input = { integrationID: options.provider, attemptID: effect.attemptID, location }
      const cancel: Promise<unknown> =
        effect.target === "command"
          ? serverSDK.api.integration.command.cancel(input)
          : serverSDK.api.integration.oauth.cancel(input)
      void cancel.catch(() => undefined)

      return
    }

    if (effect.type === "submit") {
      const request: Promise<unknown> =
        effect.signIn.kind === "key"
          ? serverSDK.api.integration.connect.key({
              integrationID: options.provider,
              location,
              key: effect.value,
              answer: effect.answer,
            })
          : serverSDK.api.integration.oauth.complete({
              integrationID: options.provider,
              attemptID: effect.signIn.authorization.attemptID,
              location,
              code: effect.value,
            })
      const fallback = effect.signIn.kind === "code" ? language.t("provider.connect.oauth.code.invalid") : undefined
      void request.then(
        () => dispatch({ type: "submit.succeeded", attempt: effect.attempt }),
        (error) =>
          dispatch({
            type: "submit.failed",
            attempt: effect.attempt,
            error: formatServerError(error, language.t, fallback),
          }),
      )

      return
    }

    if (effect.type === "refresh") return void refresh(effect)

    options.onComplete(effect.method)
  }

  const start = (effect: Extract<ProviderConnectEffect, { type: "start" }>) => {
    const failed = (error: unknown) =>
      dispatch({ type: "start.failed", attempt: effect.attempt, error: formatServerError(error, language.t) })

    if (effect.method.type === "command") {
      void serverSDK.api.integration.command
        .connect({ integrationID: options.provider, methodID: effect.method.id, location })
        .then(
          (response) => dispatch({ type: "command.started", attempt: effect.attempt, command: response.data }),
          failed,
        )

      return
    }

    const input = { integrationID: options.provider, methodID: effect.method.id, answer: effect.answer, location }

    if (effect.method.type === "external") {
      void serverSDK.api.integration.connect
        .external(input)
        .then(() => dispatch({ type: "external.saved", attempt: effect.attempt }), failed)

      return
    }

    void serverSDK.api.integration.oauth.connect(input).then(
      (response) => {
        if (!isConsole || platform.platform !== "desktop")
          return dispatch({ type: "oauth.started", attempt: effect.attempt, authorization: response.data })
        const url = new URL(response.data.url)
        url.searchParams.set("client_id", "opencode-desktop")
        // Lets the Console return link focus the window that started the sign-in.
        url.searchParams.set("return_window", platform.windowID)
        dispatch({ type: "oauth.started", attempt: effect.attempt, authorization: { ...response.data, url: url.href } })
      },
      (error) =>
        isConsole
          ? dispatch({
              type: "start.failed",
              attempt: effect.attempt,
              error: language.t("provider.connect.console.startFailed"),
            })
          : failed(error),
    )
  }

  const poll = (effect: Extract<ProviderConnectEffect, { type: "poll" }>) => {
    const polled = (outcome: Extract<ProviderConnectEvent, { type: "polled" }>["outcome"]) =>
      dispatch({ type: "polled", attempt: effect.attempt, outcome })

    if (effect.signIn.kind === "command") {
      void serverSDK.api.integration.command
        .status({ integrationID: options.provider, attemptID: effect.signIn.command.attemptID, location })
        .then(
          (response) => {
            const status = response.data

            if (status.status === "pending") return polled({ status: "pending", output: status.message ?? "" })

            if (status.status === "complete") return polled({ status: "complete" })

            polled({
              status: "failed",
              error: status.status === "failed" ? status.message : language.t("provider.connect.command.expired"),
            })
          },
          (error) => polled({ status: "failed", error: formatServerError(error, language.t) }),
        )

      return
    }

    void serverSDK.api.integration.oauth
      .status({ integrationID: options.provider, attemptID: effect.signIn.authorization.attemptID, location })
      .then(
        (response) => {
          const status = response.data

          if (status.status === "pending") return polled({ status: "pending" })

          if (status.status === "complete") return polled({ status: "complete" })

          if (status.status === "expired")
            return polled({
              status: "failed",
              error: language.t(isConsole ? "provider.connect.console.expired" : "provider.connect.oauth.expired"),
            })

          polled({
            status: "failed",
            error:
              isConsole && status.message.includes("expired_token")
                ? language.t("provider.connect.console.expired")
                : isConsole && status.message.includes("access_denied")
                  ? language.t("provider.connect.console.denied")
                  : status.message,
          })
        },
        (error) =>
          polled({
            status: "unreachable",
            error: isConsole
              ? language.t("provider.connect.console.statusFailed")
              : formatServerError(error, language.t),
          }),
      )
  }

  const refresh = async (effect: Extract<ProviderConnectEffect, { type: "refresh" }>) => {
    data.location.integration.invalidate(location)
    data.location.provider.invalidate(location)
    data.location.model.invalidate(location)

    const refreshed = await Promise.all([
      data.location.integration.sync(location),
      data.location.provider.sync(location),
      data.location.model.sync(location),
    ])
      .then(() => true)
      .catch(() => false)

    if (!options.prepare) return dispatch({ type: "refresh.succeeded", attempt: effect.attempt })

    const active = () => {
      const current = state()

      return current.status === "refreshing" && current.attempt === effect.attempt
    }

    if (refreshed && (await options.prepare(effect.method, active)))
      return dispatch({ type: "refresh.succeeded", attempt: effect.attempt })

    dispatch({
      type: "refresh.failed",
      attempt: effect.attempt,
      error: language.t("provider.connect.console.refreshFailed"),
    })
  }

  initial.effects.forEach(run)
  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    view,
    select: (index: number) => dispatch({ type: "method.selected", index }),
    answer: (answer: FormAnswer) => dispatch({ type: "form.submitted", answer }),
    submit: (value: string) => dispatch({ type: "entry.submitted", value }),
    openBrowser: () => dispatch({ type: "browser.open" }),
    retry: () => dispatch({ type: "retry" }),
    refresh: () => dispatch({ type: "refresh" }),
    back: () => dispatch({ type: "back" }),
  }
}
