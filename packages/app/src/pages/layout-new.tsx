import { createEffect, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { usePlatform } from "@/context/platform"
import { useCommand } from "@/context/command"
import { useExplorer, ExplorerProvider } from "@/context/explorer"
import { useLayout } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { setNavigate } from "@/utils/notification-click"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { ProjectExplorerSidebar } from "@/pages/layout/explorer-sidebar"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const navigate = useNavigate()
  setNavigate(navigate)
  const [state, setState] = createStore({ debugTools: true })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <ExplorerProvider>
        <ProjectExplorerShell>{props.children}</ProjectExplorerShell>
      </ExplorerProvider>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}

function ProjectExplorerShell(props: ParentProps) {
  const explorer = useExplorer()
  const layout = useLayout()
  const language = useLanguage()
  const command = useCommand()

  command.register("explorer", () => [
    {
      id: "explorer.toggle",
      title: language.t("command.fileTree.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+shift+e",
      onSelect: () => layout.explorer.toggle(),
    },
  ])

  return (
    <div class="flex flex-1 min-h-0 min-w-0 gap-2">
      <ProjectExplorerSidebar />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
    </div>
  )
}
