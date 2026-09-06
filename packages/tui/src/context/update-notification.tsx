import { createSignal, onCleanup, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useLog } from "./log"
import { useStorage } from "./storage"
import { useEvent } from "./event"
import { errorMessage } from "../util/error"
import { useExit } from "./exit"
import { useDialog } from "../ui/dialog"
import { DialogUpdate } from "../component/dialog-update"

type ClientNotice = { readonly type: "available" | "installed"; readonly version: string }
type Notice = ClientNotice & ({ readonly source: "client" } | { readonly source: "server"; readonly remote: boolean })
export type UpdateState =
  | ClientNotice
  | { readonly type: "installing"; readonly version: string }
  | { readonly type: "failed"; readonly message: string }

export type UpdateSource = {
  readonly remote: boolean
  readonly subscribe: (notify: (notice: ClientNotice) => void, signal: AbortSignal) => Promise<void>
  readonly check: (
    signal: AbortSignal,
  ) => Promise<ClientNotice | { readonly type: "unavailable"; readonly message: string } | undefined>
  readonly apply: (version: string) => Promise<void>
}

export const { use: useUpdateNotification, provider: UpdateNotificationProvider } = createSimpleContext({
  name: "UpdateNotification",
  init: (props: { updater?: UpdateSource }) => {
    const event = useEvent()
    const exit = useExit()
    const dialog = useDialog()
    const log = useLog({ component: "update-notification" })
    const [state, setState] = createSignal<UpdateState>()
    const [notification, setNotification] = createSignal<Notice>()
    const [notifications, markNotification] = useStorage().store<{ versions: string[] }>("update-notifications", {
      initial: { versions: [] },
    })

    const notify = (notice: Notice) => {
      if (!props.updater) return
      if (
        notifications.versions.includes(`${notice.source}:${notice.version}`) ||
        (notice.source === "client" && notifications.versions.includes(notice.version))
      )
        return
      setNotification((current) => {
        if (notice.source === "server" && current?.source === "client") return current
        return notice
      })
    }

    const dismiss = () => {
      const current = notification()
      if (!current) return
      setNotification(undefined)
      // Only interactions with the automatic notification update its history.
      void markNotification((draft) => {
        draft.versions = [...draft.versions, `${current.source}:${current.version}`].slice(-100)
      }).catch((error) => log.error("failed to persist update notification", { error }))
    }

    const install = async () => {
      const updater = props.updater
      const current = state()
      if (!updater || !current || current.type !== "available") return
      setState({ type: "installing", version: current.version })
      await updater.apply(current.version).then(
        () => setState({ type: "installed", version: current.version }),
        (error) => setState({ type: "failed", message: errorMessage(error) }),
      )
    }

    const check = async (signal: AbortSignal) => {
      const updater = props.updater
      if (!updater || state()?.type === "installing") return
      const result = await updater.check(signal)
      if (signal.aborted) return
      if (result?.type === "unavailable") return result.message
      setState(result)
    }

    const restart = () => {
      const current = state()
      if (current?.type !== "installed") return
      exit()
    }

    const open = (origin: "manual" | "notification") => {
      if (!props.updater) return
      const current = notification()
      const known = current && (current.source === "client" || !current.remote) ? current : undefined
      if (origin === "notification" && !known) return
      const active = state()
      // The notification can predate an installation through /update.
      if (known && active?.type !== "installing" && !(active?.type === "installed" && active.version === known.version))
        setState({ type: known.type, version: known.version })
      const status = state()?.type
      dialog.replace(() => (
        <DialogUpdate
          check={status === undefined || status === "failed" ? check : undefined}
          state={state}
          skip={dismiss}
          install={install}
          restart={restart}
        />
      ))
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

    return {
      notification,
      dismiss,
      open: props.updater ? open : undefined,
    }
  },
})
