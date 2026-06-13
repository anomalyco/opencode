import { Component, createResource, createSignal, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Icon } from "@opencode-ai/ui/icon"

const DEFAULT_PREFERENCES = `# User Preferences

<!-- Edit this file to customize how the AI assistant interacts with you. -->
<!-- This file is in Markdown format and will be included in the system prompt. -->

## Communication

- Language: Respond in the same language the user uses
- Verbosity: Concise by default, detailed when asked

## Code Style

- Follow existing project conventions
- Prefer idiomatic patterns for each language

## Behavior

- Ask for clarification when requirements are ambiguous
- Explain trade-offs when multiple approaches exist
`

export const SettingsPreferencesV2: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()

  const [preferences, setPreferences] = createSignal("")
  const [isDirty, setIsDirty] = createSignal(false)
  const [isSaving, setIsSaving] = createSignal(false)
  const [saveStatus, setSaveStatus] = createSignal<"idle" | "success" | "error">("idle")

  const [initialPreferences] = createResource(async () => {
    try {
      const response = await serverSDK.client.global.preferences.get()
      const content = response.data as string
      return content || DEFAULT_PREFERENCES
    } catch {
      return DEFAULT_PREFERENCES
    }
  })

  const handleContentChange = (event: Event) => {
    const target = event.target as HTMLTextAreaElement
    setPreferences(target.value)
    setIsDirty(true)
    setSaveStatus("idle")
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await serverSDK.client.global.preferences.update({ body: preferences() })
      setIsDirty(false)
      setSaveStatus("success")
      setTimeout(() => setSaveStatus("idle"), 2000)
    } catch {
      setSaveStatus("error")
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = async () => {
    setPreferences(DEFAULT_PREFERENCES)
    setIsDirty(true)
    setSaveStatus("idle")
  }

  return (
    <div class="flex flex-col gap-4 h-full">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-medium text-foreground-primary">
            {language.t("settings.preferences.title", "User Preferences")}
          </h3>
          <p class="text-xs text-foreground-secondary mt-1">
            {language.t(
              "settings.preferences.description",
              "Customize how the AI assistant interacts with you. Changes are saved in Markdown format and included in the system prompt.",
            )}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <ButtonV2 variant="ghost" size="sm" onClick={handleReset}>
            <Icon name="rotate-ccw" class="size-3.5" />
            {language.t("settings.preferences.reset", "Reset")}
          </ButtonV2>
          <ButtonV2
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!isDirty() || isSaving()}
          >
            <Show when={saveStatus() === "success"}>
              <Icon name="check" class="size-3.5 text-green-500" />
            </Show>
            <Show when={saveStatus() === "error"}>
              <Icon name="x" class="size-3.5 text-red-500" />
            </Show>
            <Show when={saveStatus() === "idle" || saveStatus() === "success"}>
              {isSaving()
                ? language.t("settings.preferences.saving", "Saving...")
                : language.t("settings.preferences.save", "Save")}
            </Show>
          </ButtonV2>
        </div>
      </div>

      <textarea
        class="flex-1 w-full min-h-[400px] p-4 font-mono text-sm bg-background-secondary border border-border-primary rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        value={preferences()}
        onInput={handleContentChange}
        placeholder={DEFAULT_PREFERENCES}
        spellcheck={false}
      />
    </div>
  )
}
