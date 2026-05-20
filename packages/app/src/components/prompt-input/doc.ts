import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createPage } from "@/components/blocksuite/blocksuite-doc"

type DocHandle = Awaited<ReturnType<typeof createPage>>

export function createPromptDoc() {
  let handle: DocHandle | undefined
  let theme: (() => "light" | "dark") | undefined
  let historySub: { dispose: () => void } | undefined
  let mounted: HTMLElement | undefined

  const [ready, setReady] = createSignal(false)
  const [history, setHistory] = createStore({ undo: false, redo: false })

  const sync = () => {
    if (!handle) return
    const undo = handle.canUndo()
    const redo = handle.canRedo()
    if (history.undo === undo && history.redo === redo) return
    setHistory({ undo, redo })
  }

  const mount = async (input: { el: HTMLElement; theme: () => "light" | "dark" }) => {
    if (mounted === input.el && handle) {
      await handle.attach(input.el)
      return
    }
    mounted = input.el
    theme = input.theme
    if (!handle) handle = await createPage({ theme: input.theme })
    await handle.attach(input.el)
    setReady(true)
    sync()
    historySub?.dispose()
    historySub = handle.doc.slots.historyUpdated.on(() => {
      handle?.onHistory()
      sync()
    })
  }

  const detach = () => {
    historySub?.dispose()
    historySub = undefined
    handle?.detach()
    mounted = undefined
    setReady(false)
  }

  const reset = () => {
    detach()
    handle?.dispose()
    handle = undefined
    theme = undefined
    setHistory({ undo: false, redo: false })
  }

  const guard = () => handle?.guard()

  const undo = () => {
    handle?.undo()
    sync()
  }

  const redo = () => {
    handle?.redo()
    sync()
  }

  const commitText = () => handle?.plain()

  const empty = () => (handle ? handle.empty() : true)

  return {
    ready,
    history,
    mount,
    detach,
    reset,
    guard,
    commitText,
    empty,
    undo,
    redo,
    setTheme: (scheme: "light" | "dark") => handle?.setTheme(scheme),
    watchTheme: () => {
      if (!handle || !theme) return
      handle.setTheme(theme())
    },
  }
}
