import { For, Show } from "solid-js"
import { useSpring } from "@opencode-ai/ui/motion-spring"
import { getDirectory, getFilename, getFilenameTruncated } from "@opencode-ai/util/path"
import { useI18n } from "../../context/i18n"
import { Button } from "../button"
import { FileIcon } from "../file-icon"
import { Icon } from "../icon"
import { IconButton } from "../icon-button"
import { Tooltip } from "../tooltip"
import type { ContextItem, ImageAttachment } from "./types"

interface Props {
  value: string
  mode: "normal" | "shell"
  images: ImageAttachment[]
  contexts: ContextItem[]
  working: boolean
  accepting: boolean
  placeholder?: string
  onImageDrop: (id: string) => void
  contextActive?: (item: ContextItem) => boolean
  onContextOpen?: (item: ContextItem) => void
  onContextDrop: (item: ContextItem) => void
  onAccept: () => void
  onPick: () => void
  onSend: () => void
  onEditorRef: (el: HTMLDivElement) => void
  onInput: () => void
  onKeyDown: (event: KeyboardEvent) => void
  onPaste: (event: ClipboardEvent) => void
  onCompStart: () => void
  onCompEnd: () => void
}

export function ComposerInputLayer(props: Props) {
  const i18n = useI18n()
  const isShell = () => props.mode === "shell"
  const shell = useSpring(() => (isShell() ? 1 : 0), { visualDuration: 0.1, bounce: 0 })
  const buttonsOpacity = () => 1 - shell()
  const buttonsBlur = () => shell()

  return (
    <>
      <Show when={props.images.length > 0}>
        <div class="flex flex-wrap gap-2 px-3 pt-3">
          <For each={props.images}>
            {(item) => (
              <div class="relative group">
                <Show
                  when={item.mime.startsWith("image/")}
                  fallback={
                    <div class="size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base">
                      <Icon name="folder" class="size-6 text-text-weak" />
                    </div>
                  }
                >
                  <img
                    src={item.dataUrl}
                    alt={item.filename}
                    class="size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
                  />
                </Show>
                <button
                  type="button"
                  onClick={() => props.onImageDrop(item.id)}
                  class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
                  aria-label={i18n.t("ui.prompt.attachment.remove")}
                >
                  <Icon name="close" class="size-3 text-text-weak" />
                </button>
                <div class="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md">
                  <span class="text-10-regular text-white truncate block">{item.filename}</span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.contexts.length > 0}>
        <div class="flex flex-nowrap items-start gap-2 p-2 overflow-x-auto no-scrollbar">
          <For each={props.contexts}>
            {(item) => {
              const active = () => props.contextActive?.(item) ?? false
              const dir = () => getDirectory(item.path)
              const file = () => getFilename(item.path)
              const filename = () => getFilenameTruncated(item.path, 14)
              const label = () => {
                if (!item.selection) return null
                if (item.selection.startLine === item.selection.endLine) return `:${item.selection.startLine}`
                return `:${item.selection.startLine}-${item.selection.endLine}`
              }
              return (
                <Tooltip
                  value={
                    <span class="flex max-w-[300px]">
                      <span class="text-text-invert-base truncate-start [unicode-bidi:plaintext] min-w-0">{dir()}</span>
                      <span class="shrink-0">{file()}</span>
                    </span>
                  }
                  placement="top"
                  openDelay={2000}
                >
                  <div
                    classList={{
                      "group shrink-0 flex flex-col rounded-[6px] pl-2 pr-1 py-1 max-w-[200px] h-12 cursor-default transition-all shadow-xs-border": true,
                      "hover:bg-surface-interactive-weak": !!item.commentID && !active(),
                      "bg-surface-interactive-hover hover:bg-surface-interactive-hover shadow-xs-border-hover":
                        active(),
                      "bg-background-stronger": !active(),
                    }}
                    onClick={() => props.onContextOpen?.(item)}
                  >
                    <div class="flex items-center gap-1.5">
                      <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-3.5" />
                      <div class="flex items-center text-11-regular min-w-0 font-medium">
                        <span class="text-text-strong whitespace-nowrap">{filename()}</span>
                        <Show when={label()}>
                          <span class="text-text-weak whitespace-nowrap shrink-0">{label()}</span>
                        </Show>
                      </div>
                      <IconButton
                        type="button"
                        icon="close-small"
                        variant="ghost"
                        class="ml-auto size-3.5 text-text-weak hover:text-text-strong transition-all"
                        onClick={(event) => {
                          event.stopPropagation()
                          props.onContextDrop(item)
                        }}
                        aria-label={i18n.t("ui.prompt.context.removeFile")}
                      />
                    </div>
                    <Show when={item.comment}>
                      {(note) => <div class="text-12-regular text-text-strong ml-5 pr-1 truncate">{note()}</div>}
                    </Show>
                  </div>
                </Tooltip>
              )
            }}
          </For>
        </div>
      </Show>

      <div class="relative max-h-[200px] overflow-y-auto no-scrollbar" style={{ flex: 1 }}>
        <div
          data-component="prompt-input"
          ref={props.onEditorRef}
          role="textbox"
          aria-multiline="true"
          aria-label={props.placeholder ?? i18n.t("ui.prompt.placeholder.simple")}
          contentEditable={true}
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          onInput={props.onInput}
          onKeyDown={props.onKeyDown}
          onPaste={props.onPaste}
          onCompositionStart={props.onCompStart}
          onCompositionEnd={props.onCompEnd}
          class="select-text w-full pl-3 pr-2 pt-2 pb-2 text-14-regular text-text-strong focus:outline-none whitespace-pre-wrap"
          classList={{
            "font-mono!": props.mode === "shell",
            "[&_[data-type=file]]:text-syntax-property": true,
            "[&_[data-type=agent]]:text-syntax-type": true,
          }}
        />
        <Show when={!props.value.trim()}>
          <div
            class="absolute top-0 inset-x-0 pl-3 pr-2 pt-2 pb-2 text-14-regular text-text-weak pointer-events-none whitespace-nowrap truncate"
            classList={{ "font-mono!": props.mode === "shell" }}
          >
            {props.mode === "shell"
              ? i18n.t("ui.prompt.placeholder.shell")
              : (props.placeholder ?? i18n.t("ui.prompt.placeholder.simple"))}
          </div>
        </Show>
      </div>

      <div
        class="flex items-center justify-between px-2 pb-2 shrink-0"
        style={{
          opacity: `${buttonsOpacity()}`,
          filter: buttonsBlur() > 0.01 ? `blur(${buttonsBlur()}px)` : "none",
          "pointer-events": shell() < 0.5 ? "auto" : "none",
        }}
      >
        <Button
          variant="ghost"
          onClick={props.onAccept}
          class="size-6"
          classList={{
            "text-text-base": !props.accepting,
            "hover:bg-surface-success-base": props.accepting,
          }}
          style={{ display: "flex", "align-items": "center", "justify-content": "center" }}
          aria-label={i18n.t("ui.prompt.autoAccept")}
          aria-pressed={props.accepting}
        >
          <Icon name="chevron-double-right" size="small" classList={{ "text-icon-success-base": props.accepting }} />
        </Button>
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            class="size-8 p-0"
            aria-label={i18n.t("ui.prompt.attachment.add")}
            onClick={props.onPick}
          >
            <Icon name="plus" class="size-4.5" />
          </Button>
          <IconButton
            icon={props.working ? "stop" : "arrow-up"}
            variant="primary"
            class="size-8"
            onClick={props.onSend}
            disabled={!props.working && props.value.trim().length === 0 && props.images.length === 0}
            aria-label={props.working ? i18n.t("ui.prompt.stop") : i18n.t("ui.prompt.send")}
          />
        </div>
      </div>
    </>
  )
}
