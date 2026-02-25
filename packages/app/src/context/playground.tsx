import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore, produce, reconcile } from "solid-js/store"
import { createMemo, onCleanup } from "solid-js"
import { useParams } from "@solidjs/router"
import { useSDK } from "./sdk"
import { useSync } from "./sync"

export type DeviceFrame = "auto" | "mobile" | "tablet" | "desktop"

export type PlaygroundWindow = {
  id: string
  title: string
  code: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  minimized: boolean
  maximized: boolean
  model: { providerID: string; modelID: string }
  sessionID: string
  deviceFrame: DeviceFrame
  error?: string
  streaming: boolean
  fixAttempts: number
}

type PlaygroundStore = {
  windows: PlaygroundWindow[]
  selected: string | undefined
  panel: "none" | "chat" | "code"
  zCounter: number
  generating: boolean
}

let idCounter = 0

function uid() {
  return `pw_${Date.now()}_${++idCounter}`
}

const CASCADE_OFFSET = 30
const DEFAULT_WIDTH = 480
const DEFAULT_HEIGHT = 400

export const { use: usePlayground, provider: PlaygroundProvider } = createSimpleContext({
  name: "Playground",
  gate: false,
  init: () => {
    const params = useParams()
    const sdk = useSDK()
    const sync = useSync()

    const [store, setStore] = createStore<PlaygroundStore>({
      windows: [],
      selected: undefined,
      panel: "none",
      zCounter: 1,
      generating: false,
    })

    const selected = createMemo(() => store.windows.find((w) => w.id === store.selected))

    function nextPosition() {
      const count = store.windows.length
      const offset = (count % 10) * CASCADE_OFFSET
      return { x: 60 + offset, y: 60 + offset }
    }

    function createWindow(input: {
      code: string
      title: string
      model: { providerID: string; modelID: string }
      sessionID: string
    }) {
      const pos = nextPosition()
      const id = uid()
      const z = store.zCounter + 1
      setStore("zCounter", z)
      setStore(
        "windows",
        produce((windows) => {
          windows.push({
            id,
            title: input.title,
            code: input.code,
            x: pos.x,
            y: pos.y,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            zIndex: z,
            minimized: false,
            maximized: false,
            model: input.model,
            sessionID: input.sessionID,
            deviceFrame: "auto",
            error: undefined,
            streaming: false,
            fixAttempts: 0,
          })
        }),
      )
      setStore("selected", id)
      return id
    }

    function closeWindow(id: string) {
      setStore(
        "windows",
        produce((windows) => {
          const idx = windows.findIndex((w) => w.id === id)
          if (idx >= 0) windows.splice(idx, 1)
        }),
      )
      if (store.selected === id) {
        setStore("selected", store.windows[0]?.id)
      }
    }

    function selectWindow(id: string | undefined) {
      setStore("selected", id)
      if (!id) return
      const z = store.zCounter + 1
      setStore("zCounter", z)
      const idx = store.windows.findIndex((w) => w.id === id)
      if (idx >= 0) setStore("windows", idx, "zIndex", z)
    }

    function updateWindow(id: string, patch: Partial<PlaygroundWindow>) {
      const idx = store.windows.findIndex((w) => w.id === id)
      if (idx < 0) return
      setStore(
        "windows",
        idx,
        produce((w) => {
          Object.assign(w, patch)
        }),
      )
    }

    function minimizeWindow(id: string) {
      const idx = store.windows.findIndex((w) => w.id === id)
      if (idx < 0) return
      setStore("windows", idx, "minimized", (v) => !v)
    }

    function maximizeWindow(id: string) {
      const idx = store.windows.findIndex((w) => w.id === id)
      if (idx < 0) return
      setStore("windows", idx, "maximized", (v) => !v)
    }

    function refreshWindow(id: string) {
      const idx = store.windows.findIndex((w) => w.id === id)
      if (idx < 0) return
      const code = store.windows[idx].code
      setStore("windows", idx, "code", "")
      queueMicrotask(() => setStore("windows", idx, "code", code))
    }

    function setPanel(panel: PlaygroundStore["panel"]) {
      setStore("panel", panel === store.panel ? "none" : panel)
    }

    return {
      get windows() {
        return store.windows
      },
      get selected() {
        return selected()
      },
      get selectedId() {
        return store.selected
      },
      get panel() {
        return store.panel
      },
      get generating() {
        return store.generating
      },
      setGenerating(v: boolean) {
        setStore("generating", v)
      },
      createWindow,
      closeWindow,
      selectWindow,
      updateWindow,
      minimizeWindow,
      maximizeWindow,
      refreshWindow,
      setPanel,
    }
  },
})
