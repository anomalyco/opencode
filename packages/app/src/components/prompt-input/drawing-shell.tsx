import { Component } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { PromptDrawingColors } from "./drawing-colors"
import { PromptDrawingPanel } from "./drawing-panel"
import type { createPromptDrawing } from "./drawing"

type ShellProps = {
  drawing: ReturnType<typeof createPromptDrawing>
  working: () => boolean
  tip: () => import("solid-js").JSX.Element
  onExit: () => void
}

export const PromptDrawingShell: Component<ShellProps> = (props) => {
  const language = useLanguage()

  return (
    <div
      data-component="prompt-draw-shell"
      class="flex max-h-[448px] flex-col overflow-hidden"
    >
      <div class="h-[352px] min-h-0 shrink-0">
        <PromptDrawingPanel drawing={props.drawing} />
      </div>
      <div
        data-component="prompt-draw-actions"
        class="flex shrink-0 items-center justify-between gap-2 border-t border-border-base bg-surface-raised-stronger-non-alpha px-2 py-1.5"
      >
        <div class="flex items-center gap-0.5">
          <Tooltip placement="top" value={language.t("prompt.action.drawToText")}>
            <Button
              data-action="prompt-draw-exit"
              type="button"
              variant="ghost"
              class="size-7.5 p-0"
              onClick={props.onExit}
              aria-label={language.t("prompt.action.drawToText")}
            >
              <Icon name="prompt" class="size-4.5" />
            </Button>
          </Tooltip>
          <Tooltip placement="top" value={language.t("prompt.action.drawUndo")}>
            <IconButton
              data-action="prompt-draw-undo"
              type="button"
              icon="arrow-left"
              variant="ghost"
              class="size-7.5"
              disabled={!props.drawing.history.undo}
              onClick={() => props.drawing.undo()}
              aria-label={language.t("prompt.action.drawUndo")}
            />
          </Tooltip>
          <Tooltip placement="top" value={language.t("prompt.action.drawRedo")}>
            <IconButton
              data-action="prompt-draw-redo"
              type="button"
              icon="arrow-right"
              variant="ghost"
              class="size-7.5"
              disabled={!props.drawing.history.redo}
              onClick={() => props.drawing.redo()}
              aria-label={language.t("prompt.action.drawRedo")}
            />
          </Tooltip>
        </div>
        <PromptDrawingColors drawing={props.drawing} />
        <Tooltip placement="top" inactive={!props.working()} value={props.tip()}>
          <IconButton
            data-action="prompt-submit"
            type="submit"
            icon={props.working() ? "stop" : "arrow-up"}
            variant="primary"
            class="size-7.5"
            aria-label={props.working() ? language.t("prompt.action.stop") : language.t("prompt.action.send")}
          />
        </Tooltip>
      </div>
    </div>
  )
}
