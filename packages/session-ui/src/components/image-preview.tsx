import { createSignal } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { ImagePreview } from "@opencode/ui/image-preview"

export function createImagePreview() {
  const dialog = useDialog()
  const i18n = useI18n()

  return (root: HTMLElement) => {
    const open = (event: MouseEvent | KeyboardEvent) => {
      const clicked = event.currentTarget

      if (!(clicked instanceof HTMLImageElement)) return

      const images = Array.from(root.querySelectorAll<HTMLImageElement>("img:not([data-markdown-favicon])")).flatMap(
        (image) => {
          const src = image.currentSrc || image.getAttribute("src")

          if (!src) return []

          return [{ src, alt: image.alt || i18n.t("ui.imagePreview.alt"), origin: image }]
        },
      )

      if (!images.length) return

      const initial = images.findIndex((image) => image.origin === clicked)
      event.preventDefault()
      event.stopPropagation()
      dialog.show(() => <ImageGallery images={images} initial={Math.max(0, initial)} />)
    }

    root.querySelectorAll<HTMLImageElement>("img:not([data-markdown-favicon])").forEach((image) => {
      image.setAttribute("role", "button")
      image.setAttribute("aria-haspopup", "dialog")
      image.setAttribute("aria-label", image.alt || i18n.t("ui.imagePreview.alt"))
      image.tabIndex = 0
      image.onclick = open
      image.onkeydown = (event) => {
        if (event.key !== "Enter" && event.key !== " ") return

        open(event)
      }
    })
  }
}

function ImageGallery(props: {
  images: { src: string; alt: string; origin: HTMLImageElement }[]
  initial: number
}) {
  const [index, setIndex] = createSignal(Math.max(0, Math.min(props.initial, props.images.length - 1)))
  const current = () => props.images[index()]
  const many = () => props.images.length > 1

  const step = (delta: number) => {
    const total = props.images.length

    if (total < 2) return
    setIndex((index() + delta + total) % total)
  }

  return (
    <ImagePreview
      src={current().src}
      alt={current().alt}
      origin={current().origin}
      onPrevious={many() ? () => step(-1) : undefined}
      onNext={many() ? () => step(1) : undefined}
      position={many() ? { index: index() + 1, total: props.images.length } : undefined}
    />
  )
}
