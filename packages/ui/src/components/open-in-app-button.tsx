import { Show } from "solid-js"
import { useData } from "../context"
import { useI18n } from "../context/i18n"
import { Icon } from "./icon"
import { Tooltip } from "./tooltip"

export function OpenInAppButton(props: { file: string }) {
  const data = useData()
  const i18n = useI18n()
  return (
    <Show when={data.openInEditor}>
      <Tooltip
        value={i18n.t("ui.sessionReview.openInApp", { app: data.openInEditorLabel ?? "" })}
        placement="top"
        gutter={8}
      >
        <button
          data-slot="open-in-app-button"
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            data.openInEditor?.(props.file)
          }}
        >
          <Icon name="square-arrow-top-right" size="small" />
        </button>
      </Tooltip>
    </Show>
  )
}
