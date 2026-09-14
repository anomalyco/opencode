import { onCleanup } from "solid-js"
import { useThemes } from "../context/theme"
import { useToast } from "../ui/toast"
import { useLanguage } from "../context/language"

export function ThemeErrorToast() {
  const language = useLanguage()
  const themes = useThemes()
  const toast = useToast()

  onCleanup(
    themes.onError(({ name, error }) =>
      toast.show({
        variant: "error",
        title: language.t("tui.dialogs.themeLoadFailed", { name }),
        message: error.message,
      }),
    ),
  )

  return null
}
