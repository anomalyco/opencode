import { createSignal, onCleanup, onMount } from "solid-js"
import { DialogUpdate } from "../component/dialog-update"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { useLog } from "./log"
import { useStorage } from "./storage"
import { useDialog } from "../ui/dialog"

export type UpdateSource = {
  readonly subscribe: (notify: (version: string) => void, signal: AbortSignal) => Promise<void>
  readonly apply: (version: string) => Promise<void>
}

export const { use: useUpdateNotification, provider: UpdateNotificationProvider } = createSimpleContext({
  name: "UpdateNotification",
  init: (props: { updater?: UpdateSource }) => {
    const dialog = useDialog()
    const client = useClient()
    const log = useLog({ component: "update-notification" })
    const [available, setAvailable] = createSignal<string>()
    const [notifications, markNotification] = useStorage().store<{ versions: string[] }>("update-notifications", {
      initial: { versions: [] },
    })

    const notify = (version: string) => {
      if (!props.updater || notifications.versions.includes(version)) return
      setAvailable(version)
    }

    const open = () => {
      const updater = props.updater
      const version = available()
      if (!updater || !version) return
      setAvailable(undefined)
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

    return { available, open }
  },
})
