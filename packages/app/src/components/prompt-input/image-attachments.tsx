import { Component, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { ImageAttachmentPart } from "@/context/prompt"

type PromptImageAttachmentsProps = {
  attachments: ImageAttachmentPart[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
}

const fallbackClass = "size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base"
const imageClass =
  "size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-raised-base-hover"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3">
        <For each={props.attachments}>
          {(attachment) => (
            <Tooltip value={attachment.filename} placement="top" contentClass="break-all">
              <div class="relative group">
                <Show
                  when={attachment.mime.startsWith("image/")}
                  fallback={
                    <Show
                      when={attachment.browserElement}
                      fallback={
                        <div class={fallbackClass}>
                          <Icon name="folder" class="size-6 text-text-weak" />
                        </div>
                      }
                    >
                      {(element) => (
                        <div class="flex h-16 min-w-40 max-w-56 items-center gap-2 rounded-md border border-border-base bg-surface-base px-3">
                          <Icon name="window-cursor" class="size-5 shrink-0 text-icon-info" />
                          <div class="min-w-0">
                            <div class="text-11-medium text-text-strong">&lt;{element().tag}&gt;</div>
                            <div class="truncate font-mono text-10-regular text-text-weak">{element().selector}</div>
                          </div>
                        </div>
                      )}
                    </Show>
                  }
                >
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.filename}
                    class={imageClass}
                    onClick={() => props.onOpen(attachment)}
                  />
                </Show>
                <button
                  type="button"
                  onClick={() => props.onRemove(attachment.id)}
                  class={removeClass}
                  aria-label={`${props.removeLabel}: ${attachment.filename}`}
                >
                  <Icon name="close" class="size-3 text-text-weak" />
                </button>
                <div class={nameClass}>
                  <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                </div>
              </div>
            </Tooltip>
          )}
        </For>
      </div>
    </Show>
  )
}
