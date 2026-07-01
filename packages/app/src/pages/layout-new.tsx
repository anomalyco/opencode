import { makeEventListener } from "@solid-primitives/event-listener"
import { useNavigate } from "@solidjs/router"
import { DebugBar } from "@/components/debug-bar"
import { HelpButton } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useTabs } from "@/context/tabs"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "@/pages/layout/deep-links"
import { setNavigate } from "@/utils/notification-click"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { createEffect, createResource, onMount, Suspense, type ParentProps } from "solid-js"

export default function NewLayout(props: ParentProps) {
  const layout = useLayout()
  const server = useServer()
  const serverSDK = useServerSDK()
  const tabs = useTabs()
  const platform = usePlatform()
  const navigate = useNavigate()
  setNavigate(navigate)

  const [session] = createResource(
    () => {
      const route = layout.route()
      if (route.type !== "session") return
      return route.sessionId
    },
    (sessionID) =>
      serverSDK()
        .client.session.get({ sessionID })
        .then((x) => x.data)
        .catch(() => {}),
  )

  createEffect(() => setV2Toast(true))

  const currentDirectory = () => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      return (
        tabs.store.flatMap((tab) =>
          tab.type === "draft" && tab.draftID === route.draftID ? [tab.directory] : [],
        )[0] ??
        layout.projects.list()[0]?.worktree
      )
    }
    if (route.type === "session") return session()?.directory ?? layout.projects.list()[0]?.worktree
    return layout.projects.list()[0]?.worktree
  }

  const handleDeepLinks = (urls: string[]) => {
    if (!server.isLocal()) return

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      layout.projects.open(directory)
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      const directory = link.directory ?? currentDirectory()
      if (!directory) continue
      layout.projects.open(directory)
      tabs.newDraft({ server: server.key, directory }, link.prompt)
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ urls: string[] }>).detail
      const urls = detail?.urls ?? []
      if (urls.length === 0) return
      handleDeepLinks(urls)
    }

    handleDeepLinks(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)
  })

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
