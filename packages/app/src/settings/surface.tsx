import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, on } from "solid-js"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { useLayout, type LayoutRoute } from "@/shell/state/layout"
import { useCommand } from "@/shell/commands/command"

export const { use: useSettingsSurface, provider: SettingsSurfaceProvider } = createSimpleContext({
  name: "SettingsSurface",
  gate: false,
  init: () => {
    const navigate = useNavigate()
    const layout = useLayout()
    const command = useCommand()
    const location = useLocation<{
      settings?: { route: Exclude<LayoutRoute, { type: "settings" }>; tab: string }
    }>()
    const open = () => layout.route().type === "settings"
    const source = () => location.state?.settings?.route ?? { type: "home" as const }
    let focus: HTMLElement | undefined

    createEffect(
      on(
        open,
        (value) => {
          if (value) return
          if (focus?.isConnected) focus.focus({ preventScroll: true })
          focus = undefined
        },
        { defer: true },
      ),
    )

    return {
      active: open,
      route: source,
      tab: () => location.state?.settings?.tab ?? "general",
      open(tab = "general") {
        const route = layout.route()
        if (route.type !== "settings") {
          if (document.activeElement instanceof HTMLElement) focus = document.activeElement
        }
        navigate("/settings", {
          replace: open(),
          state: { settings: { route: route.type === "settings" ? source() : route, tab } },
        })
      },
      close() {
        if (open()) command.trigger("common.goBack")
      },
    }
  },
})
