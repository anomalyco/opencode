import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { createPage } from "@/components/blocksuite/blocksuite-doc"

type DocHandle = Awaited<ReturnType<typeof createPage>>

export function createPromptDoc() {
  let handle: DocHandle | undefined
  let theme: (() => "light" | "dark") | undefined
  let historySub: { dispose: () => void } | undefined
  let root: HTMLElement | undefined

  const [ready, setReady] = createSignal(false)
  const [history, setHistory] = createStore({ undo: false, redo: false })

  const sync = () => {
    if (!handle) return
    setHistory({ undo: handle.canUndo(), redo: handle.canRedo() })
  }

  const mount = async (input: { el: HTMLElement; theme: () => "light" | "dark" }) => {
    root = input.el
    theme = input.theme
    if (!handle) handle = await createPage({ theme: input.theme })
    await handle.attach(input.el)
    setReady(true)
    sync()
    historySub?.dispose()
    historySub = handle.doc.slots.historyUpdated.on(() => sync())
  }

  const detach = () => {
    historySub?.dispose()
    historySub = undefined
    handle?.detach()
    root = undefined
    setReady(false)
  }

  const reset = () => {
    detach()
    handle?.dispose()
    handle = undefined
    theme = undefined
    setHistory({ undo: false, redo: false })
  }

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
