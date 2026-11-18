import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useI18n } from "../context/i18n"
import "./preview-controls.css"

export function PreviewControls(props: {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  disabled?: boolean
  zoomInDisabled?: boolean
  zoomOutDisabled?: boolean
}) {
  const i18n = useI18n()

  return (
    <div data-component="preview-controls" role="group" aria-label={i18n.t("ui.preview.controls")}>
      <Tooltip value={i18n.t("ui.preview.zoomIn")} placement="top">
        <IconButton
          variant="ghost-muted"
          size="large"
          aria-label={i18n.t("ui.preview.zoomIn")}
          disabled={props.disabled || props.zoomInDisabled}
          onClick={props.onZoomIn}
          icon={<Icon name="outline-magnifier-plus" size="normal" />}
        />
      </Tooltip>
      <span data-slot="preview-controls-divider" aria-hidden />
      <Tooltip value={i18n.t("ui.preview.zoomOut")} placement="top">
        <IconButton
          variant="ghost-muted"
          size="large"
          aria-label={i18n.t("ui.preview.zoomOut")}
          disabled={props.disabled || props.zoomOutDisabled}
          onClick={props.onZoomOut}
          icon={<Icon name="outline-magnifier-minus" size="normal" />}
        />
      </Tooltip>
      <span data-slot="preview-controls-divider" aria-hidden />
      <Tooltip value={i18n.t("ui.preview.fit")} placement="top">
        <IconButton
          variant="ghost-muted"
          size="large"
          aria-label={i18n.t("ui.preview.fit")}
          disabled={props.disabled}
          onClick={props.onFit}
          icon={<Icon name="outline-expand" size="normal" />}
        />
      </Tooltip>
    </div>
  )
}
