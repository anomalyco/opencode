import { exportToBlob } from "@excalidraw/excalidraw"
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types"
import { DRAW_EXPORT_MAX_EDGE } from "@/components/prompt-input/drawing-limits"

export async function exportDraw(api: ExcalidrawImperativeAPI) {
  const elements = api.getSceneElements().filter((el) => !el.isDeleted)
  if (elements.length === 0) return

  const appState = api.getAppState()
  return exportToBlob({
    elements,
    appState: {
      ...appState,
      exportBackground: true,
    },
    files: api.getFiles(),
    mimeType: "image/png",
    quality: 0.92,
    getDimensions: (width: number, height: number) => {
      const edge = Math.max(width, height)
      if (edge <= DRAW_EXPORT_MAX_EDGE) return { width, height, scale: 1 }
      const scale = DRAW_EXPORT_MAX_EDGE / edge
      return {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        scale,
      }
    },
  })
}
