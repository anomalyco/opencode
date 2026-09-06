import { createEffect, onCleanup, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { debounce } from "@solid-primitives/scheduled"
import type { Config } from "@opencode-ai/sdk/v2/client"
import { TextField } from "@opencode-ai/ui/text-field"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { SettingsList } from "./settings-list"
import { SettingsListV2 } from "./settings-v2/parts/list"

// The parallel config PR adds `customInstructions?: string` to the global
// config schema. Until the regenerated SDK types include it, read and write
// the field through this narrow extension instead of `any`.
type GlobalConfigWithCustomInstructions = Config & { customInstructions?: string }

const SAVE_DELAY = 500

function createCustomInstructionsModel() {
  const serverSync = useServerSync()
  const saved = () => {
    const config = serverSync().data.config as GlobalConfigWithCustomInstructions
    return config.customInstructions ?? ""
  }
  const [store, setStore] = createStore({ draft: "", dirty: false })
  createEffect(() => {
    if (store.dirty) return
    setStore("draft", saved())
  })
  const persist = debounce((next: string) => {
    void serverSync().updateConfig({ customInstructions: next } as unknown as Config)
  }, SAVE_DELAY)
  onCleanup(() => persist.clear())
  return {
    draft: () => store.draft,
    update: (next: string) => {
      setStore({ draft: next, dirty: true })
      persist(next)
    },
  }
}

export const SettingsCustomInstructions: Component = () => {
  const language = useLanguage()
  const model = createCustomInstructionsModel()
  return (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.customInstructions.title")}</h3>
      <SettingsList>
        <div class="flex flex-col gap-2 py-3">
          <span class="text-12-regular text-text-weak">{language.t("settings.customInstructions.description")}</span>
          <TextField
            data-action="settings-custom-instructions"
            label={language.t("settings.customInstructions.title")}
            hideLabel
            multiline
            value={model.draft()}
            onChange={(value) => model.update(value)}
            placeholder={language.t("settings.customInstructions.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
          />
          <span class="text-12-regular text-text-weak">{language.t("settings.customInstructions.hint")}</span>
        </div>
      </SettingsList>
    </div>
  )
}

export const SettingsCustomInstructionsV2: Component = () => {
  const language = useLanguage()
  const model = createCustomInstructionsModel()
  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title">{language.t("settings.customInstructions.title")}</h3>
      <SettingsListV2>
        <div data-component="settings-v2-row">
          <div class="flex w-full flex-col gap-3">
            <div data-slot="settings-v2-row-description">
              {language.t("settings.customInstructions.description")}
            </div>
            <TextareaV2
              data-action="settings-custom-instructions"
              rows={5}
              value={model.draft()}
              placeholder={language.t("settings.customInstructions.placeholder")}
              aria-label={language.t("settings.customInstructions.title")}
              spellcheck={false}
              onInput={(event) => model.update(event.currentTarget.value)}
            />
            <div data-slot="settings-v2-row-description">{language.t("settings.customInstructions.hint")}</div>
          </div>
        </div>
      </SettingsListV2>
    </div>
  )
}
