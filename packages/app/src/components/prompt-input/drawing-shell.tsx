import { Component, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLanguage } from "@/context/language"
import { PromptDrawingColors } from "./drawing-colors"
import { PromptDrawingPanel } from "./drawing-panel"
import { PromptDocPanel } from "./doc-panel"
import type { createPromptDrawing } from "./drawing"
import type { createPromptDoc } from "./doc"

type ShellProps = {
  variant: "draw" | "doc"
  drawing: ReturnType<typeof createPromptDrawing>
  doc: ReturnType<typeof createPromptDoc>
  working: () => boolean
  tip: () => import("solid-js").JSX.Element
  onExit: () => void | Promise<void>
}

export const PromptDrawingShell: Component<ShellProps> = (props) => {
  const language = useLanguage()
  const exitLabel = () =>
    props.variant === "doc" ? language.t("prompt.action.docToText") : language.t("prompt.action.drawToText")

  const history = () => (props.variant === "doc" ? props.doc.history : props.drawing.history)
  const undo = () => (props.variant === "doc" ? props.doc.undo() : props.drawing.undo())
  const redo = () => (props.variant === "doc" ? props.doc.redo() : props.drawing.redo())

  return (
    <div
      data-component={props.variant === "doc" ? "prompt-doc-shell" : "prompt-draw-shell"}
      class="flex max-h-[448px] flex-col overflow-hidden"
    >
      <div class="h-[352px] min-h-0 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
        <Show when={props.variant === "doc"} fallback={<PromptDrawingPanel drawing={props.drawing} />}>
          <PromptDocPanel doc={props.doc} />
        </Show>
      </div>
      <div
        data-component="prompt-draw-actions"
        class="flex shrink-0 items-center justify-between gap-2 border-t border-border-weaker-base bg-surface-raised-stronger-non-alpha px-2 py-1.5"
      >
        <div class="flex items-center gap-0.5">
          <Tooltip placement="top" value={exitLabel()}>
            <Button
              data-action={props.variant === "doc" ? "prompt-doc-exit" : "prompt-draw-exit"}
              type="button"
              variant="ghost"
              class="size-7.5 p-0"
              onClick={() => void props.onExit()}
              aria-label={exitLabel()}
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
              disabled={!history().undo}
              onClick={undo}
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
              disabled={!history().redo}
              onClick={redo}
              aria-label={language.t("prompt.action.drawRedo")}
            />
          </Tooltip>
        </div>
        <Show when={props.variant === "draw"}>
          <PromptDrawingColors drawing={props.drawing} />
        </Show>
        <Show when={props.variant === "doc"}>
          <div class="flex-1" />
        </Show>
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
