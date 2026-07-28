import { HoverCard } from "@kobalte/core/hover-card"
import { ComponentProps, For, Show, createSignal, splitProps } from "solid-js"
import type { Part, UserMessage } from "@opencode-ai/sdk/v2"
import { computeBarWidth, extractPreviewContent, type PreviewContent } from "./input-nav-utils"
import "./input-nav.css"

export function InputNav(
  props: ComponentProps<"div"> & {
    messages: UserMessage[]
    getParts: (messageID: string) => Part[]
    current?: UserMessage
    onMessageSelect: (message: UserMessage) => void
  },
) {
  const [local, others] = splitProps(props, ["messages", "getParts", "current", "onMessageSelect", "class"])
  const [hoveredIndex, setHoveredIndex] = createSignal<number | null>(null)

  return (
    <div data-component="input-nav" class={local.class} {...others}>
      <For each={local.messages}>
        {(message, index) => {
          const isActive = () => message.id === local.current?.id
          const barWidth = () => {
            const parts = local.getParts(message.id)
            const textPart = parts.find(
              (p): p is Part & { type: "text"; text: string } =>
                p.type === "text" && !(p as { synthetic?: boolean }).synthetic,
            )
            return computeBarWidth(textPart?.text ?? "")
          }

          const handleClick = () => local.onMessageSelect(message)

          const handleKeyPress = (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            local.onMessageSelect(message)
          }

          const preview = () => extractPreviewContent(local.getParts(message.id))

          return (
            <HoverCard
              open={hoveredIndex() === index()}
              onOpenChange={(open) => setHoveredIndex(open ? index() : null)}
              openDelay={200}
              closeDelay={100}
              placement="left"
              gutter={8}
              overflowPadding={24}
              fitViewport
            >
              <HoverCard.Trigger as="div" data-slot="input-nav-item">
                <div
                  data-slot="input-nav-bar"
                  data-active={isActive() || undefined}
                  role="button"
                  tabindex={0}
                  style={{ width: `${barWidth()}px` }}
                  onClick={handleClick}
                  onKeyDown={handleKeyPress}
                />
              </HoverCard.Trigger>
              <HoverCard.Portal>
                <HoverCard.Content data-slot="input-nav-preview-content">
                  <PreviewPanel preview={preview()} />
                </HoverCard.Content>
              </HoverCard.Portal>
            </HoverCard>
          )
        }}
      </For>
    </div>
  )
}

function PreviewPanel(props: { preview: PreviewContent }) {
  return (
    <div data-slot="input-nav-preview">
      <Show when={props.preview.text}>
        <div data-slot="input-nav-preview-text">{props.preview.text}</div>
      </Show>
      <Show when={props.preview.images.length > 0}>
        <div data-slot="input-nav-preview-images">
          <For each={props.preview.images}>
            {(img) => (
              <img data-slot="input-nav-preview-image" src={img.url} alt={img.filename ?? "image"} />
            )}
          </For>
        </div>
      </Show>
      <Show when={props.preview.files.length > 0}>
        <div data-slot="input-nav-preview-files">
          <For each={props.preview.files}>
            {(file) => (
              <div data-slot="input-nav-preview-file">
                <span data-slot="input-nav-preview-file-icon">📄</span>
                <span data-slot="input-nav-preview-file-name">{file.filename ?? file.mime}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={!props.preview.text && props.preview.images.length === 0 && props.preview.files.length === 0}>
        <div data-slot="input-nav-preview-empty">No preview available</div>
      </Show>
    </div>
  )
}
