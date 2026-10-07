import { createEffect, createMemo, For, onCleanup, Show, on } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useVoice } from "@/context/voice"
import { voiceAdapter } from "@/voice/types"
import { Persist, persisted } from "@/utils/persist"
import { listOllama, mutateOllama, showOllama } from "@/ollama/transport"
import {
  ollamaTagKey,
  ollamaUserModels,
  ollamaURL,
  validOllamaTag,
  type OllamaConnection,
  type OllamaDetails,
  type OllamaError,
  type OllamaModel,
  type OllamaMutation,
  type OllamaProgress,
  type OllamaResult,
} from "@/ollama/types"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { Collapsible } from "@opencode-ai/ui/collapsible"

type Connection = OllamaConnection & { id: string; name: string }

export const { use: useOllamaModels, provider: OllamaModelsProvider } = createSimpleContext({
  name: "OllamaModels",
  init: (props: { tab: string }) => {
    const language = useLanguage()
    const platform = usePlatform()
    const sync = useServerSync()
    const sdk = useServerSDK()
    const voice = useVoice()
    const [saved, setSaved] = persisted(
      Persist.serverGlobal(sdk().scope, "ollama-manager.v1"),
      createStore({ connections: [] as Connection[] }),
    )
    const connections = createMemo(() => {
      const configured = Object.entries(sync().data.config.provider ?? {}).flatMap(([id, provider]) => {
        const url = provider.options?.baseURL ?? provider.api
        if (
          typeof url !== "string" ||
          (!/ollama/i.test(id) && !url.includes(":11434") && !provider.npm?.includes("ollama"))
        )
          return []
        const headers = provider.options?.headers
        return [
          {
            id,
            name: provider.name ?? id,
            baseURL: url,
            headers:
              headers && typeof headers === "object"
                ? Object.fromEntries(
                    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
                  )
                : undefined,
          },
        ]
      })
      const remote = voice.config.providers
        .filter((provider) => voiceAdapter(provider) === "ollama-qwen")
        .map((provider) => ({ id: provider.id, name: provider.name, ...voice.ollamaConnection(provider.id)! }))
      const merged = [...configured, ...remote, ...saved.connections]
      if (!merged.length) return [{ id: "ollama", name: "Ollama", baseURL: "http://127.0.0.1:11434" }]
      return merged
        .filter((connection, index) => merged.findIndex((item) => item.id === connection.id) === index)
        .map((connection) => {
          const speech = voice.ollamaConnection(connection.id)
          if (!speech) return connection
          try {
            return ollamaURL(speech.baseURL) === ollamaURL(connection.baseURL)
              ? { ...connection, ...speech }
              : connection
          } catch {
            return connection
          }
        })
    })
    const [state, setState] = createStore({
      registered: {} as Record<string, boolean>,
      open: false,
      connectionID: "",
      inventory: {} as Record<string, OllamaModel[] | undefined>,
      models: [] as OllamaModel[],
      loading: false,
      busy: false,
      job: "",
      progress: undefined as OllamaProgress | undefined,
      selected: "",
      details: undefined as OllamaDetails | undefined,
      detailLoading: false,
      name: "",
      tag: "",
      context: "",
      contextMode: "default",
      chunk: 30,
      usage: "chat" as "chat" | "voice",
      download: "",
      error: undefined as OllamaError | "save" | "voice" | "missing" | "default" | undefined,
      success: "" as "" | "download" | "save" | "delete" | "default",
      confirmDelete: false,
      connecting: false,
      providerID: "",
      providerName: "",
      baseURL: "",
    })
    const connection = () => connections().find((item) => item.id === state.connectionID) ?? connections()[0]
    const requests = {
      generation: 0,
      detail: 0,
      controller: undefined as AbortController | undefined,
    }
    const unsubscribe = platform.ollama?.subscribe((progress) => {
      if (progress.id === state.job) setState("progress", progress)
    })
    const stop = () => {
      requests.controller?.abort()
      if (state.job) void platform.ollama?.cancel(state.job)
    }
    onCleanup(() => {
      requests.generation++
      requests.detail++
      stop()
      unsubscribe?.()
    })
    const fail = (result: { error: OllamaError }) => {
      if (result.error !== "cancelled") setState("error", result.error)
    }
    const list = async () => {
      const generation = ++requests.generation
      const provider = connection()
      setState("loading", true)
      const result = await (
        platform.ollama?.list(provider) ?? listOllama(provider, AbortSignal.timeout(15000), platform.fetch)
      ).catch(() => ({ ok: false, error: "network" }) as const)
      if (generation !== requests.generation) return
      setState("loading", false)
      if (!result.ok) return fail(result)
      const models = ollamaUserModels(result.value)
      setState("models", models)
      setState("inventory", provider.id, models)
      Object.keys(state.registered)
        .filter((key) => key.startsWith(`${provider.id}/`))
        .forEach((key) => {
          if (!models.some((item) => `${provider.id}/${ollamaTagKey(item.name)}` === key)) {
            setState("registered", key, false)
          }
        })
      if (state.selected && !models.some((item) => ollamaTagKey(item.name) === ollamaTagKey(state.selected))) {
        requests.detail++
        setState({ selected: "", details: undefined, detailLoading: false })
      }
      // Refresh the server-backed picker too; the installed inventory remains authoritative here.
      void sync()
        .refreshProviders()
        .catch(() => setState("error", "save"))
    }
    const edit = async (model: string) => {
      const generation = ++requests.detail
      const provider = connection()
      const config = Object.entries(sync().data.config.provider?.[provider.id]?.models ?? {}).find(
        ([id]) => ollamaTagKey(id) === ollamaTagKey(model),
      )?.[1]
      const speech = voice.config.providers
        .find((item) => item.id === provider.id)
        ?.models.find((item) => ollamaTagKey(item.id) === ollamaTagKey(model))
      const installed = state.models.find((item) => ollamaTagKey(item.name) === ollamaTagKey(model))
      setState({
        selected: installed?.name ?? model,
        tag: installed?.name ?? model,
        name: (props.tab === "voice" ? speech?.name : config?.name) ?? speech?.name ?? config?.name ?? model,
        context: "",
        contextMode: "default",
        chunk: speech?.chunkSeconds ?? 30,
        usage:
          speech && !config
            ? "voice"
            : config
              ? "chat"
              : /qwen3.?asr/i.test(`${model} ${installed?.family}`) || props.tab === "voice"
                ? "voice"
                : "chat",
        details: undefined,
        detailLoading: true,
        confirmDelete: false,
        success: "",
        error: undefined,
      })
      const result = await (
        platform.ollama?.show(provider, model) ??
        showOllama(provider, model, AbortSignal.timeout(15000), platform.fetch)
      ).catch(() => ({ ok: false, error: "network" }) as const)
      if (generation !== requests.detail) return
      setState("detailLoading", false)
      if (!result.ok) return fail(result)
      setState({ details: result.value, context: result.value.context ? String(result.value.context) : "" })
    }
    const run = async (mutation: OllamaMutation): Promise<boolean> => {
      if (state.busy) return false
      const id = crypto.randomUUID()
      const controller = new AbortController()
      requests.controller = controller
      setState({ busy: true, job: id, progress: undefined, error: undefined, success: "" })
      const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000)
      try {
        const result: OllamaResult<void> = await (platform.ollama?.mutate(connection(), mutation, id) ??
          mutateOllama({
            connection: connection(),
            mutation,
            id,
            signal: controller.signal,
            fetch: platform.fetch,
            progress: (value) => setState("progress", value),
          }))
        if (!result.ok) {
          fail(result)
          return false
        }
        return true
      } catch {
        setState("error", "network")
        return false
      } finally {
        clearTimeout(timeout)
        requests.controller = undefined
        setState({ busy: false, job: "", progress: undefined })
      }
    }
    const tagExists = (tag: string) => state.models.some((model) => ollamaTagKey(model.name) === ollamaTagKey(tag))
    const setContext = (value: string) => setState("context", value)
    const register = async (tag: string) => {
      const provider = connection()
      if (state.usage === "voice") {
        const previous = voice.config.providers.find((item) => item.id === provider.id)
        if (previous && voiceAdapter(previous) !== "ollama-qwen") {
          setState("error", "voice")
          return false
        }
        const source = previous?.models.find((model) => ollamaTagKey(model.id) === ollamaTagKey(state.selected))
        const existing = previous?.models.find((model) => ollamaTagKey(model.id) === ollamaTagKey(tag))
        const result = await voice.save({
          ...previous,
          adapter: "ollama-qwen",
          id: provider.id,
          name: provider.name,
          baseURL: ollamaURL(provider.baseURL),
          protocol: "ollama",
          models: existing
            ? previous!.models.map((model) =>
                model.id === existing.id ? { ...model, name: state.name.trim(), chunkSeconds: state.chunk } : model,
              )
            : [
                ...(previous?.models ?? []),
                { ...source, id: tag, name: state.name.trim(), visible: true, chunkSeconds: state.chunk },
              ],
        })
        if (!result.ok) {
          setState("error", "voice")
          return false
        }
        return true
      }
      const previous = sync().data.config.provider?.[provider.id]
      const existing = Object.entries(previous?.models ?? {}).find(([id]) => ollamaTagKey(id) === ollamaTagKey(tag))
      const source =
        existing?.[1] ??
        Object.entries(previous?.models ?? {}).find(([id]) => ollamaTagKey(id) === ollamaTagKey(state.selected))?.[1]
      const context = Number(state.context) || source?.limit?.context
      if (!context || !Number.isSafeInteger(context)) {
        setState("error", "context")
        return false
      }
      const output = Math.min(source?.limit?.output ?? 8192, Math.max(256, context - 256))
      await sync().updateConfig({
        provider: {
          [provider.id]: {
            ...previous,
            name: previous?.name ?? provider.name,
            npm: previous?.npm ?? "@ai-sdk/openai-compatible",
            blacklist: (previous?.blacklist ?? []).filter((id) => ollamaTagKey(id) !== ollamaTagKey(tag)),
            options: { ...previous?.options, baseURL: `${ollamaURL(provider.baseURL)}/v1` },
            models: {
              [existing?.[0] ?? tag]: {
                ...source,
                id: existing ? (source?.id ?? existing[0]) : tag,
                name: state.name.trim(),
                limit: {
                  ...source?.limit,
                  context,
                  output,
                  ...(source?.limit?.input ? { input: Math.min(source.limit.input, context) } : {}),
                },
                tool_call: source?.tool_call ?? state.details?.capabilities.includes("tools") ?? false,
                reasoning: source?.reasoning ?? state.details?.capabilities.includes("thinking") ?? false,
                modalities: source?.modalities ?? {
                  input: state.details?.capabilities.includes("vision") ? ["text", "image"] : ["text"],
                  output: ["text"],
                },
              },
            },
          },
        },
        disabled_providers: (sync().data.config.disabled_providers ?? []).filter((id) => id !== provider.id),
      })
      await sync().refreshProviders()
      setState("registered", `${provider.id}/${tag}`, true)
      return true
    }
    const save = async (event: SubmitEvent) => {
      event.preventDefault()
      if (state.busy || state.detailLoading || !state.details) return
      const tag = state.tag.trim()
      const context = Number(state.context)
      const changed = !!state.context && context !== state.details.context
      if (!state.name.trim() || !validOllamaTag(tag)) return setState("error", "configuration")
      if (
        state.context &&
        (!Number.isSafeInteger(context) || context < 512 || context > (state.details.maxContext ?? 1048576))
      )
        return setState("error", "context")
      if (ollamaTagKey(tag) !== ollamaTagKey(state.selected) && tagExists(tag)) return setState("error", "exists")
      if (
        state.usage === "chat" &&
        !context &&
        !Object.entries(sync().data.config.provider?.[connection().id]?.models ?? {}).find(
          ([id]) => ollamaTagKey(id) === ollamaTagKey(state.selected),
        )?.[1]?.limit?.context
      )
        return setState("error", "context")
      if (
        changed &&
        !(await run(
          ollamaTagKey(tag) === ollamaTagKey(state.selected)
            ? { action: "context", model: state.selected, context }
            : { action: "create", source: state.selected, model: tag, context },
        ))
      )
        return
      if (
        !changed &&
        ollamaTagKey(tag) !== ollamaTagKey(state.selected) &&
        !(await run({ action: "copy", source: state.selected, model: tag }))
      )
        return
      // The Ollama mutation can succeed even when the OpenCode server is unreachable.
      setState({ busy: true, error: undefined })
      try {
        const provider = voice.config.providers.find((item) => item.id === connection().id)
        const speech = provider?.models.find((item) => ollamaTagKey(item.id) === ollamaTagKey(state.selected))
        const chat = Object.entries(sync().data.config.provider?.[connection().id]?.models ?? {}).find(
          ([id]) => ollamaTagKey(id) === ollamaTagKey(state.selected),
        )
        if (
          !changed &&
          ollamaTagKey(tag) === ollamaTagKey(state.selected) &&
          ((state.usage === "voice" && speech && state.chunk === (speech.chunkSeconds ?? 30)) ||
            (state.usage === "chat" && chat))
        ) {
          if (state.usage === "voice" && provider && speech) {
            const result = await voice.save({
              ...provider,
              models: provider.models.map((model) =>
                model.id === speech.id ? { ...model, name: state.name.trim() } : model,
              ),
            })
            if (!result.ok) return setState("error", "save")
          }
          if (state.usage === "chat" && chat) {
            await sync().updateConfig({
              provider: {
                [connection().id]: {
                  models: {
                    [chat[0]]: { ...chat[1], name: state.name.trim() },
                  },
                },
              },
            })
            await sync().refreshProviders()
          }
          setState("success", "save")
          return
        }
        if (!(await register(ollamaTagKey(tag)))) {
          await list()
          return
        }
        await list()
        await edit(ollamaTagKey(tag))
        setState("success", "save")
      } catch {
        setState("error", "save")
        await list()
      } finally {
        setState("busy", false)
      }
    }
    const download = async (event: SubmitEvent) => {
      event.preventDefault()
      const model = state.download.trim()
      if (!validOllamaTag(model)) return setState("error", "configuration")
      if (!(await run({ action: "pull", model }))) return
      await list()
      await edit(ollamaTagKey(model))
      setState({ success: "download", download: "" })
    }
    const remove = async () => {
      const model = state.selected
      const provider = connection()
      const currentDefault = sync().data.config.model
      const deletingDefault = currentDefault === `${provider.id}/${model}`
      if (deletingDefault) return setState("error", "default")
      if (!(await run({ action: "delete", model }))) return
      const speech = voice.config.providers.find((item) => item.id === provider.id)
      try {
        if (speech) {
          const remaining = speech.models.filter((item) => ollamaTagKey(item.id) !== ollamaTagKey(model))
          if (remaining.length) {
            const result = await voice.save({ ...speech, models: remaining })
            if (!result.ok) throw new Error("save")
            if (
              voice.config.selected?.providerID === provider.id &&
              ollamaTagKey(voice.config.selected.modelID) === ollamaTagKey(model)
            )
              await voice.configure(undefined)
          } else await voice.remove(provider.id)
        }
        // Hide deleted chat tags through the provider blacklist; keep unrelated config and aliases.
        const configured = sync().data.config.provider?.[provider.id]
        if (configured?.models?.[model])
          await sync().updateConfig({
            provider: { [provider.id]: { blacklist: [...new Set([...(configured?.blacklist ?? []), model])] } },
          })
        await sync().refreshProviders()
        setState({ selected: "", details: undefined, confirmDelete: false, success: "delete" })
      } catch {
        setState("error", "save")
      }
      await list()
    }
    const makeDefault = async () => {
      if (state.busy) return
      setState({ busy: true, error: undefined })
      try {
        const tag = state.selected
        if (!(await register(tag))) return
        if (state.usage === "voice") await voice.configure({ providerID: connection().id, modelID: tag })
        else await sync().updateConfig({ model: `${connection().id}/${tag}` })
        setState("success", "default")
      } catch {
        setState("error", "save")
      } finally {
        setState("busy", false)
      }
    }
    const connect = (event: SubmitEvent) => {
      event.preventDefault()
      try {
        const id = state.providerID.trim()
        if (
          !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) ||
          id === "local-speech" ||
          !state.providerName.trim() ||
          connections().some((item) => item.id === id)
        )
          return setState("error", "configuration")
        const provider = sync().data.config.provider?.[id]
        if (provider) return setState("error", "configuration")
        const value = { id, name: state.providerName.trim(), baseURL: ollamaURL(state.baseURL.trim()) }
        setSaved("connections", [...saved.connections, value])
        setState({ connectionID: id, connecting: false, selected: "", models: [], error: undefined })
        void list()
      } catch {
        setState("error", "configuration")
      }
    }
    const panelOpen = (id: string) => state.open && connection().id === id
    const modelOpen = (id: string, model: string) =>
      connection().id === id && !!state.selected && ollamaTagKey(state.selected) === ollamaTagKey(model)
    const select = (id: string) => {
      requests.generation++
      requests.detail++
      setState({
        connectionID: id,
        selected: "",
        details: undefined,
        models: state.inventory[id] ?? [],
        error: undefined,
        success: "",
      })
    }
    const togglePanel = (id: string) => {
      if (state.busy) return
      if (panelOpen(id)) return setState("open", false)
      select(id)
      setState("open", true)
      void list()
    }
    const toggleModel = (id: string, model: string) => {
      if (state.busy) return
      if (modelOpen(id, model)) {
        requests.detail++
        setState({ selected: "", details: undefined })
        return
      }
      if (connection().id !== id) {
        select(id)
        setState("open", false)
      }
      void edit(model)
      if (!state.inventory[id]) void list()
    }
    const enable = async (id: string, model: string, usage: "chat" | "voice") => {
      if (state.busy) return false
      select(id)
      setState("busy", true)
      try {
        await edit(model)
        if (!state.details) return false
        setState("usage", usage)
        if (usage === "chat" && !state.context && state.details.maxContext) {
          // Register a bounded context limit without creating or changing the Ollama tag.
          setState("context", String(Math.min(8192, state.details.maxContext)))
        }
        if (!(await register(ollamaTagKey(model)))) return false
        setState("success", "save")
        return true
      } catch {
        setState("error", "save")
        return false
      } finally {
        setState("busy", false)
      }
    }
    createEffect(
      on(
        () => props.tab,
        () => {
          if (state.busy) return
          requests.detail++
          setState({ open: false, selected: "", details: undefined })
        },
        { defer: true },
      ),
    )
    const isVoice = (id: string, model: string) =>
      voice.config.providers
        .find((provider) => provider.id === id)
        ?.models.some((item) => ollamaTagKey(item.id) === ollamaTagKey(model)) || /(?:asr|whisper|speech)/i.test(model)
    const percent = () =>
      state.progress?.total
        ? Math.min(100, Math.round((state.progress.completed / state.progress.total) * 100))
        : undefined
    const feedback = () => (
      <>
        <Show when={state.error}>
          {(error) => (
            <p class="voice-settings-hint" role="alert">
              {language.t(`models.manage.error.${error()}`)}
            </p>
          )}
        </Show>
        <Show when={state.success}>
          {(success) => (
            <p class="voice-settings-hint" role="status">
              {language.t(`models.manage.success.${success()}`)}
            </p>
          )}
        </Show>
      </>
    )
    const Panel = (input: { providerID: string }) => (
      <Collapsible open={panelOpen(input.providerID)} class="ollama-inline-collapse">
        <Collapsible.Content>
          <div class="ollama-manager-panel" data-component="ollama-model-manager">
            <div class="ollama-connection-bar">
              <p class="voice-settings-hint">{connection().baseURL}</p>
              <div class="voice-settings-actions">
                <ButtonV2
                  size="small"
                  variant="ghost-muted"
                  icon="reset"
                  disabled={state.loading || state.busy}
                  onClick={() => {
                    setState("error", undefined)
                    void list()
                  }}
                >
                  {language.t("models.manage.refresh")}
                </ButtonV2>
                <ButtonV2
                  size="small"
                  variant={state.connecting ? "neutral" : "ghost-muted"}
                  icon={state.connecting ? "chevronUp" : "plus"}
                  aria-expanded={state.connecting}
                  aria-pressed={state.connecting}
                  disabled={state.busy}
                  onClick={() => setState("connecting", !state.connecting)}
                >
                  {language.t("models.manage.connect.short")}
                </ButtonV2>
              </div>
            </div>
            <Show when={state.connecting}>
              <form class="voice-settings-form" onSubmit={connect}>
                <For
                  each={
                    [
                      { key: "providerID", label: "provider.custom.field.providerID.label" },
                      { key: "providerName", label: "provider.custom.field.name.label" },
                      { key: "baseURL", label: "provider.custom.field.baseURL.label" },
                    ] as const
                  }
                >
                  {(field) => (
                    <label class="voice-settings-field">
                      <span>{language.t(field.label)}</span>
                      <TextInputV2
                        appearance="base"
                        required
                        value={state[field.key]}
                        onInput={(event) => setState(field.key, event.currentTarget.value)}
                        aria-label={language.t(field.label)}
                      />
                    </label>
                  )}
                </For>
                <ButtonV2 type="submit" variant="neutral">
                  {language.t("common.save")}
                </ButtonV2>
              </form>
            </Show>
            <form class="ollama-download" onSubmit={(event) => void download(event)}>
              <label class="voice-settings-field">
                <span>{language.t("models.manage.download.label")}</span>
                <TextInputV2
                  appearance="base"
                  required
                  value={state.download}
                  disabled={state.busy}
                  aria-label={language.t("models.manage.download.id")}
                  placeholder={language.t(
                    props.tab === "voice"
                      ? "models.manage.download.example.voice"
                      : "models.manage.download.example.chat",
                  )}
                  onInput={(event) => setState("download", event.currentTarget.value)}
                />
              </label>
              <ButtonV2 type="submit" variant="neutral" disabled={state.busy || !state.download.trim()}>
                {language.t("voice.models.download")}
              </ButtonV2>
            </form>
            <Show when={props.tab === "voice"}>
              <div class="ollama-download-suggestion">
                <ButtonV2
                  size="small"
                  variant="ghost-muted"
                  disabled={state.busy}
                  onClick={() => setState({ download: "frozenlab/qwen3-asr:0.6b", usage: "voice" })}
                >
                  {language.t("models.manage.qwen")}
                </ButtonV2>
                <p class="voice-settings-hint">{language.t("models.manage.qwen.description")}</p>
              </div>
            </Show>
            <Show when={state.busy}>
              <div class="voice-settings-local" role="status">
                <span>
                  {language.t(
                    state.progress?.stage === "download" && percent() !== undefined
                      ? "models.manage.progress"
                      : "models.manage.working",
                    { progress: percent() ?? 0 },
                  )}
                </span>
                <Show when={percent() !== undefined}>
                  <progress max="100" value={percent()} aria-label={language.t("voice.models.download")} />
                </Show>
                <Show when={state.job}>
                  <ButtonV2 size="small" variant="ghost-muted" onClick={stop}>
                    {language.t("common.cancel")}
                  </ButtonV2>
                </Show>
              </div>
            </Show>

            <Show when={state.loading}>
              <p role="status" class="voice-settings-hint">
                {language.t("common.loading")}
              </p>
            </Show>
            <Show when={!state.selected}>{feedback()}</Show>
          </div>
        </Collapsible.Content>
      </Collapsible>
    )
    const Editor = (input: { providerID: string; modelID: string }) => (
      <Collapsible open={modelOpen(input.providerID, input.modelID)} class="ollama-inline-collapse">
        <Collapsible.Content>
          <form class="voice-settings-form ollama-model-editor" onSubmit={(event) => void save(event)}>
            <Show when={state.detailLoading}>
              <p role="status">{language.t("common.loading")}</p>
            </Show>
            <label class="voice-settings-field">
              <span>{language.t("models.manage.name")}</span>
              <TextInputV2
                appearance="base"
                value={state.name}
                required
                disabled={state.busy}
                onInput={(event) => setState("name", event.currentTarget.value)}
                aria-label={language.t("models.manage.name")}
              />
            </label>
            <label class="voice-settings-field">
              <span>{language.t("models.manage.tag")}</span>
              <TextInputV2
                appearance="base"
                value={state.tag}
                required
                disabled={state.busy}
                onInput={(event) => setState("tag", event.currentTarget.value)}
                aria-label={language.t("models.manage.tag")}
              />
            </label>
            <p class="voice-settings-hint">{language.t("models.manage.tag.description")}</p>
            <label class="voice-settings-field">
              <span>{language.t("models.manage.usage")}</span>
              <SelectV2
                appearance="base"
                options={["chat", "voice"] as const}
                current={state.usage}
                label={(value) => language.t(value === "chat" ? "voice.models.chat" : "voice.models.voice")}
                disabled={state.busy}
                onSelect={(value) => value && setState("usage", value)}
              />
            </label>
            <div class="voice-settings-field" role="group" aria-label={language.t("models.manage.context")}>
              <span>{language.t("models.manage.context")}</span>
              <SelectV2
                appearance="base"
                options={[
                  "default",
                  ...[
                    ...new Set([
                      8192,
                      16384,
                      32768,
                      65536,
                      131072,
                      262144,
                      524288,
                      1048576,
                      state.details?.maxContext ?? 1048576,
                    ]),
                  ]
                    .filter(
                      (value) =>
                        Number.isSafeInteger(value) && value >= 512 && value <= (state.details?.maxContext ?? 1048576),
                    )
                    .sort((a, b) => a - b)
                    .map(String),
                  "custom",
                ]}
                modal={true}
                current={state.contextMode}
                label={(value) =>
                  value === "default"
                    ? language.t("models.manage.context.default")
                    : value === "custom"
                      ? language.t("models.manage.context.custom")
                      : Number(value) % 1024 !== 0
                        ? value
                        : Number(value) === 1048576
                          ? "1M"
                          : `${Number(value) / 1024}K`
                }
                disabled={state.busy || state.detailLoading}
                onSelect={(value) => {
                  if (!value) return
                  setState("contextMode", value)
                  if (value === "custom") return
                  setContext(value === "default" ? String(state.details?.context ?? "") : value)
                }}
              />
              <TextInputV2
                appearance="base"
                type="number"
                min="512"
                max={state.details?.maxContext ?? 1048576}
                value={state.context}
                placeholder={language.t("models.manage.context.default")}
                disabled={state.busy || state.detailLoading}
                onInput={(event) => {
                  setState("contextMode", "custom")
                  setContext(event.currentTarget.value)
                }}
                aria-label={language.t("models.manage.context")}
              />
            </div>
            <p class="voice-settings-hint">{language.t("models.manage.context.description")}</p>
            <Show when={state.details?.maxContext}>
              <p class="voice-settings-hint">
                {language.t("models.manage.context.max", { size: state.details?.maxContext ?? 0 })}
              </p>
            </Show>
            <Show when={state.usage === "voice"}>
              <label class="voice-settings-field">
                <span>{language.t("models.manage.chunk")}</span>
                <SelectV2
                  appearance="base"
                  options={[15, 30, 60]}
                  current={state.chunk}
                  label={(seconds) => language.t("models.manage.seconds", { seconds })}
                  disabled={state.busy}
                  onSelect={(value) => value && setState("chunk", value)}
                />
              </label>
              <p class="voice-settings-hint">{language.t("models.manage.voice.description")}</p>
            </Show>
            <div class="voice-settings-actions">
              <ButtonV2 type="submit" variant="contrast" disabled={state.busy || state.detailLoading || !state.details}>
                {language.t("common.save")}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant="neutral"
                disabled={
                  state.busy ||
                  state.detailLoading ||
                  !state.details ||
                  state.tag !== state.selected ||
                  state.context !== String(state.details?.context ?? "")
                }
                onClick={() => void makeDefault()}
              >
                {language.t("models.manage.default")}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant="ghost-muted"
                disabled={state.busy}
                onClick={() => setState("confirmDelete", true)}
              >
                {language.t("voice.models.delete")}
              </ButtonV2>
            </div>
            <Show when={state.confirmDelete}>
              <div class="ollama-delete-confirm" role="alert">
                <p>{language.t("models.manage.delete.confirm", { model: state.selected })}</p>
                <div class="voice-settings-actions">
                  <ButtonV2 type="button" variant="neutral" disabled={state.busy} onClick={() => void remove()}>
                    {language.t("voice.models.delete")}
                  </ButtonV2>
                  <ButtonV2
                    type="button"
                    variant="ghost-muted"
                    disabled={state.busy}
                    onClick={() => setState("confirmDelete", false)}
                  >
                    {language.t("common.cancel")}
                  </ButtonV2>
                </div>
              </div>
            </Show>
          </form>
          {feedback()}
        </Collapsible.Content>
      </Collapsible>
    )
    const Trigger = (input: { providerID: string }) => (
      <ButtonV2
        size="small"
        variant={panelOpen(input.providerID) ? "neutral" : "ghost-muted"}
        aria-expanded={panelOpen(input.providerID)}
        aria-pressed={panelOpen(input.providerID)}
        disabled={state.busy}
        onClick={() => togglePanel(input.providerID)}
      >
        {language.t("models.manage.open")}
      </ButtonV2>
    )
    return {
      enable,
      Trigger,
      connections,
      state,
      panelOpen,
      modelOpen,
      togglePanel,
      toggleModel,
      isVoice,
      Panel,
      Editor,
    }
  },
})
