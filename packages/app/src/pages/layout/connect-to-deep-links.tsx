import { createEffect, onMount, Show } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ServerConnection, useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { clearConnect, connectFlow, consumeConnect } from "./connect-flow"
import {
  type ConnectToDeepLink,
  collectConnectToDeepLinks,
  deepLinkEvent,
  drainConnectToDeepLinks,
} from "./deep-links"

export function toServerConnection(link: ConnectToDeepLink): ServerConnection.Http {
  return {
    type: "http",
    filesystem: "server",
    http: { url: link.uri },
    ...(link.name ? { displayName: link.name } : {}),
  }
}

function ConnectingDialog(props: { onDismiss: () => void }) {
  const language = useLanguage()
  const failed = () => connectFlow.state()?.status === "error"

  return (
    <Dialog title={language.t("dialog.connect.connecting.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex items-center gap-x-3">
          <Show when={failed()} fallback={<Spinner />}>
            <Icon name="circle-ban-sign" class="text-icon-critical-base" />
          </Show>
          <span class="text-14-regular text-text-strong">
            {failed()
              ? language.t("dialog.connect.connecting.error")
              : language.t("dialog.connect.connecting.description")}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => props.onDismiss()}>
            {failed() ? language.t("common.dismiss") : language.t("common.cancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function useConnectToDeepLinks() {
  const dialog = useDialog()
  const server = useServer()
  let connectingOpen = false

  createEffect(() => {
    const state = connectFlow.state()
    if (state?.status === "pending" && !connectingOpen) {
      connectingOpen = true
      dialog.show(
        () => <ConnectingDialog onDismiss={() => dialog.close()} />,
        () => {
          connectingOpen = false
          clearConnect()
        },
      )
    }
  })

  const handle = (urls: string[]) => {
    for (const link of collectConnectToDeepLinks(urls)) {
      if (!consumeConnect(link.request)) continue
      // Close the modal before add() — it navigates and can unmount this component.
      dialog.close()
      server.add(toServerConnection(link))
    }
  }

  onMount(() => {
    const handler = (event: Event) => {
      const urls = (event as CustomEvent<{ urls: string[] }>).detail?.urls ?? []
      if (urls.length === 0) return
      handle(urls)
    }
    handle(drainConnectToDeepLinks(window))
    makeEventListener(window, deepLinkEvent, handler as EventListener)
  })
}
