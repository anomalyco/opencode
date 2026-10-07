import { createEffect, createMemo, For, Show, onCleanup, on } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useVoice } from "@/context/voice"
import {
  localVoiceModel,
  validVoiceLanguage,
  voiceAdapter,
  voiceRequestLanguage,
  voiceAdapters,
  type VoiceError,
  type VoiceProviderConfig,
  type VoiceResult,
} from "@/voice/types"
import { voiceWav } from "@/voice/audio"
import { createVoiceRecorder } from "../voice-input/recorder"
import { VoiceInput } from "../voice-input/input"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { useOllamaModels } from "./ollama"
import { ollamaTagKey } from "@/ollama/types"
import { Collapsible } from "@opencode-ai/ui/collapsible"

function LocalVoiceActions() {
  const voice = useVoice()
  const language = useLanguage()
  const [state, setState] = createStore({ error: undefined as VoiceError | undefined })
  const phase = () => voice.state.local.phase
  const busy = () => ["installing", "downloading", "loading"].includes(phase())
  const installed = () => ["installed", "ready", "loading"].includes(phase())
  const run = async (action: () => Promise<VoiceResult<void>>) => {
    setState("error", undefined)
    const result = await action()
    if (!result.ok && result.error !== "cancelled") setState("error", result.error)
  }
  return (
    <div class="voice-settings-local" data-component="voice-local-model">
      <div class="voice-settings-status" role="status">
        {language.t(phase() === "downloading" ? "voice.models.downloading" : `voice.models.${phase()}`, {
          progress: voice.state.local.progress ?? 0,
        })}
      </div>
      <Show
        when={voice.state.local.supported}
        fallback={<p class="voice-settings-hint">{language.t("voice.models.unsupported")}</p>}
      >
        <div class="voice-settings-actions">
          <Show
            when={busy()}
            fallback={
              <>
                <Show when={!installed()}>
                  <ButtonV2 size="small" variant="neutral" onClick={() => void run(voice.install)}>
                    {language.t("voice.models.download")}
                  </ButtonV2>
                </Show>
                <Show when={installed()}>
                  <ButtonV2 size="small" variant="ghost-muted" onClick={() => void run(voice.deleteModel)}>
                    {language.t("voice.models.delete")}
                  </ButtonV2>
                </Show>
              </>
            }
          >
            <ButtonV2
              size="small"
              variant="ghost-muted"
              disabled={phase() === "loading"}
              onClick={() => void voice.cancel("install")}
            >
              {language.t("common.cancel")}
            </ButtonV2>
          </Show>
        </div>
        <Show when={!installed()}>
          <p class="voice-settings-hint">{language.t("voice.models.download.description")}</p>
        </Show>
      </Show>
      <Show when={state.error}>
        {(error) => (
          <p role="alert" class="voice-settings-hint">
            {language.t(`voice.model.error.${error()}`)}
          </p>
        )}
      </Show>
    </div>
  )
}

