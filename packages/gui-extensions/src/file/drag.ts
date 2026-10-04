import { pathToFileUrl } from "./path"

const buildDragImage = (target: HTMLElement) => {
  const icon = target.querySelector('[data-component="file-icon"]') ?? target.querySelector("svg")
  const text = target.querySelector("span")
  if (!icon || !text) return

  const image = document.createElement("div")
  image.className =
    "flex items-center gap-x-2 px-2 py-1 bg-surface-raised-base rounded-md border border-border-base text-12-regular text-text-strong"
  image.style.position = "absolute"
  image.style.top = "-1000px"
  image.innerHTML = (icon as SVGElement).outerHTML + (text as HTMLSpanElement).outerHTML
  return image
}

const withFileDragImage = (event: DragEvent) => {
  const image = buildDragImage(event.currentTarget as HTMLElement)
  if (!image) return
  document.body.appendChild(image)
  event.dataTransfer?.setDragImage(image, 0, 12)
  setTimeout(() => document.body.removeChild(image), 0)
}

/** Drag data for a workspace file row, so it drops as a file reference. */
export function startFileDrag(event: DragEvent, path: string) {
  event.dataTransfer?.setData("text/plain", `file:${path}`)
  event.dataTransfer?.setData("text/uri-list", pathToFileUrl(path))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy"
  withFileDragImage(event)
}
