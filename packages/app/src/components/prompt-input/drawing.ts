import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import type { ExcalidrawImperativeAPI, BinaryFiles, AppState } from "@excalidraw/excalidraw/types"
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types"
import type { ImageAttachmentPart } from "@/context/prompt"
import { uuid } from "@/utils/uuid"
import { exportDraw } from "@/components/excalidraw/excalidraw-export"
import { filesWithinBudget, toastLimit } from "./drawing-limits"
import { mountDrawToolbar } from "./drawing-toolbar"

type DrawingInput = {
  t: (key: string) => string
}

type DrawMountInput = {
  el: HTMLElement
  theme: () => "light" | "dark"
}

function blobUrl(blob: Blob) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => resolve(""))
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      resolve(value)
    })
    reader.readAsDataURL(blob)
  })
}

function historyBtn(root: HTMLElement | undefined, kind: "undo" | "redo") {
  return root?.querySelector(`[data-testid="button-${kind}"]`) as HTMLButtonElement | null
}

export function hasDrawContent(elements: readonly { isDeleted: boolean }[]) {
  return elements.some((el) => !el.isDeleted)
}

export function createPromptDrawing(input: DrawingInput) {
  let api: ExcalidrawImperativeAPI | undefined
  let unmount: VoidFunction | undefined
  let toolbar: VoidFunction | undefined
  let root: HTMLElement | undefined
  const [store, setStore] = createStore({
    elements: [] as readonly ExcalidrawElement[],
    files: {} as BinaryFiles,
  })

  const [history, setHistory] = createStore({ undo: false, redo: false })
  const [ready, setReady] = createSignal(false)
  const [filled, setFilled] = createSignal(false)
  const [stroke, setStroke] = createSignal("#1e1e1e")

  const sync = () => {
    const undo = historyBtn(root, "undo")
    const redo = historyBtn(root, "redo")
    setHistory({ undo: undo ? !undo.disabled : false, redo: redo ? !redo.disabled : false })
  }

  const syncFilled = () => {
    const elements = api?.getSceneElements() ?? store.elements
    setFilled(hasDrawContent(elements))
  }

  const restore = (elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
    if (!api) return
    api.updateScene({ elements, files } as Parameters<ExcalidrawImperativeAPI["updateScene"]>[0])
  }

  const onChange = (elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    if (filesWithinBudget(files)) {
      setStore("elements", elements)
      setStore("files", files)
      setStroke(state.currentItemStrokeColor)
      sync()
      syncFilled()
      return
    }
    restore(store.elements, store.files)
    toastLimit(input.t, "total")
  }

  const mount = async (mountInput: DrawMountInput) => {
    unmount?.()
    toolbar?.()
    root = mountInput.el
    toolbar = mountDrawToolbar(mountInput.el)
    const mod = await import("@/components/excalidraw/excalidraw-editor")
    unmount = mod.mountDraw(mountInput.el, {
      theme: mountInput.theme(),
      onApi: (next) => {
        api = next
        const tool = next.getAppState().activeTool
        const state = next.getAppState()
        setStroke(state.currentItemStrokeColor)
        next.updateScene({
          appState: {
            activeTool: {
              type: "freedraw",
              customType: null,
              lastActiveTool: tool,
              locked: tool.locked,
            },
          },
        })
        setReady(true)
        setStore("elements", next.getSceneElements())
        setStore("files", next.getFiles())
        syncFilled()
        requestAnimationFrame(sync)
      },
      onChange,
    })
  }

  const undo = () => {
    historyBtn(root, "undo")?.click()
    requestAnimationFrame(sync)
  }

  const redo = () => {
    historyBtn(root, "redo")?.click()
    requestAnimationFrame(sync)
  }

  const toggleHand = () => {
    root?.querySelector<HTMLElement>('[data-testid="toolbar-hand"]')?.click()
  }

  const empty = () => {
    const elements = api?.getSceneElements() ?? store.elements
    return !elements.some((el) => !el.isDeleted)
  }

  const commit = async (): Promise<ImageAttachmentPart | undefined> => {
    if (!api || empty()) return
    const blob = await exportDraw(api)
    if (!blob) return
    const dataUrl = await blobUrl(blob)
    if (!dataUrl) return
    return {
      type: "image",
      id: uuid(),
      filename: `drawing-${Date.now()}.png`,
      mime: "image/png",
      dataUrl,
    }
  }

  const setStrokeColor = (color: string) => {
    if (!api) return
    api.updateScene({ appState: { currentItemStrokeColor: color } })
    setStroke(color)
  }

  const dispose = () => {
    unmount?.()
    unmount = undefined
    toolbar?.()
    toolbar = undefined
    api = undefined
    root = undefined
    setReady(false)
    setFilled(false)
    setHistory({ undo: false, redo: false })
  }

  return {
    ready,
    filled,
    history,
    stroke,
    mount,
    dispose,
    commit,
    empty,
    undo,
    redo,
    toggleHand,
    setStroke: setStrokeColor,
  }
}
