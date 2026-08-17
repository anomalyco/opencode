import { onCleanup } from "solid-js"
import { useThemes } from "../context/theme"
import { useToast } from "../ui/toast"

export function ThemeErrorToast() {
  const themes = useThemes()
  const toast = useToast()

  onCleanup(
    themes.onError(({ name, error }) =>
      toast.show({
        variant: "error",
        title: `Failed to load theme: ${name}`,
        message: error.message,
      }),
    ),
  )

  return null
}
