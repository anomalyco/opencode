import type {
  FormAnswer,
  FormField,
  IntegrationCommandConnectOutput,
  IntegrationInfo,
  IntegrationMethod,
  IntegrationOauthConnectOutput,
} from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { formatServerError } from "@/runtime/server/errors"
import { useData } from "@/runtime/server/current"
import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"

export type ProviderConnectMethod = Exclude<IntegrationMethod, { type: "env" }>

type Authorization = IntegrationOauthConnectOutput["data"]

type CommandAttempt = IntegrationCommandConnectOutput["data"]

type Polling = {
  generation: number
  timer?: ReturnType<typeof setTimeout>
  disposed: boolean
  // An attempt the server still considers open; cancelled when the dialog goes away.
  attempt?: { type: "oauth"; attemptID: string } | { type: "command"; attemptID: string }
}

// The OpenCode Console account is the `opencode` integration. OpenCode Go is its own integration
// and connects with its own methods, the same as the TUI.
export const CONSOLE_INTEGRATION = "opencode"

// Same order as the TUI: browser and command sign-ins first, API keys last.
export function connectMethods(integration: IntegrationInfo) {
  return integration.methods
    .filter((method): method is ProviderConnectMethod => method.type !== "env")
    .toSorted((a, b) => Number(a.type === "key") - Number(b.type === "key"))
}

export function providerFormDefaults(fields: ReadonlyArray<FormField> | undefined) {
  return (fields ?? []).reduce<FormAnswer>((answer, field) => {
    if (field.type === "external" || !field.hidden || field.default === undefined) return answer

    const active = (field.when ?? []).every((condition) => {
      const actual = answer[condition.key]

      if (actual === undefined) return false

      const equal = Array.isArray(actual) ? actual.some((item) => item === condition.value) : actual === condition.value

      return condition.op === "eq" ? equal : !equal
    })

    if (!active) return answer

    return Object.assign(answer, { [field.key]: field.default })
  }, {})
}

