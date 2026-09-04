import { createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useLog } from "./log"
import { useStorage } from "./storage"
import { useEvent } from "./event"
import { errorMessage } from "../util/error"
import { useExit } from "./exit"

type ClientNotice = { readonly type: "available" | "installed"; readonly version: string }
type Notice = ClientNotice & ({ readonly source: "client" } | { readonly source: "server"; readonly remote: boolean })
export type UpdateNotificationState =
  | Notice
  | { readonly source: "client"; readonly type: "installing"; readonly version: string }
  | { readonly source: "client"; readonly type: "install-success"; readonly version: string }
  | { readonly source: "client"; readonly type: "failed"; readonly version: string; readonly message: string }

export type UpdateSource = {
  readonly remote: boolean
  readonly subscribe: (notify: (notice: ClientNotice) => void, signal: AbortSignal) => Promise<void>
  readonly apply: (version: string) => Promise<void>
}

export const { use: useUpdateNotification, provider: UpdateNotificationProvider } = createSimpleContext({
  name: "UpdateNotification",
  init: (props: { updater?: UpdateSource }) => {
    const event = useEvent()
    const exit = useExit()
    const log = useLog({ component: "update-notification" })
    const [state, setState] = createSignal<UpdateNotificationState>()
    const [notifications, markNotification] = useStorage().store<{ versions: string[] }>("update-notifications", {
      initial: { versions: [] },
    })

    const notify = (notice: Notice) => {
      if (
        !props.updater ||
        notifications.versions.includes(`${notice.source}:${notice.version}`) ||
        (notice.source === "client" && notifications.versions.includes(notice.version))
      )
        return
      setState((current) => {
        if (notice.source === "server" && current?.source === "client") return current
        return notice
      })
    }

    const seen = (source: Notice["source"], version: string) =>
      markNotification((draft) => {
        draft.versions = [...draft.versions, `${source}:${version}`].slice(-100)
      }).catch((error) => log.error("failed to persist update notification", { error }))

    const skip = () => {
      const current = state()
      if (!current || current.type !== "available" || (current.source === "server" && current.remote)) return
      setState(undefined)
      void seen(current.source, current.version)
    }

    const close = () => {
      const current = state()
      if (!current || current.source !== "server") return
      setState(undefined)
      void seen(current.source, current.version)
    }

    const install = async () => {
      const updater = props.updater
      const current = state()
      if (!updater || !current || current.type !== "available" || (current.source === "server" && current.remote))
        return
      setState({ source: "client", type: "installing", version: current.version })
      void seen(current.source, current.version)
      await updater.apply(current.version).then(
        () => setState({ source: "client", type: "install-success", version: current.version }),
        (error) =>
          setState({ source: "client", type: "failed", version: current.version, message: errorMessage(error) }),
      )
    }

    const restart = () => {
      const current = state()
      if (!current || (current.type !== "installed" && current.type !== "install-success")) return
      exit()
    }

    const later = () => {
      const current = state()
      if (!current || (current.type !== "installed" && current.type !== "install-success")) return
      setState(undefined)
    }

    onMount(() => {
      const updater = props.updater
      if (!updater) return
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      void updater
        .subscribe((notice) => notify({ ...notice, source: "client" }), controller.signal)
        .catch((error) => {
          if (!controller.signal.aborted) log.error("update check failed", { error })
        })
    })

    onCleanup(
      event.on("installation.update-available", (event) =>
        notify({
          source: "server",
          remote: props.updater?.remote ?? false,
          type: "available",
          version: event.data.version,
        }),
      ),
    )
    onCleanup(
      event.on("installation.updated", (event) =>
        notify({
          source: "server",
          remote: props.updater?.remote ?? false,
          type: "installed",
          version: event.data.version,
        }),
      ),
    )

    return { state, skip, close, install, restart, later }
  },
})
