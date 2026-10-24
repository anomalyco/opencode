import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { useI18n } from "../context/i18n"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"

export interface ImagePreviewItem {
  src: string
  alt?: string
}

export interface ImagePreviewProps {
  src?: string
  alt?: string
  images?: readonly ImagePreviewItem[]
  initial?: number
}

export function ImagePreview(props: ImagePreviewProps) {
  const i18n = useI18n()

  const images = () => {
    if (props.images?.length) return props.images

    if (props.src) return [{ src: props.src, alt: props.alt }]

    return []
  }

  const [index, setIndex] = createSignal(Math.max(0, Math.min(props.initial ?? 0, images().length - 1)))
  const current = () => images()[Math.min(index(), images().length - 1)]

  const step = (delta: number) => {
    const total = images().length

    if (total < 2) return
    setIndex((index() + delta + total) % total)
  }

  onMount(() => {
    if (images().length < 2) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return

      event.preventDefault()
      event.stopPropagation()
      step(event.key === "ArrowLeft" ? -1 : 1)
    }

    window.addEventListener("keydown", onKeyDown, true)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true))
  })

  return (
    <div data-component="image-preview">
      <div data-slot="image-preview-container">
        <Kobalte.Content data-slot="image-preview-content">
          <div data-slot="image-preview-header">
            <Kobalte.CloseButton
              data-slot="image-preview-close"
              as={IconButton}
              icon={<Icon name="close" />}
              variant="ghost"
              aria-label={i18n.t("ui.common.close")}
            />
          </div>
          <div data-slot="image-preview-body">
            <Show when={current()}>
              {(image) => (
                <img
                  src={image().src}
                  alt={image().alt ?? i18n.t("ui.imagePreview.alt")}
                  data-slot="image-preview-image"
                />
              )}
            </Show>
          </div>
          <Show when={images().length > 1}>
            <div data-slot="image-preview-footer">
              <IconButton
                data-slot="image-preview-previous"
                icon={<Icon name="chevron-left" />}
                variant="ghost"
                aria-label={i18n.t("ui.imagePreview.previous")}
                onClick={() => step(-1)}
              />
              <span data-slot="image-preview-counter" aria-live="polite">
                {i18n.t("ui.imagePreview.counter", { current: index() + 1, total: images().length })}
              </span>
              <IconButton
                data-slot="image-preview-next"
                icon={<Icon name="chevron-right" />}
                variant="ghost"
                aria-label={i18n.t("ui.imagePreview.next")}
                onClick={() => step(1)}
              />
            </div>
          </Show>
        </Kobalte.Content>
      </div>
    </div>
  )
}
