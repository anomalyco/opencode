import type {
  FormAnswer,
  IntegrationInfo,
  IntegrationMethod,
  IntegrationOauthConnectOutput,
} from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"

export type ProviderConnectMethod = Extract<IntegrationMethod, { type: "key" | "oauth" }>
type Authorization = IntegrationOauthConnectOutput["data"]

// OpenCode Go and OpenCode Zen both bill through the OpenCode Console, so the
// Console sign-in is the connection method for both providers.
export const CONSOLE_INTEGRATION = "opencode"
export const CONSOLE_PROVIDERS = new Set(["opencode", "opencode-go"])

export function consoleIntegration(provider: string) {
  return CONSOLE_PROVIDERS.has(provider) ? CONSOLE_INTEGRATION : provider
}

function hiddenDefaults(method: ProviderConnectMethod | undefined) {
  return Object.fromEntries(
    (method?.form ?? []).flatMap((field) =>
      field.type !== "external" && field.hidden && field.default !== undefined ? [[field.key, field.default]] : [],
    ),
  ) as FormAnswer
}

export function createProviderConnectionController(options: {
  provider: () => string
  /** Integration that stores API keys when it differs from the one that lists methods and runs OAuth. */
  keyProvider?: () => string
  directory: () => string | undefined
  onComplete: () => void
  /** Picks the method to start without asking when the integration exposes several. */
  autoSelect?: (methods: ProviderConnectMethod[]) => number | undefined
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
  // Not createResource: the dialog is owned by whichever page opened it, so reading a pending
  // resource here would suspend that page's <Suspense> and blank the screen behind the dialog.
  const [integration, setIntegration] = createStore({
    loading: true,
    latest: undefined as IntegrationInfo | undefined,
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
    const values = integration.latest?.methods.filter(
      (method): method is ProviderConnectMethod => method.type === "key" || method.type === "oauth",
    )
    if (values?.length) return [...values]
    return [{ type: "key", label: language.t("provider.connect.method.apiKey") }]
  })
  const [store, setStore] = createStore({
    methodIndex: undefined as number | undefined,
    authorization: undefined as Authorization | undefined,
    formAnswer: undefined as FormAnswer | undefined,
    // Nothing is in flight until a method is selected; `busy()` reads this, so a truthy initial
    // value would keep multi-method providers on the spinner instead of the method list.
    state: undefined as "pending" | "complete" | "error" | "form" | undefined,
    error: undefined as string | undefined,
    auto: false,
  })
  const polling = {
    generation: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    disposed: false,
    // An attempt the server still considers open; cancelled when the dialog goes away.
    attempt: undefined as Authorization | undefined,
  }
  const currentMethod = createMemo(() =>
    store.methodIndex === undefined ? undefined : methods().at(store.methodIndex),
  )
  const autoIndex = createMemo(() => {
    if (integration.loading) return undefined
    const values = methods()
    if (values.length === 1) return 0
    return options.autoSelect?.(values)
  })

  type Action =
    | { type: "method.select"; index: number }
    | { type: "method.reset" }
    | { type: "auth.form" }
    | { type: "auth.answer"; answer: FormAnswer | undefined }
    | { type: "auth.pending" }
    | { type: "auth.complete"; authorization: Authorization }
    | { type: "auth.error"; error: string }

  const dispatch = (action: Action) => {
    setStore(
      produce((draft) => {
        if (action.type === "method.select") {
          draft.methodIndex = action.index
          draft.authorization = undefined
          draft.formAnswer = undefined
          draft.state = undefined
          draft.error = undefined
          return
        }
        if (action.type === "method.reset") {
          draft.methodIndex = undefined
          draft.authorization = undefined
          draft.formAnswer = undefined
          draft.state = undefined
          draft.error = undefined
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
        if (action.type === "auth.complete") {
          draft.state = "complete"
          draft.authorization = action.authorization
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
    void serverSDK.api.integration.oauth
      .cancel({ integrationID: options.provider(), attemptID: attempt.attemptID, location: location() })
      .catch(() => undefined)
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
    const ref = location()
    data.location.integration.invalidate(ref)
    data.location.provider.invalidate(ref)
    data.location.model.invalidate(ref)
    await Promise.all([
      data.location.integration.sync(ref),
      data.location.provider.sync(ref),
      data.location.model.sync(ref),
    ]).catch(() => undefined)
    if (polling.disposed) return
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
      polling.attempt = undefined
      dispatch({
        type: "auth.error",
        error: result.error instanceof Error ? result.error.message : String(result.error),
      })
      return
    }
    if (result.status.status === "complete") {
      await finish()
      return
    }
    if (result.status.status === "failed") {
      polling.attempt = undefined
      dispatch({ type: "auth.error", error: result.status.message })
      return
    }
    if (result.status.status === "expired") {
      polling.attempt = undefined
      dispatch({ type: "auth.error", error: language.t("provider.connect.oauth.expired") })
      return
    }
    polling.timer = setTimeout(() => void poll(authorization, generation), options.pollInterval ?? 1_000)
  }
  const open = () => {
    const url = store.authorization?.url
    if (url) platform.openExternal(url)
  }
  const select = async (index: number, answer?: FormAnswer) => {
    cancelPolling()
    cancelAttempt()
    const generation = polling.generation
    const selected = methods()[index]
    dispatch({ type: "method.select", index })
    const visible = (selected.form ?? []).some((field) => field.type === "external" || !field.hidden)
    if (visible && !answer) {
      dispatch({ type: "auth.form" })
      return
    }
    const merged = { ...hiddenDefaults(selected), ...answer }
    if (selected.type === "key") {
      dispatch({ type: "auth.answer", answer: Object.keys(merged).length ? merged : undefined })
      return
    }
    if (selected.type !== "oauth") return
    if (selected.form?.some((field) => field.type !== "string")) {
      dispatch({ type: "auth.error", error: "This authentication form contains unsupported fields" })
      return
    }
    dispatch({ type: "auth.pending" })
    const result = await serverSDK.api.integration.oauth
      .connect({
        integrationID: options.provider(),
        methodID: selected.id,
        ...(Object.keys(merged).length ? { answer: merged } : {}),
        location: location(),
      })
      .then((response) => {
        if (options.provider() === CONSOLE_INTEGRATION && platform.platform === "desktop") {
          const url = new URL(response.data.url)
          url.searchParams.set("client_id", "opencode-desktop")
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
        error: result.error instanceof Error ? result.error.message : String(result.error),
      })
      return
    }
    polling.attempt = result.authorization
    dispatch({ type: "auth.complete", authorization: result.authorization })
    // Same as `opencode auth login`: hand the user straight to the browser instead of
    // asking them to click a link and retype a code.
    platform.openExternal(result.authorization.url)
    if (result.authorization.mode === "auto") void poll(result.authorization, generation)
  }
  const retry = () => {
    const index = store.methodIndex
    if (index === undefined) return
    void select(index, store.formAnswer)
  }
  const reset = () => {
    cancelPolling()
    cancelAttempt()
    dispatch({ type: "method.reset" })
  }
  const connectKey = async (key: string) => {
    await serverSDK.api.integration.connect.key({
      integrationID: options.keyProvider?.() ?? options.provider(),
      location: location(),
      key,
      ...(store.formAnswer ? { answer: store.formAnswer } : {}),
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
    if (!result.ok) {
      const message = result.error instanceof Error ? result.error.message : String(result.error)
      return message || language.t("provider.connect.oauth.code.invalid")
    }
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
    // True while nothing useful can be shown yet: the integration is loading, a method is
    // about to be picked automatically, or the authorization request is in flight.
    busy: () =>
      integration.loading ||
      (store.methodIndex === undefined && !store.auto && autoIndex() !== undefined) ||
      store.state === "pending",
    auth: {
      state: () => store.state,
      error: () => store.error,
      select,
      reset,
      retry,
      open,
      connectKey,
      completeCode,
    },
  }
}

export type ProviderConnectionController = ReturnType<typeof createProviderConnectionController>
