import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@opencode-ai/sdk/v2/client"
import { createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { showToast } from "@/utils/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { formatServerError } from "@/utils/server-errors"

type ConnectState =
  | { type: "select" }
  | { type: "api"; methodIndex: number; metadata?: Record<string, string> }
  | { type: "prompt"; methodIndex: number }
  | { type: "pending"; methodIndex: number }
  | { type: "authorized"; methodIndex: number; authorization: ProviderAuthAuthorization }
  | { type: "error"; methodIndex?: number; message: string }

type ConnectScreen =
  | { type: "loading" }
  | { type: "select"; methods: ProviderAuthMethod[] }
  | { type: "api"; method: ProviderAuthMethod }
  | { type: "prompts"; method: ProviderAuthMethod; prompts: NonNullable<ProviderAuthMethod["prompts"]> }
  | { type: "pending"; method?: ProviderAuthMethod }
  | { type: "oauthCode"; method: ProviderAuthMethod; authorization: ProviderAuthAuthorization }
  | { type: "oauthAuto"; method: ProviderAuthMethod; authorization: ProviderAuthAuthorization; code?: string }
  | { type: "error"; method?: ProviderAuthMethod; message: string }

export function useConnectProvider(providerID: string) {
  const dialog = useDialog()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const providers = useProviders()
  const alive = { value: true }
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }
  const [state, setState] = createSignal<ConnectState>({ type: "select" })

  const provider = createMemo(() => providers.all().get(providerID) ?? serverSync.data.provider.all.get(providerID)!)
  const fallback = createMemo<ProviderAuthMethod[]>(() => [
    {
      type: "api",
      label: language.t("provider.connect.method.apiKey"),
    },
  ])
  const [auth] = createResource(
    () => providerID,
    async () => {
      const cached = serverSync.data.provider_auth[providerID]
      if (cached) return cached
      const response = await serverSDK.client.provider.auth()
      if (!alive.value) return fallback()
      serverSync.set("provider_auth", response.data ?? {})
      return response.data?.[providerID] ?? fallback()
    },
  )
  const loading = createMemo(() => auth.loading && !serverSync.data.provider_auth[providerID])
  const methods = createMemo(() => auth.latest ?? serverSync.data.provider_auth[providerID] ?? fallback())
  const methodIndex = createMemo(() => {
    const current = state()
    if (current.type === "select") return
    return current.methodIndex
  })
  const screen = createMemo<ConnectScreen>(() => {
    if (loading()) return { type: "loading" }

    const current = state()
    if (current.type === "select") return { type: "select", methods: methods() }
    if (current.type === "error") {
      return {
        type: "error",
        method: current.methodIndex === undefined ? undefined : methods().at(current.methodIndex),
        message: current.message,
      }
    }

    const selected = methods().at(current.methodIndex)
    if (!selected) return { type: "select", methods: methods() }
    if (current.type === "api") return { type: "api", method: selected }
    if (current.type === "pending") return { type: "pending", method: selected }
    if (current.type === "prompt") return { type: "prompts", method: selected, prompts: selected.prompts ?? [] }
    if (current.type === "authorized") {
      if (current.authorization.method === "code") {
        return { type: "oauthCode", method: selected, authorization: current.authorization }
      }
      return {
        type: "oauthAuto",
        method: selected,
        authorization: current.authorization,
        code: parseConfirmationCode(current.authorization.instructions),
      }
    }
    return { type: "pending", method: selected }
  })

  const clearTimer = () => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  }

  const all = () => {
    void import("./dialog-select-provider").then((x) => {
      dialog.show(() => <x.DialogSelectProvider />)
    })
  }

  const complete = async () => {
    await serverSDK.client.global.dispose()
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.connect.toast.connected.title", { provider: provider().name }),
      description: language.t("provider.connect.toast.connected.description", { provider: provider().name }),
    })
  }

  const resetMethod = () => setState({ type: "select" })

  const fail = (message: string) => setState({ type: "error", methodIndex: methodIndex(), message })

  const setAuthorization = (methodIndex: number, authorization: ProviderAuthAuthorization) =>
    setState({ type: "authorized", methodIndex, authorization })

  const requestFailed = () => language.t("common.requestFailed")

  onCleanup(() => {
    alive.value = false
    clearTimer()
  })

  async function chooseMethod(index: number) {
    clearTimer()

    const selected = methods()[index]
    if (!selected) return false

    if (selected.prompts?.length) {
      setState({ type: "prompt", methodIndex: index })
      return true
    }

    if (selected.type !== "oauth") {
      setState({ type: "api", methodIndex: index })
      return true
    }

    await authorize(index)
    return true
  }

  async function submitPrompts(inputs: Record<string, string>) {
    const current = state()
    if (current.type !== "prompt") return false
    const selected = methods().at(current.methodIndex)
    if (selected?.type !== "oauth") {
      setState({ type: "api", methodIndex: current.methodIndex, metadata: inputs })
      return true
    }
    await authorize(current.methodIndex, inputs)
    return true
  }

  async function authorize(index: number, inputs?: Record<string, string>) {
    clearTimer()
    setState({ type: "pending", methodIndex: index })
    const start = Date.now()
    await serverSDK.client.provider.oauth
      .authorize(
        {
          providerID,
          method: index,
          inputs,
        },
        { throwOnError: true },
      )
      .then((response) => {
        if (!alive.value) return
        if (!response.data) {
          fail(requestFailed())
          return
        }

        const authorization = response.data
        const delay = 1000 - (Date.now() - start)
        if (delay > 0) {
          timer.current = setTimeout(() => {
            timer.current = undefined
            if (!alive.value) return
            setAuthorization(index, authorization)
          }, delay)
          return
        }

        setAuthorization(index, authorization)
      })
      .catch((error) => {
        if (!alive.value) return
        fail(formatServerError(error, language.t, requestFailed()))
      })
  }

  async function submitApiKey(key: string) {
    const current = state()
    const result = await serverSDK.client.auth
      .set(
        {
          providerID,
          auth: {
            type: "api",
            key,
            ...(current.type === "api" && current.metadata ? { metadata: current.metadata } : {}),
          },
        },
        { throwOnError: true },
      )
      .then(() => ({ ok: true as const }))
      .catch((error) => ({ ok: false as const, error }))

    if (!result.ok) {
      fail(formatServerError(result.error, language.t, requestFailed()))
      return false
    }

    await complete()
    return true
  }

  async function completeOAuth(code?: string, options?: { fallback?: string; onError?: (error: string) => void }) {
    const current = state()
    if (current.type !== "authorized") {
      const error = options?.fallback ?? requestFailed()
      if (options?.onError) options.onError(error)
      else fail(error)
      return false
    }

    const result = await serverSDK.client.provider.oauth
      .callback(
        {
          providerID,
          method: current.methodIndex,
          code,
        },
        { throwOnError: true },
      )
      .then(() => ({ ok: true as const }))
      .catch((error) => ({ ok: false as const, error }))

    if (!alive.value) return false

    if (!result.ok) {
      const error = formatServerError(result.error, language.t, options?.fallback ?? requestFailed())
      if (options?.onError) options.onError(error)
      else fail(error)
      return false
    }

    await complete()
    return true
  }

  function goBack() {
    if (methods().length === 1) {
      all()
      return
    }
    if (methodIndex() !== undefined) {
      resetMethod()
      return
    }
    all()
  }

  return {
    provider,
    screen,
    chooseMethod,
    submitPrompts,
    submitApiKey,
    completeOAuth,
    goBack,
  }
}

function parseConfirmationCode(instructions: string) {
  if (instructions.includes(":")) return instructions.split(":").pop()?.trim()
  return instructions
}
