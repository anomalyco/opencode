import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"

export function useSettingsBackgroundImage() {
  const platform = usePlatform()
  const language = useLanguage()
  const [state, setState] = createStore({ busy: false })

  const run = async (action: (() => Promise<unknown>) | undefined) => {
    if (!action || state.busy) return
    setState("busy", true)
    try {
      await action()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setState("busy", false)
    }
  }

  return {
    available: !!platform.selectBackgroundImage,
    active: () => platform.backgroundImage?.() ?? false,
    get busy() {
      return state.busy
    },
    select: () => run(platform.selectBackgroundImage),
    clear: () => run(platform.clearBackgroundImage),
  }
}
