import { createEffect, onMount, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { setV2Toast, showToast, ToastRegion } from "@/utils/toast"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  collectOpenSessionDeepLinks,
  deepLinkEvent,
  drainPendingDeepLinks,
} from "./layout/deep-links"

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  useDeepLinks()
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
      <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
        <Suspense>{props.children}</Suspense>
      </main>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}

function useDeepLinks() {
  const server = useServer()
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()

  const handle = (urls: string[]) => {
    if (!server.isLocal()) return
    const current = server.current
    if (!current) return
    const key = ServerConnection.key(current)
    const context = global.ensureServerCtx(current)
    const projects = context.projects
    const open = (directory: string) => {
      projects.open(directory)
      projects.touch(directory)
    }

    for (const directory of collectOpenProjectDeepLinks(urls)) {
      open(directory)
      void tabs.newDraft({ server: key, directory })
    }

    for (const link of collectNewSessionDeepLinks(urls)) {
      open(link.directory)
      void tabs.newDraft({ server: key, directory: link.directory }, link.prompt)
    }

    for (const sessionID of collectOpenSessionDeepLinks(urls)) {
      void context.sdk.api.session
        .get({ sessionID })
        .then((session) => {
          open(session.location.directory)
          tabs.select(tabs.addSessionTab({ server: key, sessionId: session.id }))
        })
        .catch(() =>
          showToast({
            title: language.t("session.error.notFound"),
            description: language.t("session.error.notFound.description"),
          }),
        )
    }
  }

  onMount(() => {
    const listener = (event: Event) => {
      const urls = (event as CustomEvent<{ urls: string[] }>).detail?.urls ?? []
      if (urls.length) handle(urls)
    }
    handle(drainPendingDeepLinks(window))
    makeEventListener(window, deepLinkEvent, listener as EventListener)
  })
}
