import { createEffect, onCleanup, onMount, type ParentProps } from "solid-js"
import { MetaProvider } from "@solidjs/meta"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { Font } from "@opencode/ui/font"
import { ThemeProvider, useTheme, type ColorScheme } from "@opencode/ui/theme"
import { LanguageProvider, UiI18nBridge, useLanguage } from "@/runtime/i18n/language"
import { SettingsProvider } from "@/settings/model"

export function StoryProviders(props: ParentProps<{ scheme?: ColorScheme; direction?: string; locale?: string }>) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider locale={props.locale ?? "en"}>
          <UiI18nBridge>
            <Appearance scheme={props.scheme} direction={props.direction} />
            <SettingsProvider>
              <DialogProvider>{props.children}</DialogProvider>
            </SettingsProvider>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function Appearance(props: { scheme?: ColorScheme; direction?: string }) {
  const theme = useTheme()

  const language = useLanguage()

  createEffect(() => props.scheme && theme.setColorScheme(props.scheme))
  createEffect(() => {
    document.documentElement.classList.remove("light", "dark")
    document.documentElement.classList.add(theme.mode())
  })
  createEffect(() => language.setDirection(props.direction === "rtl" ? "rtl" : "ltr"))

  // The app derives this attribute from its reduce motion setting; stories follow the system preference.
  onMount(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)")

    const apply = () => (document.documentElement.dataset.motion = motion.matches ? "reduce" : "full")

    apply()
    motion.addEventListener("change", apply)
    onCleanup(() => motion.removeEventListener("change", apply))
  })

  return null
}
