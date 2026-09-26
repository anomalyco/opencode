import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"
import { onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { deepLinkEvent, drainPendingDeepLinks, parseConnectionDeepLink } from "@/pages/layout/deep-links"
import { checkServerHealth } from "@/utils/server-health"

type Connection = NonNullable<ReturnType<typeof parseConnectionDeepLink>>

function ConnectionDialog(props: { connection: Connection; onClose: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const server = useServer()
  const tabs = useTabs()
  const platform = usePlatform()
  const [state, setState] = createStore({ busy: false, error: false })
  let closed = false
  onCleanup(() => {
    closed = true
    props.onClose()
  })

  async function connect() {
    if (state.busy) return
    setState({ busy: true, error: false })
    const existing = server.list.find((conn) => conn.http.url === props.connection.url)
    const conn = existing ?? { type: "http" as const, http: { url: props.connection.url } }
    try {
      const result = await checkServerHealth(conn.http, platform.fetch ?? globalThis.fetch, {
        timeoutMs: 5000,
        retryCount: 0,
      })
      if (closed) return
      if (!result.healthy) {
        setState({ busy: false, error: true })
        return
      }
      // Preserve existing credentials and the user's default-server preference.
      if (!existing && conn.type === "http") server.add(conn)
      const key = ServerConnection.key(conn)
      server.projects.forServer(key).open(props.connection.directory)
      server.setActive(key)
      await tabs.newDraft({ server: key, directory: props.connection.directory })
      dialog.close()
    } catch {
      if (!closed) setState({ busy: false, error: true })
    }
  }

  return (
    <Dialog title={language.t("command.project.open")}>
      <div class="flex flex-col gap-4 px-5 pb-5">
        <dl class="flex flex-col gap-2 break-all">
          <dt>{language.t("dialog.server.add.url")}</dt>
          <dd>{props.connection.url}</dd>
          <dt>{language.t("dialog.directory.action.selectFolder")}</dt>
          <dd>{props.connection.directory}</dd>
        </dl>
        <Show when={state.error}>
          <p role="alert">{language.t("dialog.server.add.error")}</p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button disabled={state.busy} onClick={() => void connect()}>
            {language.t(state.busy ? "dialog.server.add.checking" : "command.project.open")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function ConnectionLinks() {
  const dialog = useDialog()
  let pending = false
  const handle = (urls: string[]) => {
    if (pending) return
    const connection = urls.map(parseConnectionDeepLink).find((link) => !!link)
    if (!connection) return
    pending = true
    void dialog.show(() => <ConnectionDialog connection={connection} onClose={() => (pending = false)} />)
  }
  onMount(() => {
    handle(drainPendingDeepLinks(window, "connection"))
    makeEventListener(window, deepLinkEvent, (event) => {
      if (!(event instanceof CustomEvent)) return
      const detail: unknown = event.detail
      if (!detail || typeof detail !== "object" || !("urls" in detail)) return
      const urls = detail.urls
      if (Array.isArray(urls)) handle(urls.filter((url) => typeof url === "string"))
    })
  })
  return null
}
