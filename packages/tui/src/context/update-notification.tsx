import { createSignal, onCleanup, onMount } from "solid-js"
import { DialogUpdate } from "../component/dialog-update"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useLog } from "./log"
import { useStorage } from "./storage"
import { useDialog } from "../ui/dialog"
import { useEvent } from "./event"

type Notice = { readonly type: "available" | "installed"; readonly version: string }

export type UpdateSource = {
  readonly subscribe: (notify: (notice: Notice) => void, signal: AbortSignal) => Promise<void>
  readonly apply: (version: string) => Promise<void>
}

export const { use: useUpdateNotification, provider: UpdateNotificationProvider } = createSimpleContext({
  name: "UpdateNotification",
  init: (props: { updater?: UpdateSource }) => {
    const dialog = useDialog()
    const client = useClient()
    const event = useEvent()
    const log = useLog({ component: "update-notification" })
    const [notice, setNotice] = createSignal<Notice>()
    const [notifications, markNotification] = useStorage().store<{ versions: string[] }>("update-notifications", {
      initial: { versions: [] },
    })

    const notify = (notice: Notice) => {
      if (!props.updater || (notice.type === "available" && notifications.versions.includes(notice.version))) return
      setNotice(notice)
    }

    const open = () => {
      const updater = props.updater
      const current = notice()
      if (!updater || !current || current.type !== "available") return
      const version = current.version
      setNotice(undefined)
      void markNotification((draft) => {
        draft.versions = [...draft.versions, version].slice(-100)
      }).catch((error) => log.error("failed to persist update notification", { error }))
      const key = `update:${version}`
      dialog.replace(
        () => (
          <DialogUpdate
            dialogKey={key}
            version={version}
            install={() => updater.apply(version)}
            restart={client.restart}
          />
        ),
        undefined,
        { key },
      )
      dialog.setCentered(true)
    }

    onMount(() => {
      const updater = props.updater
      if (!updater) return
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      void updater.subscribe(notify, controller.signal).catch((error) => {
        if (!controller.signal.aborted) log.error("update check failed", { error })
      })
    })

    onCleanup(
      event.on("installation.update-available", (event) => notify({ type: "available", version: event.data.version })),
    )
    onCleanup(event.on("installation.updated", (event) => notify({ type: "installed", version: event.data.version })))

    return { notice, open }
  },
})
