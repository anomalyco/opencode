import { createEffect, Suspense, type ParentProps } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { DebugBar } from "@/components/debug-bar"
import { HelpButton } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { setNavigate } from "@/utils/notification-click"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { useSettingsCommand } from "@/components/settings-dialog"
import { collectNewSessionDeepLinks, collectOpenProjectDeepLinks } from "./layout/deep-links"
import { useDeepLinkListener } from "./layout/use-deep-link-listener"

export default function NewLayout(props: ParentProps) {
  const layout = useLayout()
  const platform = usePlatform()
  const server = useServer()
  const tabs = useTabs()
  const navigate = useNavigate()
  setNavigate(navigate)
  useSettingsCommand()

  createEffect(() => setV2Toast(true))

  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return

    for (const link of collectOpenProjectDeepLinks(urls)) {
      layout.projects.open(link.directory)
      layout.home.setSelection({ server: server.key, directory: link.directory })
      if (link.sessionId) {
        navigate(`/${base64Encode(link.directory)}/session/${link.sessionId}`)
        continue
      }
      navigate("/")
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      layout.projects.open(link.directory)
      layout.home.setSelection({ server: server.key, directory: link.directory })
      void openNewSession(link.directory, link.prompt)
    }
  }

  useDeepLinkListener(handleDeepLinks)

  async function openNewSession(directory: string, prompt?: string) {
    if (!tabs.ready()) await tabs.ready.promise
    tabs.newDraft({ server: server.key, directory }, prompt)
  }

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
      <Titlebar update={update} />
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
      {import.meta.env.DEV && <DebugBar inline />}
      <HelpButton />
      <ToastRegion v2 />
    </div>
  )
}
