import { Component, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import type { ImageAttachmentPart } from "@/context/prompt"

type PromptImageAttachmentsProps = {
  attachments: ImageAttachmentPart[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
  platform?: "web" | "desktop"
}

const desktopClass =
  "flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-weak border border-border-weak-base max-w-[120px] group relative"
const desktopImageClass = "size-3.5 rounded object-cover flex-none"
const desktopNameClass = "text-12-regular text-text-base truncate min-w-0"
const desktopRemoveClass =
  "absolute -top-1 -right-1 size-4 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"

const fallbackClass = "size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base"
const imageClass =
  "size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  const desktop = () => props.platform === "desktop"

  return (
    <Show when={props.attachments.length > 0}>
      <div class="flex flex-wrap gap-2 px-3 pt-3">
        <For each={props.attachments}>
          {(attachment) => (
            <Tooltip value={attachment.filename} placement="top" contentClass="break-all">
              <div class={desktop() ? desktopClass : "relative group"}>
                <Show
                  when={attachment.mime.startsWith("image/")}
                  fallback={
                    desktop() ? (
                      <>
                        <FileIcon node={{ path: attachment.filename, type: "file" }} class="size-3.5 flex-none" />
                        <span class={desktopNameClass}>{attachment.filename}</span>
                      </>
                    ) : (
                      <div class={fallbackClass}>
                        <Icon name="folder" class="size-6 text-text-weak" />
                      </div>
                    )
                  }
                >
                  <Show
                    when={desktop()}
                    fallback={
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.filename}
                        class={imageClass}
                        onClick={() => props.onOpen(attachment)}
                      />
                    }
                  >
                    <img
                      src={attachment.dataUrl}
                      alt={attachment.filename}
                      class={desktopImageClass}
                      onClick={() => props.onOpen(attachment)}
                    />
                  </Show>
                  <Show when={!desktop()}>
                    <div class={nameClass}>
                      <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                    </div>
                  </Show>
                </Show>
                <button
                  type="button"
                  onClick={() => props.onRemove(attachment.id)}
                  class={desktop() ? desktopRemoveClass : removeClass}
                  aria-label={props.removeLabel}
                >
                  <Icon name="close" class="size-3 text-text-weak" />
                </button>
              </div>
            </Tooltip>
          )}
        </For>
      </div>
    </Show>
  )
}

