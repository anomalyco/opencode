import { ollamaURL } from "@/ollama/types"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { usePlatform } from "./platform"
import {
  localVoiceModel,
  voiceAdapter,
  voiceCapabilities,
  validVoiceProvider,
  type VoiceConfig,
  type VoiceProviderConfig,
  type VoiceResult,
  type VoiceSelection,
  type VoiceSnapshot,
  type VoiceTranscription,
} from "@/voice/types"
import { transcribeVoiceEndpoint } from "@/voice/transport"

export const { use: useVoice, provider: VoiceProvider } = createSimpleContext({
  name: "Voice",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const [config, setConfig, , ready] = persisted(
      Persist.global("voice.v1"),
      createStore<VoiceConfig>({ providers: [], language: "auto" }),
    )
    const [state, setState] = createStore({
      local: { supported: false, phase: "uninstalled" } as VoiceSnapshot["local"],
      ready: false,
    })
    const secrets = new Map<string, string>()
    const jobs = new Map<string, AbortController>()
    const native = platform.voice
    const update = (snapshot: VoiceSnapshot) => {
      setConfig(reconcile({ providers: snapshot.providers, selected: snapshot.selected, language: snapshot.language }))
      setState({ local: snapshot.local, ready: true })
    }
    onMount(() => {
      if (!native) return
      const unsubscribe = native.subscribe(update)
      onCleanup(unsubscribe)
      void native
        .read()
        .then(update)
        .catch(() => setState("ready", true))
    })
    onCleanup(() => jobs.forEach((job) => job.abort()))
    const models = createMemo(() => [
      {
        providerID: localVoiceModel.providerID,
        providerName: undefined,
        id: localVoiceModel.modelID,
        name: localVoiceModel.name,
        available: state.local.supported && ["installed", "ready"].includes(state.local.phase),
        visible: true,
        local: true,
        protocol: undefined,
        capabilities: voiceCapabilities(),
        location: "device" as const,
      },
      ...config.providers.flatMap((provider) =>
        provider.models.map((model) => ({
          providerID: provider.id,
          providerName: provider.name,
          id: model.id,
          name: model.name,
          available: !provider.hasKey || !!native || secrets.has(provider.id),
          visible: model.visible,
          local: false,
          protocol: voiceAdapter(provider) === "ollama-qwen" ? ("ollama" as const) : ("openai" as const),
          capabilities: voiceCapabilities(provider, model.id),
          location: provider.location ?? ("unknown" as const),
        })),
      ),
    ])
    const selected = createMemo(() =>
      models().find(
        (model) =>
          model.providerID === config.selected?.providerID &&
          model.id === config.selected.modelID &&
          model.available &&
          model.visible,
      ),
    )
    const configure = async (selection: VoiceSelection | undefined, language = config.language) => {
      if (native) return update(await native.configure(selection, language))
      setConfig({ selected: selection, language })
    }
    return {
      config,
      state,
      ollamaConnection(id: string) {
        const provider = config.providers.find((item) => item.id === id && voiceAdapter(item) === "ollama-qwen")
        if (!provider) return undefined
        const apiKey = secrets.get(id)
        return {
          baseURL: ollamaURL(provider.baseURL),
          voiceProviderID: native ? id : undefined,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        }
      },
      models,
      selected,
      ready: () => (native ? state.ready : ready()),
      async save(provider: VoiceProviderConfig, apiKey?: string): Promise<VoiceResult<void>> {
        if (!validVoiceProvider(provider)) return { ok: false, error: "configuration" }
        if (native) {
          const result = await native.save(provider, apiKey)
          if (!result.ok) return result
          update(result.value)
          return { ok: true, value: undefined }
        }
        if (apiKey !== undefined) {
          secrets.delete(provider.id)
          if (apiKey.trim()) secrets.set(provider.id, apiKey.trim())
        }
        const next = { ...provider, hasKey: secrets.has(provider.id) }
        setConfig("providers", [...config.providers.filter((item) => item.id !== next.id), next])
        return { ok: true, value: undefined }
      },
      async remove(id: string) {
        if (native) return update(await native.remove(id))
        secrets.delete(id)
        setConfig(
          "providers",
          config.providers.filter((item) => item.id !== id),
        )
        if (config.selected?.providerID === id) setConfig("selected", undefined)
      },
      configure,
      async visibility(providerID: string, modelID: string, visible: boolean) {
        const provider = config.providers.find((item) => item.id === providerID)
        if (!provider) return
        const next = {
          ...provider,
          models: provider.models.map((model) => (model.id === modelID ? { ...model, visible } : model)),
        }
        if (native) {
          const result = await native.save(next)
          if (result.ok) update(result.value)
        } else
          setConfig(
            "providers",
            (item) => item.id === providerID,
            "models",
            (model) => model.id === modelID,
            "visible",
            visible,
          )
        if (!visible && config.selected?.providerID === providerID && config.selected.modelID === modelID)
          await configure(undefined)
      },
      async test(id: string): Promise<VoiceResult<void>> {
        if (native) return native.test(id)
        const provider = config.providers.find((item) => item.id === id)
        if (!provider) return { ok: false, error: "configuration" }
        try {
          const key = secrets.get(id)
          if (provider.hasKey && !key) return { ok: false, error: "authentication" }
          const response = await (platform.fetch ?? fetch)(
            voiceAdapter(provider) === "ollama-qwen"
              ? `${ollamaURL(provider.baseURL)}/api/tags`
              : `${provider.baseURL.replace(/\/+$/, "")}/models`,
            {
              signal: AbortSignal.timeout(15000),
              redirect: "error",
              headers: key ? { Authorization: `Bearer ${key}` } : {},
            },
          )
          if ([401, 403].includes(response.status)) return { ok: false, error: "authentication" }
          return response.ok ? { ok: true, value: undefined } : { ok: false, error: "response" }
        } catch {
          return { ok: false, error: "network" }
        }
      },
      install: () => native?.install() ?? Promise.resolve({ ok: false, error: "unsupported" } as const),
      deleteModel: () => native?.deleteModel() ?? Promise.resolve({ ok: false, error: "unsupported" } as const),
      async transcribe(input: VoiceTranscription): Promise<VoiceResult<string>> {
        if (native) return native.transcribe(input)
        const provider = config.providers.find((item) => item.id === input.selection.providerID)
        if (!provider || !provider.models.some((model) => model.id === input.selection.modelID && model.visible))
          return { ok: false, error: "configuration" }
        const key = secrets.get(provider.id)
        if (provider.hasKey && !key) return { ok: false, error: "authentication" }
        const controller = new AbortController()
        jobs.set(input.id, controller)
        const timeout = setTimeout(
          () => controller.abort(),
          voiceCapabilities(provider, input.selection.modelID).timeout,
        )
        try {
          return await transcribeVoiceEndpoint({
            provider,
            apiKey: key,
            modelID: input.selection.modelID,
            audio: input.audio,
            language: input.language,
            signal: controller.signal,
            fetch: platform.fetch,
          })
        } finally {
          clearTimeout(timeout)
          jobs.delete(input.id)
        }
      },
      async cancel(id: string) {
        jobs.get(id)?.abort()
        await native?.cancel(id)
      },
    }
  },
})
