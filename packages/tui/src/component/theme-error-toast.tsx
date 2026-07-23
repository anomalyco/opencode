import { onCleanup } from "solid-js"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"

export function ThemeErrorToast() {
  const theme = useTheme()
  const toast = useToast()

  onCleanup(
    theme.onError(({ name, error }) =>
      toast.show({
        variant: "error",
        title: `Failed to load theme: ${name}`,
        message: error.message,
      }),
    ),
  )

  return null
}
