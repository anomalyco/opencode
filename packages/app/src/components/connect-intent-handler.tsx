import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection, useServer } from "@/context/server"
import { useSettings } from "@/context/settings"
import { useTabs } from "@/context/tabs"
import {
  collectConnectIntents,
  deepLinkEvent,
  parseConnectIntent,
  takePendingDeepLinks,
  type ConnectIntent,
} from "@/pages/layout/deep-links"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useNavigate } from "@solidjs/router"
import { makeEventListener } from "@solid-primitives/event-listener"
import { onMount } from "solid-js"

export function ConnectIntentHandler() {
  const pickDirectory = useDirectoryPicker()
  const language = useLanguage()
  const settings = useSettings()
  const navigate = useNavigate()
  const dialog = useDialog()
  const global = useGlobal()
  const server = useServer()
  const tabs = useTabs()
  let activeFlow: AbortController | undefined

  const openProject = (conn: ServerConnection.Any, directory: string) => {
    const projects = global.ensureServerCtx(conn).projects
    projects.open(directory)
    projects.touch(directory)
    server.setActive(ServerConnection.key(conn))
    if (settings.general.newLayoutDesigns()) {
      void tabs.newDraft({ server: ServerConnection.key(conn), directory })
      return
    }
    navigate(`/${base64Encode(directory)}`)
  }

  const selectDirectory = (conn: ServerConnection.Any, directory?: string) => {
    if (!directory) {
      server.setActive(ServerConnection.key(conn))
      navigate("/")
      return
    }
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      start: directory,
      onSelect: (result) => {
        if (typeof result === "string") openProject(conn, result)
      },
    })
  }

  const openExisting = async (
    conn: ServerConnection.Http,
    directory?: string,
    closeAfterOpen = false,
    signal?: AbortSignal,
  ) => {
    if (signal?.aborted) return
    if (!directory) {
      selectDirectory(conn)
      if (closeAfterOpen) dialog.close()
      return
    }
    const ctx = global.ensureServerCtx(conn)
    const resolved = directory.startsWith("~")
      ? await ctx.sdk.client.path
          .get()
          .then((result) => result.data?.home && directory.replace(/^~(?=\/|$)/, result.data.home))
          .catch(() => undefined)
      : directory
    if (signal?.aborted) return
    if (!resolved) {
      selectDirectory(conn, directory)
      return
    }
    const valid = await ctx.sdk.api.file
      .list({ location: { directory: resolved } })
      .then(() => true)
      .catch(() => false)
    if (signal?.aborted) return
    if (valid) {
      openProject(conn, resolved)
      if (closeAfterOpen) dialog.close()
      return
    }
    selectDirectory(conn, resolved)
  }

  const openServer = (intent: ConnectIntent) => {
    activeFlow?.abort()
    const flow = new AbortController()
    activeFlow = flow
    const existing = global.servers
      .list()
      .find(
        (conn): conn is ServerConnection.Http =>
          conn.type === "http" && ServerConnection.key(conn) === ServerConnection.Key.make(intent.server),
    )
    if (existing) {
      void openExisting(existing, intent.directory, false, flow.signal)
      return
    }

    const onAdded = (conn: ServerConnection.Http, signal: AbortSignal) =>
      openExisting(conn, intent.directory, true, AbortSignal.any([flow.signal, signal]))
    if (settings.general.newLayoutDesigns()) {
      void import("@/components/settings-v2/dialog-server-v2").then(({ DialogServerV2 }) => {
        if (flow.signal.aborted) return
        dialog.show(() => <DialogServerV2 mode="add" url={intent.server} onAdded={onAdded} />, () => flow.abort())
      })
      return
    }
    void import("@/components/dialog-select-server").then(({ DialogSelectServer }) => {
      if (flow.signal.aborted) return
      dialog.show(() => <DialogSelectServer url={intent.server} onAdded={onAdded} />, () => flow.abort())
    })
  }

  const consume = () => {
    const urls = takePendingDeepLinks(window, (input) => !!parseConnectIntent(input))
    const intent = collectConnectIntents(urls).at(-1)
    if (intent) openServer(intent)
  }

  onMount(() => {
    const web = parseConnectIntent(window.location.href)
    if (web) {
      history.replaceState(history.state, "", location.pathname + location.search)
      openServer(web)
    }
    consume()
    makeEventListener(window, deepLinkEvent, consume)
  })

  return null
}
