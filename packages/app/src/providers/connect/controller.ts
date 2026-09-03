import type { FormAnswer, IntegrationMethod, IntegrationOauthConnectOutput } from "@opencode-ai/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { createEffect, createMemo, createResource, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { providerAuthUrl } from "./url"

export type ProviderConnectMethod = Extract<IntegrationMethod, { type: "key" | "oauth" }>
type Authorization = IntegrationOauthConnectOutput["data"]

export function createProviderConnectionController(options: {
  provider: () => string
  directory: () => string | undefined
  onComplete: () => void
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
  const [integration] = createResource(
    () => ({ provider: options.provider(), directory: options.directory() }),
    (input) =>
      serverSDK.api.integration
        .get({ integrationID: input.provider, location: location() })
        .then((result) => result.data),
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
    state: "pending" as "pending" | "complete" | "error" | "form" | undefined,
    error: undefined as string | undefined,
  })
  const polling = {
    generation: 0,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    disposed: false,
  }
  const currentMethod = createMemo(() =>
    store.methodIndex === undefined ? undefined : methods().at(store.methodIndex),
  )

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

  const cancelPolling = () => {
    polling.generation++
    if (polling.timer === undefined) return
    clearTimeout(polling.timer)
    polling.timer = undefined
  }
  const finish = async () => {
    cancelPolling()
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
      dispatch({ type: "auth.error", error: result.status.message })
      return
    }
    if (result.status.status === "expired") {
      dispatch({ type: "auth.error", error: language.t("common.requestFailed") })
      return
    }
    polling.timer = setTimeout(() => void poll(authorization, generation), options.pollInterval ?? 1_000)
  }
  const select = async (index: number, answer?: FormAnswer) => {
    cancelPolling()
    const generation = polling.generation
    const selected = methods()[index]
    dispatch({ type: "method.select", index })
    if (selected.form?.length && !answer) {
      dispatch({ type: "auth.form" })
      return
    }
    if (selected.type === "key") {
      dispatch({ type: "auth.answer", answer })
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
        ...(answer ? { answer } : {}),
        location: location(),
      })
      .then((response) => ({
        ok: true as const,
        authorization: {
          ...response.data,
          url: providerAuthUrl(response.data.url, options.provider(), platform.platform),
        },
      }))
      .catch((error) => ({ ok: false as const, error }))
    if (polling.disposed || generation !== polling.generation) return
    if (!result.ok) {
      dispatch({ type: "auth.error", error: String(result.error) })
      return
    }
    dispatch({ type: "auth.complete", authorization: result.authorization })
    if (result.authorization.mode === "auto") void poll(result.authorization, generation)
  }
  const reset = () => {
    cancelPolling()
    dispatch({ type: "method.reset" })
  }
  const connectKey = async (key: string) => {
    await serverSDK.api.integration.connect.key({
      integrationID: options.provider(),
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

  let auto = false
  createEffect(() => {
    if (auto || integration.loading || methods().length !== 1) return
    auto = true
    void select(0)
  })
  onCleanup(() => {
    polling.disposed = true
    cancelPolling()
  })

  return {
    loading: () => integration.loading,
    integration: () => integration.latest,
    methods,
    currentMethod,
    methodIndex: () => store.methodIndex,
    authorization: () => store.authorization,
    auth: {
      state: () => store.state,
      error: () => store.error,
      select,
      reset,
      connectKey,
      completeCode,
    },
  }
}

export type ProviderConnectionController = ReturnType<typeof createProviderConnectionController>