export function createVoiceProviderSettings() {
  const voice = useVoice()
  const language = useLanguage()
  const platform = usePlatform()
  const [form, setForm] = createStore({
    open: false,
    id: "",
    name: "",
    baseURL: "",
    modelIDs: "",
    protocol: "openai" as "openai" | "ollama",
    location: "unknown" as "unknown" | "device" | "remote" | "cloud",
    apiKey: "",
    editing: false,
    busy: false,
    error: undefined as VoiceError | undefined,
    testing: "",
    tested: "",
  })
  const edit = (provider?: VoiceProviderConfig) =>
    setForm({
      open: true,
      id: provider?.id ?? "",
      name: provider?.name ?? "",
      baseURL: provider?.baseURL ?? "",
      modelIDs: provider?.models.map((model) => model.id).join(", ") ?? "",
      apiKey: "",
      editing: !!provider,
      protocol: provider && voiceAdapter(provider) === "ollama-qwen" ? "ollama" : "openai",
      location: provider?.location ?? "unknown",
      error: undefined,
    })
  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    if (form.busy) return
    setForm({ busy: true, error: undefined })
    const previous = voice.config.providers.find((provider) => provider.id === form.id)
    const result = await voice.save(
      {
        id: form.id.trim(),
        name: form.name.trim(),
        baseURL: form.baseURL.trim(),
        protocol: form.protocol,
        adapter: form.protocol === "ollama" ? "ollama-qwen" : "transcription-api",
        location: form.location === "unknown" ? undefined : form.location,
        models: form.modelIDs.split(",").map((id) => ({
          ...previous?.models.find((model) => model.id === id.trim()),
          id: id.trim(),
          name: previous?.models.find((model) => model.id === id.trim())?.name ?? id.trim(),
          visible: previous?.models.find((model) => model.id === id.trim())?.visible ?? true,
        })),
      },
      form.editing && !form.apiKey ? undefined : form.apiKey,
    )
    setForm("busy", false)
    if (!result.ok) return setForm("error", result.error)
    setForm({ open: false, apiKey: "" })
  }
  const test = async (id: string) => {
    setForm({ testing: id, tested: "", error: undefined })
    const result = await voice.test(id)
    setForm("testing", "")
    if (!result.ok) return setForm("error", result.error)
    setForm("tested", id)
  }
  const Actions = (props: { provider: VoiceProviderConfig; shared?: boolean }) => (
    <div class="voice-settings-actions">
      <ButtonV2
        size="small"
        variant="ghost-muted"
        disabled={!!form.testing}
        onClick={() => void test(props.provider.id)}
      >
        {language.t(form.testing === props.provider.id ? "common.loading" : "voice.providers.test")}
      </ButtonV2>
      <Show when={!props.shared}>
        <ButtonV2 size="small" variant="ghost-muted" onClick={() => edit(props.provider)}>
          {language.t("common.edit")}
        </ButtonV2>
        <ButtonV2 size="small" variant="ghost-muted" onClick={() => void voice.remove(props.provider.id)}>
          {language.t("common.disconnect")}
        </ButtonV2>
      </Show>
    </div>
  )
  const Form = () => (
    <>
      <Show when={form.tested}>
        <p role="status" class="voice-settings-hint">
          {language.t("voice.providers.test.success")}
        </p>
      </Show>
      <Show when={form.open}>
        <form class="voice-settings-form" onSubmit={(event) => void save(event)}>
          <h3 class="settings-v2-section-title">
            {language.t(form.editing ? "voice.providers.edit" : "voice.providers.add")}
          </h3>
          <label class="voice-settings-field">
            <span>{language.t("models.manage.protocol")}</span>
            <SelectV2
              appearance="base"
              options={["openai", "ollama"] as const}
              current={form.protocol}
              label={(value) =>
                value === "ollama" ? language.t("voice.adapter.ollama") : language.t("voice.providers.endpoint")
              }
              onSelect={(value) => value && setForm("protocol", value)}
            />
          </label>
          <label class="voice-settings-field">
            <span>{language.t("voice.execution")}</span>
            <SelectV2
              appearance="base"
              data-action="voice-execution"
              options={["unknown", "device", "remote", "cloud"] as const}
              current={form.location}
              label={(value) => language.t(`voice.execution.${value}`)}
              onSelect={(value) => value && setForm("location", value)}
            />
          </label>
          <For
            each={
              [
                { key: "id", label: "provider.custom.field.providerID.label" },
                { key: "name", label: "provider.custom.field.name.label" },
                { key: "baseURL", label: "provider.custom.field.baseURL.label" },
                { key: "modelIDs", label: "voice.providers.models" },
              ] as const
            }
          >
            {(field) => (
              <label class="voice-settings-field">
                <span>{language.t(field.label)}</span>
                <TextInputV2
                  data-action={`voice-provider-${field.key}`}
                  appearance="base"
                  value={form[field.key]}
                  onInput={(event) => setForm(field.key, event.currentTarget.value)}
                  disabled={form.busy || (field.key === "id" && form.editing)}
                  required
                  aria-label={language.t(field.label)}
                />
              </label>
            )}
          </For>
          <p class="voice-settings-hint">{language.t("voice.providers.models.description")}</p>
          <label class="voice-settings-field">
            <span>{language.t("provider.custom.field.apiKey.label")}</span>
            <TextInputV2
              appearance="base"
              type="password"
              autocomplete="off"
              value={form.apiKey}
              onInput={(event) => setForm("apiKey", event.currentTarget.value)}
              aria-label={language.t("provider.custom.field.apiKey.label")}
            />
          </label>
          <p class="voice-settings-hint">
            {language.t(platform.voice ? "voice.providers.key.description" : "voice.providers.browserKey")}
          </p>
          <div class="voice-settings-actions">
            <ButtonV2 type="submit" variant="contrast" disabled={form.busy}>
              {language.t("common.save")}
            </ButtonV2>
            <ButtonV2
              type="button"
              variant="ghost-muted"
              onClick={() => setForm({ open: false, apiKey: "", error: undefined })}
            >
              {language.t("common.cancel")}
            </ButtonV2>
          </div>
        </form>
      </Show>
      <Show when={form.error}>
        {(error) => (
          <p role="alert" class="voice-settings-hint">
            {language.t(`voice.model.error.${error()}`)}
          </p>
        )}
      </Show>
    </>
  )
  return { edit, Actions, Form, providers: () => voice.config.providers, remove: voice.remove }
}

