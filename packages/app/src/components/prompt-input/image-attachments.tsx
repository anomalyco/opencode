import { Component, For, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { AttachmentCardV2 } from "@opencode-ai/session-ui/v2/attachment-card-v2"
import { CommentCardV2 } from "@opencode-ai/session-ui/v2/comment-card-v2"
import { typeLabel } from "@opencode-ai/session-ui/message-file"
import type { ContextItem, ImageAttachmentPart } from "@/context/prompt"
import "./image-attachments.css"

type PromptCommentItem = ContextItem & { key: string }

type PromptImageAttachmentsProps = {
  attachments: ImageAttachmentPart[]
  onOpen: (attachment: ImageAttachmentPart) => void
  onRemove: (id: string) => void
  removeLabel: string
  newLayoutDesigns: boolean
  comments?: PromptCommentItem[]
  commentActive?: (item: PromptCommentItem) => boolean
  onOpenComment?: (item: PromptCommentItem) => void
  onRemoveComment?: (item: PromptCommentItem) => void
}

const fallbackClass = "size-16 rounded-md bg-surface-base flex items-center justify-center border border-border-base"
const imageClass =
  "size-16 rounded-md object-cover border border-border-base hover:border-border-strong-base transition-colors"
const imageClassV2 = "w-[58px] h-[46px] rounded-[6px] object-cover"
// inset box-shadows do not paint over <img> content, so the hairline is a separate overlay
const imageHairlineClassV2 =
  "absolute inset-0 rounded-[6px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)] pointer-events-none"
const removeClass =
  "absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-stronger-non-alpha border border-border-base flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-raised-base-hover"
const removeClassV2 =
  "absolute -top-1 -right-1 size-4 rounded-full bg-v2-icon-icon-muted outline-solid outline-1 outline-v2-icon-icon-contrast flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
const nameClass = "absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/50 rounded-b-md"

export const PromptImageAttachments: Component<PromptImageAttachmentsProps> = (props) => {
  return (
    <Show when={props.attachments.length > 0 || (props.newLayoutDesigns && (props.comments?.length ?? 0) > 0)}>
      <div data-slot="prompt-attachments" classList={{ relative: props.newLayoutDesigns }}>
        <div
          data-slot="prompt-attachments-scroll"
          classList={{
            "flex gap-2": true,
            "flex-nowrap overflow-x-auto no-scrollbar px-2 pt-2 pb-1": props.newLayoutDesigns,
            "flex-wrap px-3 pt-3": !props.newLayoutDesigns,
          }}
        >
          <Show when={props.newLayoutDesigns}>
            <For each={props.comments ?? []}>
              {(item) => (
                <div class="relative group shrink-0">
                  <TooltipV2
                    value={item.comment}
                    placement="top"
                    openDelay={800}
                    contentClass="max-w-[300px] break-words"
                  >
                    <CommentCardV2
                      comment={item.comment ?? ""}
                      path={item.path}
                      selection={item.selection}
                      active={props.commentActive?.(item)}
                      onClick={() => props.onOpenComment?.(item)}
                    />
                  </TooltipV2>
                  <button
                    type="button"
                    onClick={() => props.onRemoveComment?.(item)}
                    class={removeClassV2}
                    aria-label={props.removeLabel}
                  >
                    <IconV2 name="outline-xmark" class="text-v2-icon-icon-contrast" />
                  </button>
                </div>
              )}
            </For>
          </Show>
          <For each={props.attachments}>
            {(attachment) => {
              const image = attachment.mime.startsWith("image/")
              const media = () => (
                <Show
                  when={image}
                  fallback={
                    <Show
                      when={props.newLayoutDesigns}
                      fallback={
                        <div class={fallbackClass}>
                          <Icon name="folder" class="size-6 text-text-weak" />
                        </div>
                      }
                    >
                      <AttachmentCardV2 title={attachment.filename}>
                        {typeLabel(attachment.filename, attachment.mime)}
                      </AttachmentCardV2>
                    </Show>
                  }
                >
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.filename}
                    class={props.newLayoutDesigns ? imageClassV2 : imageClass}
                    onClick={() => props.onOpen(attachment)}
                  />
                </Show>
              )
              const name = () => (
                <div class={nameClass}>
                  <span class="text-10-regular text-white truncate block">{attachment.filename}</span>
                </div>
              )
              const remove = () => (
                <button
                  type="button"
                  onClick={() => props.onRemove(attachment.id)}
                  class={props.newLayoutDesigns ? removeClassV2 : removeClass}
                  aria-label={props.removeLabel}
                >
                  <Show when={props.newLayoutDesigns} fallback={<Icon name="close" class="size-3 text-text-weak" />}>
                    <IconV2 name="outline-xmark" class="text-v2-icon-icon-contrast" />
                  </Show>
                </button>
              )
              // v2 keeps the remove button outside the tooltip trigger so hovering it dismisses the tooltip
              return (
                <Show
                  when={props.newLayoutDesigns}
                  fallback={
                    <Tooltip value={attachment.filename} placement="top" contentClass="break-all">
                      <div class="relative group">
                        {media()}
                        {name()}
                        {remove()}
                      </div>
                    </Tooltip>
                  }
                >
                  <div class="relative group shrink-0">
                    <TooltipV2 value={attachment.filename} placement="top" contentClass="break-all">
                      {media()}
                      <Show when={image}>
                        <div class={imageHairlineClassV2} />
                      </Show>
                    </TooltipV2>
                    {remove()}
                  </div>
                </Show>
              )
            }}
          </For>
        </div>
        <Show when={props.newLayoutDesigns}>
          <div
            data-slot="prompt-attachments-fade-left"
            class="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-[linear-gradient(to_right,var(--v2-background-bg-base),transparent)]"
          />
          <div
            data-slot="prompt-attachments-fade-right"
            class="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-[linear-gradient(to_left,var(--v2-background-bg-base),transparent)]"
          />
        </Show>
      </div>
    </Show>
  )
}
