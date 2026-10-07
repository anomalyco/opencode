import { For, Show } from "solid-js"
import { useTheme } from "@opencode/ui/theme/context"
import { useLanguage } from "@/runtime/i18n/language"

const themes = ["elle", "sweetheart", "forest", "buttercream", "kota", "kota-blush", "mermaid"]

export function DevThemeSwitcher() {
  const theme = useTheme()
  const language = useLanguage()

  return (
    <div
      class="fixed right-3 top-14 z-[1000] flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 px-3 py-2 text-[13px] leading-(--line-height-compact) text-v2-text-text-base shadow-lg"
      role="group"
      aria-label={language.t("dev.themeSwitcher.title")}
    >
      <label for="dev-custom-theme" class="shrink-0 font-medium">
        {language.t("dev.themeSwitcher.title")}
      </label>
      <select
        id="dev-custom-theme"
        class="min-w-0 rounded border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
        value={themes.includes(theme.themeId()) ? theme.themeId() : ""}
        onChange={(event) => theme.setTheme(event.currentTarget.value)}
      >
        <Show when={!themes.includes(theme.themeId())}>
          <option value="" disabled>
            {language.t("dev.themeSwitcher.choose")}
          </option>
        </Show>
        <For each={themes}>{(id) => <option value={id}>{theme.name(id)}</option>}</For>
      </select>
      <select
        aria-label={language.t("settings.general.row.colorScheme.title")}
        class="min-w-0 rounded border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-v2-border-border-focus"
        value={theme.colorScheme()}
        onChange={(event) => {
          const value = event.currentTarget.value

          if (value === "light" || value === "dark" || value === "system") theme.setColorScheme(value)
        }}
      >
        <option value="light">{language.t("theme.scheme.light")}</option>
        <option value="dark">{language.t("theme.scheme.dark")}</option>
        <option value="system">{language.t("theme.scheme.system")}</option>
      </select>
    </div>
  )
}