export function VoiceLanguageSetting() {
  const voice = useVoice()
  const language = useLanguage()
  const capabilities = () => voice.selected()?.capabilities
  const options = () => ["auto", ...(capabilities()?.languages ?? ["ko", "en"])]
  const current = () => (capabilities() ? voiceRequestLanguage(capabilities()!, voice.config.language) : "auto")
  return (
    <SettingsRowV2 title={language.t("voice.models.language")} description="">
      <Show when={capabilities()} fallback={<span>{language.t("voice.models.none")}</span>}>
        <Show
          when={capabilities()?.language !== "automatic"}
          fallback={<span data-action="voice-language">{language.t("voice.models.auto")}</span>}
        >
          <Show
            when={capabilities()?.language !== "unknown"}
            fallback={
              <TextInputV2
                data-action="voice-language"
                appearance="base"
                value={current() === "auto" ? "" : current()}
                placeholder={language.t("voice.models.auto")}
                aria-label={language.t("voice.models.language")}
                onBlur={(event) => {
                  const value = event.currentTarget.value.trim() || "auto"
                  if (validVoiceLanguage(value)) void voice.configure(voice.config.selected, value)
                  if (!validVoiceLanguage(value)) event.currentTarget.value = current() === "auto" ? "" : current()
                }}
              />
            }
          >
            <SelectV2
              data-action="voice-language"
              appearance="inline"
              options={options()}
              current={current()}
              label={(value) =>
                value === "auto"
                  ? language.t("voice.models.auto")
                  : value === "ko"
                    ? language.t("voice.models.korean")
                    : value === "en"
                      ? language.t("voice.models.english")
                      : value
              }
              onSelect={(value) => value && void voice.configure(voice.config.selected, value)}
            />
          </Show>
        </Show>
      </Show>
    </SettingsRowV2>
  )
}

