import { Button } from "@opencode-ai/ui/button"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { moveSessionLocation } from "./location-recovery"

export function SessionLocationUnavailable(props: { sessionID: string }) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const pickDirectory = useDirectoryPicker()
  const [store, setStore] = createStore({ moving: false })

  const chooseDirectory = () => {
    if (store.moving) return
    pickDirectory({
      server: serverSDK.server,
      title: language.t("session.locationUnavailable.pickerTitle"),
      onSelect: (result) => {
        void moveSessionLocation({
          selection: result,
          moving: store.moving,
          setMoving: (moving) => setStore("moving", moving),
          move: (directory) => serverSDK.api.session.move({ sessionID: props.sessionID, directory }),
          failed: (error) =>
            showToast({
              variant: "error",
              title: language.t("workspace.move.failed"),
              description: error instanceof Error ? error.message : language.t("common.requestFailed"),
            }),
        })
      },
    })
  }

  return (
    <SessionLocationUnavailableView
      title={language.t("session.locationUnavailable.title")}
      description={language.t("session.locationUnavailable.description")}
      action={language.t("session.locationUnavailable.action")}
      moving={store.moving}
      onMove={chooseDirectory}
    />
  )
}

export function SessionLocationUnavailableView(props: {
  title: string
  description: string
  action: string
  moving: boolean
  onMove: () => void
}) {
  return (
    <div
      data-component="session-location-unavailable"
      class="flex w-full items-center gap-3 rounded-[12px] border border-border-weak-base bg-background-base p-3"
    >
      <div class="min-w-0 flex-1">
        <div class="text-14-medium text-text-strong">{props.title}</div>
        <div class="text-13-regular text-text-weak">{props.description}</div>
      </div>
      <Button type="button" variant="outline" icon="folder" disabled={props.moving} onClick={props.onMove}>
        {props.action}
      </Button>
    </div>
  )
}
