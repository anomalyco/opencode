import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { ImagePreview } from "@opencode/ui/image-preview"

export function createImagePreview() {
  const dialog = useDialog()
  const i18n = useI18n()

  const open = (event: MouseEvent | KeyboardEvent) => {
    const image = event.currentTarget

    if (!(image instanceof HTMLImageElement)) return
    const src = image.currentSrc || image.getAttribute("src")

    if (!src) return
    const alt = image.alt || i18n.t("ui.imagePreview.alt")
    event.preventDefault()
    event.stopPropagation()
    dialog.show(() => <ImagePreview src={src} alt={alt} origin={image} />)
  }

  return (root: HTMLElement) => {
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
