import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { createMemo, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { showToast } from "@/utils/toast"
import { LOCAL_VOICE_MODELS, type LocalVoiceModel, type LocalVoiceState } from "../../voice"

const backendOptions: ("local" | "ai")[] = ["local", "ai"]

export function VoiceSettingsV2() {
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const models = useModels()
  const [local, setLocal] = createStore<LocalVoiceState>({
    runtime: false,
    transcribing: false,
    models: Object.fromEntries(
      LOCAL_VOICE_MODELS.map((model) => [model, { size: 0, installed: false }]),
    ) as LocalVoiceState["models"],
  })
  const audioModels = createMemo(() => models.list().filter((model) => model.capabilities.input.audio))
  const selectedLocal = () => local.models[settings.voice.localModel()]
  const selectedAI = createMemo(() => {
    const selected = settings.voice.aiModel()
    if (!selected) return
    return audioModels().find((model) => model.provider.id === selected.providerID && model.id === selected.modelID)
  })

  onMount(() => {
    const voice = platform.localVoice
    if (!voice) return
    void voice.state().then(setLocal)
    const unsubscribe = voice.subscribe(setLocal)
    onCleanup(unsubscribe)
  })

  const localLabel = (model: LocalVoiceModel) => {
    if (model === "tiny") return language.t("voice.model.tiny")
    if (model === "base") return language.t("voice.model.base")
    if (model === "small") return language.t("voice.model.small")
    return language.t("voice.model.turbo")
  }
  const action = async () => {
    const voice = platform.localVoice
    if (!voice) return
    const model = settings.voice.localModel()
    const current = local.models[model]
    const task = current.download
      ? voice.cancelDownload(model)
      : current.installed
        ? voice.remove(model)
        : voice.download(model)
    await task.catch(() =>
      showToast({
        variant: "error",
        title: language.t("voice.error.title"),
        description: language.t("voice.error.downloadFailed"),
      }),
    )
  }
  const actionLabel = () => {
    const current = selectedLocal()
    if (current.download) {
      const progress = Math.min(99, Math.floor((current.download.received / current.download.total) * 100))
      return language.t("voice.action.cancelDownloadProgress", { progress })
    }
    if (current.installed) return language.t("voice.action.removeModel")
    return language.t("voice.action.downloadModel")
  }

  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.general.section.voice")}</h3>
      <SettingsListV2>
        <SettingsRowV2
          title={language.t("voice.settings.enabled.title")}
          description={language.t("voice.settings.enabled.description")}
        >
          <div data-action="settings-voice-enabled">
            <Switch
              aria-label={language.t("voice.settings.enabled.title")}
              checked={settings.voice.enabled()}
              onChange={settings.voice.setEnabled}
            />
          </div>
        </SettingsRowV2>

        <SettingsRowV2
          title={language.t("voice.settings.backend.title")}
          description={language.t("voice.settings.backend.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-voice-backend"
            options={backendOptions}
            current={backendOptions.find((option) => option === settings.voice.backend())}
            label={(option) =>
              option === "local" ? language.t("voice.backend.local") : language.t("voice.backend.ai")
            }
            onSelect={(option) => option && settings.voice.setBackend(option)}
            placement="bottom-end"
            gutter={6}
          />
        </SettingsRowV2>

        <Show when={settings.voice.backend() === "local"}>
          <SettingsRowV2
            title={language.t("voice.settings.localModel.title")}
            description={
              local.runtime
                ? language.t("voice.settings.localModel.description", {
                    size: Math.round(selectedLocal().size / 1024 / 1024),
                  })
                : language.t("voice.settings.runtimeUnavailable")
            }
          >
            <div class="flex items-center gap-2">
              <SelectV2
                appearance="inline"
                data-action="settings-voice-local-model"
                options={[...LOCAL_VOICE_MODELS]}
                current={LOCAL_VOICE_MODELS.find((model) => model === settings.voice.localModel())}
                label={localLabel}
                onSelect={(model) => model && settings.voice.setLocalModel(model)}
                placement="bottom-end"
                gutter={6}
              />
              <ButtonV2
                size="normal"
                variant="neutral"
                disabled={!local.runtime || local.transcribing}
                onClick={() => void action()}
              >
                {actionLabel()}
              </ButtonV2>
            </div>
          </SettingsRowV2>
        </Show>

        <Show when={settings.voice.backend() === "ai"}>
          <SettingsRowV2
            title={language.t("voice.settings.aiModel.title")}
            description={
              audioModels().length
                ? language.t("voice.settings.aiModel.description")
                : language.t("voice.settings.aiModel.empty")
            }
          >
            <Show when={audioModels().length > 0}>
              <div dir="auto">
                <SelectV2
                  appearance="inline"
                  data-action="settings-voice-ai-model"
                  options={audioModels()}
                  current={selectedAI()}
                  value={(model) => `${model.provider.id}/${model.id}`}
                  label={(model) => `${model.provider.name} · ${model.name}`}
                  children={(model) => <span dir="auto">{`${model.provider.name} · ${model.name}`}</span>}
                  onSelect={(model) =>
                    model && settings.voice.setAIModel({ providerID: model.provider.id, modelID: model.id })
                  }
                  placement="bottom-end"
                  gutter={6}
                />
              </div>
            </Show>
          </SettingsRowV2>
        </Show>
      </SettingsListV2>
    </div>
  )
}
