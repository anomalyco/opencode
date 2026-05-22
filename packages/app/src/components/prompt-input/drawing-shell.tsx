import { Component, createSignal, JSX, Show } from "solid-js"
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
  modes?: JSX.Element
}

export const PromptDrawingShell: Component<ShellProps> = (props) => {
  const language = useLanguage()
  const [copied, setCopied] = createSignal(false)
  const history = () => (props.variant === "doc" ? props.doc.history : props.drawing.history)
  const undo = () => (props.variant === "doc" ? props.doc.undo() : props.drawing.undo())
  const redo = () => (props.variant === "doc" ? props.doc.redo() : props.drawing.redo())
  const label = () => {
    const id = props.doc.docID()
    if (!id) return "—"
    return id.replace(/^doc_/, "").slice(0, 8)
  }
  const copy = async () => {
    const id = props.doc.docID()
    if (!id) return
    await navigator.clipboard.writeText(id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      data-component={props.variant === "doc" ? "prompt-doc-shell" : "prompt-draw-shell"}
      class="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
    >
      <div
        classList={{
          "relative min-h-0 w-full": true,
          "flex-1": true,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Show when={props.variant === "doc"} fallback={<PromptDrawingPanel drawing={props.drawing} />}>
          <PromptDocPanel doc={props.doc} />
          <div
            data-component="prompt-doc-id"
            class="absolute bottom-0 right-0 z-10 max-w-[40%] rounded-tl-[10px] text-text-weaker"
          >
            <Tooltip
              placement="top"
              value={copied() ? language.t("ui.message.copied") : language.t("ui.textField.copyToClipboard")}
            >
              <button
                type="button"
                class="flex max-w-full items-center justify-start rounded-tl-lg rounded-tr-none rounded-br-none rounded-bl-none bg-surface-raised-stronger-non-alpha px-2 py-1 font-mono text-11-regular leading-[13px] text-text-weaker shadow-sm ring-1 ring-border-weaker-base hover:ring-border-base"
                title={props.doc.docID() ?? ""}
                onClick={copy}
                aria-label={copied() ? language.t("ui.message.copied") : language.t("ui.textField.copyToClipboard")}
              >
                <span class="truncate">{label()}</span>
              </button>
            </Tooltip>
          </div>
        </Show>
      </div>
      <div
        data-component="prompt-draw-actions"
        class="relative z-20 flex h-11 shrink-0 items-center justify-between gap-2 border-t border-border-weaker-base bg-surface-raised-stronger-non-alpha px-2 py-0"
      >
        <div class="flex items-center gap-0.5">
          {props.modes}
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
