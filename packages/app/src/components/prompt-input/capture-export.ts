import type Konva from "konva"

// 내보내기 최장변 상한(과거 drawing-limits.ts 의 DRAW_*_MAX_EDGE 와 동일). 첨부 payload 를 제한한다.
export const EXPORT_MAX_EDGE = 2048

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = src
  })
}

type ExportRegion = { x: number; y: number; width: number; height: number; pixelRatio: number }

// Konva 버전마다 toBlob 이 Promise / callback 둘 중 하나라서 양쪽을 모두 흡수하고,
// 실패 시 toCanvas → canvas.toBlob 으로 폴백한다.
export function stageToBlob(stage: Konva.Stage, region: ExportRegion): Promise<Blob | null> {
  const config = { ...region, mimeType: "image/png" }
  return new Promise((resolve) => {
    let settled = false
    const done = (blob: Blob | null) => {
      if (settled) return
      settled = true
      resolve(blob)
    }
    const fallback = () => {
      try {
        const canvas = (stage as unknown as { toCanvas: (c: ExportRegion) => HTMLCanvasElement }).toCanvas(region)
        canvas.toBlob((blob) => done(blob), "image/png")
      } catch {
        done(null)
      }
    }
    try {
      const maybe = (
        stage as unknown as {
          toBlob: (c: typeof config & { callback?: (b: Blob | null) => void }) => unknown
        }
      ).toBlob({ ...config, callback: (b: Blob | null) => done(b) })
      if (maybe && typeof (maybe as Promise<Blob | null>).then === "function") {
        ;(maybe as Promise<Blob | null>).then(done).catch(fallback)
      }
    } catch {
      fallback()
    }
  })
}

export function blobToPngFile(blob: Blob): File {
  return new File([blob], `tab-capture-${Date.now()}.png`, { type: "image/png" })
}
