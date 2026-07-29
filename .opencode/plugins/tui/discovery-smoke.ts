import type { Context } from "../../../packages/plugin/src/tui/context"

export default {
  id: "test.tui-discovery-smoke",
  setup(context: Context) {
    const timer = setTimeout(() => {
      context.ui.toast.show({
        title: "TUI plugin discovery works",
        message: "Loaded .opencode/plugins/tui/discovery-smoke.ts",
        variant: "success",
        duration: 30_000,
      })
    }, 1_000)
    return () => clearTimeout(timer)
  },
}