export function createProviderConnectionController(options: {
  provider: () => string
  directory: () => string | undefined
  onComplete: () => void
  /** Skips auto-selecting a lone method; the caller starts it. */
  manual?: () => boolean
  /** Runs after the catalogs refresh; returning false keeps the dialog on a retryable error. */
  prepare?: (active: () => boolean) => Promise<boolean>
  pollInterval?: number
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const serverSDK = useServerSDK()
  const data = useData()

  const location = () => {
    const directory = options.directory()

    return directory ? { directory } : undefined
  }

  const isConsole = () => options.provider() === CONSOLE_INTEGRATION

  // Not createResource: the dialog is owned by whichever page opened it, so reading a pending
  // resource here would suspend that page's <Suspense> and blank the screen behind the dialog.
  const [integration, setIntegration] = createStore<{ loading: boolean; latest?: IntegrationInfo }>({
    loading: true,
  })

  createEffect(
    on(
      () => ({ provider: options.provider(), directory: options.directory() }),
      (input) => {
        setIntegration({ loading: true, latest: undefined })
        serverSDK.api.integration
          .get({ integrationID: input.provider, location: location() })
          .then((result) => result.data)
          .catch(() => undefined)
          .then((latest) => {
            if (polling.disposed) return

            if (input.provider !== options.provider() || input.directory !== options.directory()) return
            setIntegration({ loading: false, latest })
          })
      },
    ),
  )

  const methods = createMemo<ProviderConnectMethod[]>(() => {
    const latest = integration.latest

    // An integration the server could not describe can still take an API key; one it describes
    // without interactive methods (environment only) has nothing to connect here.
    if (!latest) return [{ type: "key", label: language.t("provider.connect.method.apiKey") }]

    return connectMethods(latest)
  })

  const [store, setStore] = createStore<{
    methodIndex?: number
    authorization?: Authorization
    command?: { attempt: CommandAttempt; output: string }
    formAnswer?: FormAnswer
    // Nothing is in flight until a method is selected; `busy()` reads this, so a truthy initial
    // value would keep multi-method providers on the spinner instead of the method list.
    state?: "pending" | "waiting" | "refreshing" | "ready" | "error" | "form"
    error?: string
    auto: boolean
    connected: boolean
    browserFailed: boolean
    statusFailed: boolean
  }>({
    auto: false,
    // The credential is stored; a retry only needs to reload the catalogs.
    connected: false,
    browserFailed: false,
    // The attempt is still open on the server; a retry resumes polling it.
    statusFailed: false,
  })

  const polling: Polling = {
    generation: 0,
    disposed: false,
  }

  const currentMethod = createMemo(() =>
    store.methodIndex === undefined ? undefined : methods().at(store.methodIndex),
  )

  const autoIndex = createMemo(() => {
    if (integration.loading || options.manual?.()) return undefined

    return methods().length === 1 ? 0 : undefined
  })

  type Action =
    | { type: "method.select"; index: number }
    | { type: "method.reset" }
    | { type: "auth.form" }
    | { type: "auth.answer"; answer: FormAnswer | undefined }
    | { type: "auth.pending" }
    | { type: "auth.waiting"; authorization: Authorization }
    | { type: "command.waiting"; attempt: CommandAttempt }
    | { type: "auth.error"; error: string }

  const dispatch = (action: Action) => {
    setStore(
      produce((draft) => {
        if (action.type === "method.select" || action.type === "method.reset") {
          draft.methodIndex = action.type === "method.select" ? action.index : undefined
          draft.authorization = undefined
          draft.command = undefined
          draft.formAnswer = undefined
          draft.state = undefined
          draft.error = undefined
          draft.connected = false
          draft.browserFailed = false
          draft.statusFailed = false

          return
        }

        if (action.type === "auth.form") {
          draft.state = "form"
          draft.error = undefined

          return
        }

        if (action.type === "auth.answer") {
          draft.formAnswer = action.answer
          draft.state = undefined
          draft.error = undefined

          return
        }

        if (action.type === "auth.pending") {
          draft.state = "pending"
          draft.error = undefined

          return
        }

        if (action.type === "auth.waiting") {
          draft.state = "waiting"
          draft.authorization = action.authorization
          draft.error = undefined

          return
        }

        if (action.type === "command.waiting") {
          draft.state = "waiting"
          draft.command = { attempt: action.attempt, output: "" }
          draft.error = undefined

          return
        }

        draft.state = "error"
        draft.error = action.error
      }),
    )
  }

  const cancelAttempt = () => {
    const attempt = polling.attempt
    polling.attempt = undefined

    if (!attempt) return
    const input = { integrationID: options.provider(), attemptID: attempt.attemptID, location: location() }

    if (attempt.type === "command") {
      void serverSDK.api.integration.command.cancel(input).catch(() => undefined)

      return
    }

    void serverSDK.api.integration.oauth.cancel(input).catch(() => undefined)
  }

  const cancelPolling = () => {
    polling.generation++

    if (polling.timer === undefined) return
    clearTimeout(polling.timer)
    polling.timer = undefined
  }

  const finish = async () => {
    cancelPolling()
    polling.attempt = undefined
    const generation = polling.generation
    const active = () => !polling.disposed && generation === polling.generation
    setStore({ connected: true, state: "refreshing", error: undefined })
    const ref = location()
    data.location.integration.invalidate(ref)
    data.location.provider.invalidate(ref)
    data.location.model.invalidate(ref)

    const refreshed = await Promise.all([
      data.location.integration.sync(ref),
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
    ])
      .then(() => true)
      .catch(() => false)

    if (!active()) return
    const prepared = refreshed && options.prepare ? await options.prepare(active) : refreshed

    if (!active()) return

    if (!prepared && options.prepare) {
      dispatch({ type: "auth.error", error: language.t("provider.connect.console.refreshFailed") })

      return
    }

    setStore("state", "ready")
    options.onComplete()
  }

  const poll = async (authorization: Authorization, generation: number) => {
    const result = await serverSDK.api.integration.oauth
      .status({
        integrationID: options.provider(),
        attemptID: authorization.attemptID,
        location: location(),
      })
      .then((response) => ({ ok: true as const, status: response.data }))
      .catch((error) => ({ ok: false as const, error }))

    if (polling.disposed || generation !== polling.generation) return

    if (!result.ok) {
      setStore("statusFailed", true)
      dispatch({
        type: "auth.error",
        error: isConsole()
          ? language.t("provider.connect.console.statusFailed")
          : formatServerError(result.error, language.t),
      })

      return
    }

    if (result.status.status === "complete") {
      await finish()

      return
    }

    if (result.status.status === "failed") {
      polling.attempt = undefined
      const message = result.status.message
      dispatch({
        type: "auth.error",
        error:
          isConsole() && message.includes("expired_token")
            ? language.t("provider.connect.console.expired")
            : isConsole() && message.includes("access_denied")
              ? language.t("provider.connect.console.denied")
              : message,
      })

      return
    }

    if (result.status.status === "expired") {
      polling.attempt = undefined
      dispatch({
        type: "auth.error",
        error: language.t(isConsole() ? "provider.connect.console.expired" : "provider.connect.oauth.expired"),
      })

      return
    }

    polling.timer = setTimeout(() => void poll(authorization, generation), options.pollInterval ?? 1_000)
  }

  const pollCommand = async (attempt: CommandAttempt, generation: number) => {
    const result = await serverSDK.api.integration.command
      .status({ integrationID: options.provider(), attemptID: attempt.attemptID, location: location() })
      .then((response) => ({ ok: true as const, status: response.data }))
      .catch((error) => ({ ok: false as const, error }))

    if (polling.disposed || generation !== polling.generation) return

    if (!result.ok) {
      polling.attempt = undefined
      dispatch({ type: "auth.error", error: formatServerError(result.error, language.t) })

      return
    }

    if (result.status.status === "pending") {
      setStore("command", "output", result.status.message ?? "")
      polling.timer = setTimeout(() => void pollCommand(attempt, generation), 500)

      return
    }

    polling.attempt = undefined

    if (result.status.status === "complete") {
      await finish()

      return
    }

    dispatch({
      type: "auth.error",
      error: result.status.status === "failed" ? result.status.message : language.t("provider.connect.command.expired"),
    })
  }

  const open = async () => {
    const url = store.authorization?.url

    if (!url) return
    const generation = polling.generation

    const opened = await Promise.resolve()
      .then(() => {
        if (platform.openBrowser) return platform.openBrowser(url)
        platform.openExternal(url)

        return true
      })
      .catch(() => false)

    if (polling.disposed || generation !== polling.generation) return
    setStore("browserFailed", !opened)
  }

  const select = async (index: number, answer?: FormAnswer) => {
    cancelPolling()
    cancelAttempt()
    const generation = polling.generation
    const selected = methods()[index]
    dispatch({ type: "method.select", index })
    const form = selected.type === "command" ? undefined : selected.form
    const visible = (form ?? []).some((field) => field.type === "external" || !field.hidden)

    if (visible && !answer) {
      dispatch({ type: "auth.form" })

      return
    }

    const merged = { ...providerFormDefaults(form), ...answer }

    if (selected.type === "key") {
      dispatch({ type: "auth.answer", answer: Object.keys(merged).length ? merged : undefined })

      return
    }

    dispatch({ type: "auth.pending" })

    if (selected.type === "command") {
      const started = await serverSDK.api.integration.command
        .connect({ integrationID: options.provider(), methodID: selected.id, location: location() })
        .then((response) => ({ ok: true as const, attempt: response.data }))
        .catch((error) => ({ ok: false as const, error }))

      if (polling.disposed || generation !== polling.generation) {
        if (started.ok)
          void serverSDK.api.integration.command
            .cancel({ integrationID: options.provider(), attemptID: started.attempt.attemptID, location: location() })
            .catch(() => undefined)

        return
      }

      if (!started.ok) {
        dispatch({ type: "auth.error", error: formatServerError(started.error, language.t) })

        return
      }

      polling.attempt = { type: "command", attemptID: started.attempt.attemptID }
      dispatch({ type: "command.waiting", attempt: started.attempt })
      void pollCommand(started.attempt, generation)

      return
    }

    if (selected.type === "external") {
      const saved = await serverSDK.api.integration.connect
        .external({
          integrationID: options.provider(),
          methodID: selected.id,
          answer: Object.keys(merged).length ? merged : undefined,
          location: location(),
        })
        .then(() => ({ ok: true as const }))
        .catch((error) => ({ ok: false as const, error }))

      if (polling.disposed || generation !== polling.generation) return

      if (!saved.ok) {
        dispatch({ type: "auth.error", error: formatServerError(saved.error, language.t) })

        return
      }

      await finish()

      return
    }

    const result = await serverSDK.api.integration.oauth
      .connect({
        integrationID: options.provider(),
        methodID: selected.id,
        answer: Object.keys(merged).length ? merged : undefined,
        location: location(),
      })
      .then((response) => {
        if (isConsole() && platform.platform === "desktop") {
          const url = new URL(response.data.url)
          url.searchParams.set("client_id", "opencode-desktop")
          // Lets the Console return link focus the window that started the sign-in.
          url.searchParams.set("return_window", platform.windowID)
          response.data.url = url.href
        }

        return { ok: true as const, authorization: response.data }
      })
      .catch((error) => ({ ok: false as const, error }))

    if (polling.disposed || generation !== polling.generation) {
      if (result.ok)
        void serverSDK.api.integration.oauth
          .cancel({
            integrationID: options.provider(),
            attemptID: result.authorization.attemptID,
            location: location(),
          })
          .catch(() => undefined)

      return
    }

    if (!result.ok) {
      dispatch({
        type: "auth.error",
        error: isConsole()
          ? language.t("provider.connect.console.startFailed")
          : formatServerError(result.error, language.t),
      })

      return
    }

    polling.attempt = { type: "oauth", attemptID: result.authorization.attemptID }
    dispatch({ type: "auth.waiting", authorization: result.authorization })
    // Same as `opencode auth login`: hand the user straight to the browser instead of
    // asking them to click a link and retype a code.
    void open()

    if (result.authorization.mode === "auto") void poll(result.authorization, generation)
  }

  const retry = async () => {
    if (store.connected) return finish()
    const authorization = store.authorization

    if (store.statusFailed && authorization) {
      polling.attempt = { type: "oauth", attemptID: authorization.attemptID }
      setStore({ state: "waiting", error: undefined, statusFailed: false })

      return poll(authorization, polling.generation)
    }

    const index = store.methodIndex

    if (index === undefined) return

    return select(index, store.formAnswer)
  }

  const reset = () => {
    cancelPolling()
    cancelAttempt()
    dispatch({ type: "method.reset" })
  }

  const connectKey = async (key: string) => {
    await serverSDK.api.integration.connect.key({
      integrationID: options.provider(),
      location: location(),
      key,
      answer: store.formAnswer,
    })
    await finish()
  }

  const completeCode = async (code: string) => {
    const authorization = store.authorization

    if (!authorization) return language.t("provider.connect.oauth.code.invalid")

    const result = await serverSDK.api.integration.oauth
      .complete({
        integrationID: options.provider(),
        attemptID: authorization.attemptID,
        location: location(),
        code,
      })
      .then(() => ({ ok: true as const }))
      .catch((error) => ({ ok: false as const, error }))

    if (!result.ok)
      return formatServerError(result.error, language.t, language.t("provider.connect.oauth.code.invalid"))
    await finish()

    return undefined
  }

  createEffect(() => {
    const index = autoIndex()

    if (store.auto || index === undefined) return
    setStore("auto", true)
    void select(index)
  })
  onCleanup(() => {
    polling.disposed = true
    cancelPolling()
    cancelAttempt()
  })

  return {
    loading: () => integration.loading,
    integration: () => integration.latest,
    methods,
    currentMethod,
    methodIndex: () => store.methodIndex,
    authorization: () => store.authorization,
    command: () => store.command,
    browserFailed: () => store.browserFailed,
    // True while nothing useful can be shown yet: the integration is loading, a method is
    // about to be picked automatically, the authorization request is in flight, or an external
    // method, which has no view of its own, is refreshing the catalogs after saving.
    busy: () =>
      integration.loading ||
      (store.methodIndex === undefined && !store.auto && autoIndex() !== undefined) ||
      store.state === "pending" ||
      (store.state === "refreshing" && currentMethod()?.type === "external"),
    auth: {
      state: () => store.state,
      error: () => store.error,
      select,
      reset,
      retry,
      open,
      refresh: finish,
      connectKey,
      completeCode,
    },
  }
}
