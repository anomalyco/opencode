/** @jsxImportSource react */
// @ts-nocheck — Solid app tsconfig; this file is compiled with @vitejs/plugin-react
import { useCallback } from "react"
import { createRoot } from "react-dom/client"
import { Excalidraw } from "@excalidraw/excalidraw"
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import "@excalidraw/excalidraw/index.css"
import "@/components/excalidraw/excalidraw-draw-overrides.css"
import { bundledLibraries } from "@/components/excalidraw/excalidraw-libraries"
export type DrawEditorProps = {
  theme: "light" | "dark"
  onApi: (api: ExcalidrawImperativeAPI) => void
  onChange: (elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => void
  initialData?: ExcalidrawInitialDataState
}

function DrawEditor(props: DrawEditorProps) {
  const onApi = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      props.onApi(api)
    },
    [props.onApi],
  )

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <Excalidraw
        excalidrawAPI={onApi}
        theme={props.theme}
        viewModeEnabled={false}
        initialData={{
          libraryItems: bundledLibraries,
          ...props.initialData,
        }}
        onChange={(elements, state, files) => props.onChange(elements, state, files)}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: true,
            loadScene: false,
            saveToActiveFile: false,
            toggleTheme: false,
          },
          tools: { image: true },
        }}
      />
    </div>
  )
}

export function mountDraw(el: HTMLElement, props: DrawEditorProps) {
  const root = createRoot(el)
  root.render(<DrawEditor {...props} />)
  return () => {
    root.unmount()
  }
}
