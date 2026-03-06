import { Show } from "solid-js"
import { useI18n } from "../../context/i18n"
import { Icon } from "../icon"

interface Props {
  type: "image" | "@mention" | null
}

export function ComposerDragOverlay(props: Props) {
  const i18n = useI18n()
  return (
    <Show when={props.type}>
      <div class="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised-stronger-non-alpha/90 pointer-events-none">
        <div class="flex flex-col items-center gap-2 text-text-weak">
          <Icon name={props.type === "image" ? "photo" : "link"} class="size-8" />
          <span class="text-14-regular">
            {props.type === "image" ? i18n.t("ui.prompt.dropzone.attach") : i18n.t("ui.prompt.dropzone.mention")}
          </span>
        </div>
      </div>
    </Show>
  )
}
