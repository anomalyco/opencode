import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { ImagePreview } from "@opencode/ui/image-preview"

export function createImagePreview() {
  const dialog = useDialog()
  const i18n = useI18n()

  return (root: HTMLElement) => {
    const open = (event: MouseEvent | KeyboardEvent) => {
      if (!(event.currentTarget instanceof HTMLImageElement)) return

      const clicked = event.currentTarget

      const items = Array.from(root.querySelectorAll<HTMLImageElement>("img:not([data-markdown-favicon])")).flatMap(
        (image) => {
          const src = image.currentSrc || image.getAttribute("src")

          if (!src) return []

          return [{ image, src, alt: image.alt || i18n.t("ui.imagePreview.alt") }]
        },
      )

      if (!items.length) return

      const initial = items.findIndex((item) => item.image === clicked)
      event.preventDefault()
      event.stopPropagation()
      dialog.show(() => (
        <ImagePreview
          images={items.map(({ src, alt }) => ({ src, alt }))}
          initial={Math.max(0, initial)}
        />
      ))
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