export function VoiceModelsSettings() {
  const manager = useOllamaModels()
  const voice = useVoice()
  const language = useLanguage()
  const recorder = createVoiceRecorder()
  const [state, setState] = createStore({
    filter: "",
    editing: "",
    name: "",
    languageMode: "unknown" as "unknown" | "automatic" | "selectable",
    languages: "",
    collapsed: {} as Record<string, boolean>,
    testing: undefined as ReturnType<typeof voice.models>[number] | undefined,
    processing: false,
    result: "",
    error: undefined as VoiceError | undefined,
  })
  const request = { id: "", generation: 0 }
  const cancel = () => {
    request.generation += 1
    if (request.id) void voice.cancel(request.id)
    recorder.cancel()
    setState({ processing: false, testing: undefined })
  }
  onCleanup(cancel)
  createEffect(
    on(
      () => recorder.state.status,
      (status) => {
        if (status !== "idle" || !state.testing) return
        request.generation += 1
        if (request.id) void voice.cancel(request.id)
        setState({ processing: false, testing: undefined })
      },
      { defer: true },
    ),
  )
  const test = (model: ReturnType<typeof voice.models>[number]) => {
    cancel()
    setState({ result: "", error: undefined })
    void recorder.start().then(() => {
      if (recorder.state.status !== "idle") setState("testing", model)
    })
  }
  const transcribe = async () => {
    const audio = recorder.audio()
    const model = state.testing
    if (!audio || !model || state.processing) return
    const generation = ++request.generation
    request.id = crypto.randomUUID()
    setState({ processing: true, error: undefined, result: "" })
    try {
      const wav = await voiceWav(audio)
      if (generation !== request.generation) return
      const result = await voice.transcribe({
        id: request.id,
        selection: { providerID: model.providerID, modelID: model.id },
        audio: wav,
        language: voice.config.language,
      })
      if (generation !== request.generation) return
      if (!result.ok) {
        if (result.error !== "cancelled") setState("error", result.error)
        return
      }
      setState("result", result.value)
    } catch {
      if (generation === request.generation) setState("error", "audio")
    } finally {
      if (generation === request.generation) setState("processing", false)
    }
  }
  const allModels = createMemo(() => [
    ...voice
      .models()
      .filter((model) => model.protocol !== "ollama")
      .map((model) => ({ ...model, registered: true })),
    ...manager.connections().flatMap((provider) => {
      const registered = voice.models().filter((model) => model.providerID === provider.id)
      const installed = manager.state.inventory[provider.id]
      if (!installed) return registered.map((model) => ({ ...model, registered: true }))
      return installed
        .filter((model) => manager.isVoice(provider.id, model.name))
        .map((model) => {
          const saved = registered.find((item) => ollamaTagKey(item.id) === ollamaTagKey(model.name))
          return saved
            ? { ...saved, registered: true }
            : {
                providerID: provider.id,
                providerName: provider.name,
                id: model.name,
                name: model.name,
                available: false,
                visible: false,
                local: false,
                protocol: "ollama" as const,
                capabilities: voiceAdapters["ollama-qwen"],
                location: "unknown" as const,
                registered: false,
              }
        })
    }),
  ])
  const key = (model: ReturnType<typeof voice.models>[number]) => `${model.providerID}:${model.id}`
  const options = () => [
    "none",
    ...allModels()
      .filter((model) => model.available && model.visible)
      .map(key),
  ]
  const providers = createMemo(() => [
    { id: localVoiceModel.providerID, name: language.t("voice.providers.local") },
    ...voice.config.providers
      .filter((provider) => voiceAdapter(provider) !== "ollama-qwen")
      .map((provider) => ({ id: provider.id, name: provider.name })),
    ...manager.connections(),
  ])
  const models = (id: string) =>
    allModels().filter(
      (model) =>
        model.providerID === id &&
        `${model.name} ${model.id} ${model.providerName ?? language.t("voice.providers.local")}`
          .toLowerCase()
          .includes(state.filter.toLowerCase()),
    )
  return (
    <div class="settings-v2-tab-body settings-v2-models voice-settings-models" data-component="voice-models-settings">
      <SettingsListV2>
        <SettingsRowV2 title={language.t("voice.models.default")} description={language.t("voice.models.description")}>
          <SelectV2
            data-action="voice-default-model"
            appearance="inline"
            options={options()}
            current={voice.selected() ? key(voice.selected()!) : "none"}
            aria-label={language.t("voice.models.default")}
            label={(value) => {
              const model = voice.models().find((item) => key(item) === value)
              return model
                ? `${model.providerName ?? language.t("voice.providers.local")} / ${model.name}`
                : language.t("voice.models.none")
            }}
            onSelect={(value) => {
              const model = voice.models().find((item) => key(item) === value)
              void voice.configure(model ? { providerID: model.providerID, modelID: model.id } : undefined)
            }}
          />
        </SettingsRowV2>
        <Show when={voice.selected()}>
          {(selected) => (
            <SettingsRowV2 title={language.t("voice.execution")} description="">
              <span>
                {language.t(`voice.execution.${selected().location as "device" | "remote" | "cloud" | "unknown"}`)}
              </span>
            </SettingsRowV2>
          )}
        </Show>
      </SettingsListV2>
      <TextInputV2
        appearance="base"
        type="search"
        aria-label={language.t("dialog.model.search.placeholder")}
        placeholder={language.t("dialog.model.search.placeholder")}
        value={state.filter}
        onInput={(event) => setState("filter", event.currentTarget.value)}
      />
      <For each={providers()}>
        {(provider) => (
          <Show when={models(provider.id).length || manager.connections().some((item) => item.id === provider.id)}>
            <div class="settings-v2-section" data-component="voice-models-provider" data-provider={provider.id}>
              <h3 class="settings-v2-models-group-header settings-v2-models-group-header--managed">
                <button
                  class="settings-v2-models-group-trigger"
                  type="button"
                  aria-expanded={!!state.filter || !state.collapsed[provider.id]}
                  onClick={() => setState("collapsed", provider.id, (value) => !value)}
                >
                  <span aria-hidden="true">{state.collapsed[provider.id] && !state.filter ? "▸" : "▾"}</span>
                  <span class="settings-v2-section-title">{provider.name}</span>
                </button>
                <Show when={manager.connections().some((item) => item.id === provider.id)}>
                  <manager.Trigger providerID={provider.id} />
                </Show>
              </h3>
              <manager.Panel providerID={provider.id} />
              <Show when={!!state.filter || !state.collapsed[provider.id]}>
                <SettingsListV2>
                  <For each={models(provider.id)}>
                    {(model) => (
                      <div data-component="ollama-model-row" data-model={model.id}>
                        <SettingsRowV2 title={model.name} description={model.id}>
                          <div class="voice-settings-actions">
                            <Show when={!model.local}>
                              <ButtonV2
                                size="small"
                                variant={
                                  (
                                    model.protocol === "ollama"
                                      ? manager.modelOpen(model.providerID, model.id)
                                      : state.editing === key(model)
                                  )
                                    ? "neutral"
                                    : "ghost-muted"
                                }
                                aria-expanded={
                                  model.protocol === "ollama"
                                    ? manager.modelOpen(model.providerID, model.id)
                                    : state.editing === key(model)
                                }
                                disabled={state.processing || manager.state.busy}
                                onClick={() => {
                                  if (model.protocol === "ollama")
                                    return manager.toggleModel(model.providerID, model.id)
                                  setState({
                                    editing: state.editing === key(model) ? "" : key(model),
                                    name: model.name,
                                    languageMode: model.capabilities.language,
                                    languages: model.capabilities.languages?.join(", ") ?? "",
                                  })
                                }}
                              >
                                {language.t("models.manage.edit")}
                              </ButtonV2>
                            </Show>
                            <ButtonV2
                              size="small"
                              variant="ghost-muted"
                              disabled={!model.available || state.processing}
                              onClick={() => test(model)}
                            >
                              {language.t("voice.models.test")}
                            </ButtonV2>
                            <Show when={!model.local}>
                              <Switch
                                checked={model.visible}
                                disabled={manager.state.busy}
                                onChange={async (visible) => {
                                  if (
                                    visible &&
                                    !model.registered &&
                                    !(await manager.enable(model.providerID, model.id, "voice"))
                                  )
                                    return
                                  await voice.visibility(model.providerID, model.id, visible)
                                }}
                                hideLabel
                              >
                                {language.t("voice.models.show", { model: model.name })}
                              </Switch>
                            </Show>
                          </div>
                        </SettingsRowV2>
                        <manager.Editor providerID={model.providerID} modelID={model.id} />
                        <Collapsible open={state.editing === key(model)} class="ollama-inline-collapse">
                          <Collapsible.Content>
                            <form
                              class="voice-settings-form"
                              onSubmit={(event) => {
                                event.preventDefault()
                                const model = voice.models().find((item) => key(item) === state.editing)
                                const provider = voice.config.providers.find((item) => item.id === model?.providerID)
                                if (!model || !provider || !state.name.trim()) return
                                void voice
                                  .save({
                                    ...provider,
                                    models: provider.models.map((item) =>
                                      item.id === model.id
                                        ? {
                                            ...item,
                                            name: state.name.trim(),
                                            languages:
                                              state.languageMode === "unknown"
                                                ? undefined
                                                : state.languageMode === "automatic"
                                                  ? []
                                                  : state.languages.split(",").map((value) => value.trim()),
                                          }
                                        : item,
                                    ),
                                  })
                                  .then((result) => {
                                    if (!result.ok) return setState("error", result.error)
                                    setState("editing", "")
                                  })
                              }}
                            >
                              <label class="voice-settings-field">
                                <span>{language.t("models.manage.name")}</span>
                                <TextInputV2
                                  appearance="base"
                                  required
                                  value={state.name}
                                  onInput={(event) => setState("name", event.currentTarget.value)}
                                  aria-label={language.t("models.manage.name")}
                                />
                              </label>
                              <label class="voice-settings-field">
                                <span>{language.t("voice.language.support")}</span>
                                <SelectV2
                                  appearance="base"
                                  data-action="voice-language-support"
                                  options={["unknown", "automatic", "selectable"] as const}
                                  current={state.languageMode}
                                  label={(value) => language.t(`voice.language.${value}`)}
                                  onSelect={(value) => value && setState("languageMode", value)}
                                />
                              </label>
                              <Show when={state.languageMode === "selectable"}>
                                <label class="voice-settings-field">
                                  <span>{language.t("voice.language.codes")}</span>
                                  <TextInputV2
                                    appearance="base"
                                    required
                                    value={state.languages}
                                    aria-label={language.t("voice.language.codes")}
                                    onInput={(event) => setState("languages", event.currentTarget.value)}
                                  />
                                </label>
                              </Show>
                              <div class="voice-settings-actions">
                                <ButtonV2 type="submit" variant="contrast">
                                  {language.t("common.save")}
                                </ButtonV2>
                                <ButtonV2 type="button" variant="ghost-muted" onClick={() => setState("editing", "")}>
                                  {language.t("common.cancel")}
                                </ButtonV2>
                              </div>
                            </form>
                          </Collapsible.Content>
                        </Collapsible>
                      </div>
                    )}
                  </For>
                  <Show when={provider.id === localVoiceModel.providerID}>
                    <LocalVoiceActions />
                  </Show>
                </SettingsListV2>
              </Show>
            </div>
          </Show>
        )}
      </For>
      <Show when={state.testing}>
        {(model) => (
          <div class="voice-settings-test" data-component="voice-model-test">
            <h3 class="settings-v2-section-title">{model().name}</h3>
            <p class="voice-settings-hint">{language.t("voice.models.test.description")}</p>
            <VoiceInput recorder={recorder} disabled={state.processing} />
            <div class="voice-settings-actions">
              <ButtonV2
                size="small"
                variant="neutral"
                disabled={recorder.state.status !== "ready" || state.processing}
                onClick={() => void transcribe()}
              >
                {language.t(state.processing ? "voice.transcribing" : "voice.models.transcribe")}
              </ButtonV2>
              <ButtonV2 size="small" variant="ghost-muted" onClick={cancel}>
                {language.t("common.cancel")}
              </ButtonV2>
            </div>
            <Show when={state.result}>
              <label class="voice-settings-field">
                <span>{language.t("voice.models.result")}</span>
                <p role="status" class="voice-settings-result">
                  {state.result}
                </p>
              </label>
            </Show>
            <Show when={state.error}>
              {(error) => (
                <p role="alert" class="voice-settings-hint">
                  {language.t(`voice.model.error.${error()}`)}
                </p>
              )}
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}
