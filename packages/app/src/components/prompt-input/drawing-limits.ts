import { showToast } from "@opencode-ai/ui/toast"

export const DRAW_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const DRAW_IMAGE_MAX_EDGE = 2048
export const DRAW_IMAGE_MAX_COUNT = 10
export const DRAW_FILES_MAX_BYTES = 15 * 1024 * 1024
export const DRAW_EXPORT_MAX_EDGE = 2048

type BinaryFile = { dataURL: string; mimeType: string }

export function filesBytes(files: Record<string, BinaryFile>) {
  return Object.values(files).reduce((sum, file) => sum + file.dataURL.length, 0)
}

export function filesCount(files: Record<string, BinaryFile>) {
  return Object.keys(files).length
}

export function filesWithinBudget(files: Record<string, BinaryFile>) {
  if (filesCount(files) > DRAW_IMAGE_MAX_COUNT) return false
  if (filesBytes(files) > DRAW_FILES_MAX_BYTES) return false
  return true
}

function read(file: File) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => resolve(""))
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      resolve(value)
    })
    reader.readAsDataURL(file)
  })
}

async function resize(dataURL: string, mime: string, edge: number) {
  const img = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    img.addEventListener("load", () => resolve())
    img.addEventListener("error", () => reject())
  })
  img.src = dataURL
  await loaded

  const long = Math.max(img.width, img.height)
  const scale = long > edge ? edge / long : 1
  const width = Math.round(img.width * scale)
  const height = Math.round(img.height * scale)

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return dataURL
  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL(mime)
}

export async function prepareImage(file: File) {
  const mime = file.type.startsWith("image/") ? file.type : "image/png"
  let dataURL = await read(file)
  if (!dataURL) return

  if (file.size > DRAW_IMAGE_MAX_BYTES) {
    dataURL = await resize(dataURL, mime, DRAW_IMAGE_MAX_EDGE)
    const approx = dataURL.length * 0.75
    if (approx > DRAW_IMAGE_MAX_BYTES) return
  }

  const img = new Image()
  const loaded = new Promise<void>((resolve, reject) => {
    img.addEventListener("load", () => resolve())
    img.addEventListener("error", () => reject())
  })
  img.src = dataURL
  await loaded
  const long = Math.max(img.width, img.height)
  if (long > DRAW_IMAGE_MAX_EDGE) dataURL = await resize(dataURL, mime, DRAW_IMAGE_MAX_EDGE)

  return { mimeType: mime, dataURL, id: crypto.randomUUID() }
}

export function toastLimit(
  t: (key: string) => string,
  kind: "size" | "count" | "total" | "type",
) {
  const key =
    kind === "size"
      ? "prompt.toast.drawImageTooLarge"
      : kind === "count"
        ? "prompt.toast.drawImageCount"
        : kind === "total"
          ? "prompt.toast.drawImageTotal"
          : "prompt.toast.drawImageType"
  showToast({
    title: t(`${key}.title`),
    description: t(`${key}.description`),
  })
}
