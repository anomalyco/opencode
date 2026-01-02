export interface FullPageCaptureResult {
  dataUrl: string
  width: number
  height: number
}

export interface PageDimensions {
  scrollWidth: number
  scrollHeight: number
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
}

export function getPageDimensions(): PageDimensions {
  return {
    scrollWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      document.documentElement.offsetWidth,
    ),
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.offsetHeight,
    ),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  }
}

export function scrollTo(x: number, y: number): Promise<void> {
  return new Promise((resolve) => {
    window.scrollTo(x, y)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

export function getCurrentScroll(): { x: number; y: number } {
  return {
    x: window.scrollX || document.documentElement.scrollLeft,
    y: window.scrollY || document.documentElement.scrollTop,
  }
}

export async function stitchImages(
  images: { dataUrl: string; x: number; y: number; width: number; height: number }[],
  totalWidth: number,
  totalHeight: number,
  devicePixelRatio: number,
): Promise<string> {
  const canvas = document.createElement("canvas")
  canvas.width = totalWidth * devicePixelRatio
  canvas.height = totalHeight * devicePixelRatio

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not get canvas context")

  ctx.scale(devicePixelRatio, devicePixelRatio)

  const loadImage = (dataUrl: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = dataUrl
    })
  }

  for (const tile of images) {
    const img = await loadImage(tile.dataUrl)
    ctx.drawImage(img, tile.x, tile.y, tile.width, tile.height)
  }

  return canvas.toDataURL("image/png")
}

export interface CaptureProgress {
  current: number
  total: number
  phase: "preparing" | "capturing" | "stitching"
}

export type ProgressCallback = (progress: CaptureProgress) => void
