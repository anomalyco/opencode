import { ColorScheme } from "@blocksuite/affine-model"
import type { Doc } from "@blocksuite/store"
import "@/components/blocksuite/blocksuite-doc.css"

function scheme(theme: "light" | "dark") {
  return theme === "dark" ? ColorScheme.Dark : ColorScheme.Light
}

let effectsReady = false

async function ensureEffects() {
  if (effectsReady) return
  const [{ effects: presetEffects }, { effects: blockEffects }] = await Promise.all([
    import("@blocksuite/presets/effects"),
    import("@blocksuite/blocks/effects"),
  ])
  presetEffects()
  blockEffects()
  effectsReady = true
}

function docPlain(doc: Doc) {
  const flavours = ["affine:paragraph", "affine:list"]
  const lines = doc
    .getBlockByFlavour(flavours)
    .map((model) => model.text?.toString?.() ?? "")
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.join("\n").trim()
}

function ensureEditable(doc: Doc) {
  if (doc.getBlockByFlavour("affine:paragraph").length > 0) return
  doc.withoutTransact(() => {
    const notes = doc.getBlockByFlavour("affine:note")
    if (notes[0]) {
      doc.addBlock("affine:paragraph", {}, notes[0].id)
      return
    }
    const pages = doc.getBlockByFlavour("affine:page")
    if (!pages[0]) return
    const noteId = doc.addBlock("affine:note", {}, pages[0].id)
    doc.addBlock("affine:paragraph", {}, noteId)
  })
}

function baseline(doc: Doc) {
  ensureEditable(doc)
  doc.resetHistory()
}

export type DocMountInput = {
  theme: () => "light" | "dark"
}

export async function createPage(input: DocMountInput) {
  await ensureEffects()
  const [{ createEmptyDoc, PageEditor }, { ThemeProvider }] = await Promise.all([
    import("@blocksuite/presets"),
    import("@blocksuite/blocks"),
  ])

  const { doc, init } = createEmptyDoc()
  init()
  baseline(doc)

  const editor = new PageEditor()
  editor.doc = doc
  editor.hasViewport = true

  const applyTheme = () => {
    editor.std.get(ThemeProvider).app$.value = scheme(input.theme())
  }

  const focus = () => {
    ensureEditable(doc)
    const host = editor.host
    const rich = host?.querySelector("rich-text") ?? editor.querySelector("rich-text")
    const inline =
      rich && "inlineEditor" in rich
        ? (rich as { inlineEditor?: { focusEnd: () => void } }).inlineEditor
        : undefined
    inline?.focusEnd()
  }

  let resize: ResizeObserver | undefined

  const fit = (host: HTMLElement) => {
    const height = host.clientHeight
    const width = host.clientWidth
    if (height <= 0) return
    editor.style.display = "block"
    editor.style.height = `${height}px`
    editor.style.width = width > 0 ? `${width}px` : "100%"
    const viewport = editor.querySelector(".affine-page-viewport")
    if (viewport instanceof HTMLElement) {
      viewport.style.width = width > 0 ? `${width}px` : "100%"
      viewport.style.height = `${height}px`
      viewport.style.minHeight = `${height}px`
    }
    const root = editor.querySelector(".affine-page-root-block-container")
    if (root instanceof HTMLElement) {
      root.style.maxWidth = "none"
      root.style.margin = "0"
      if (width > 0) root.style.width = `${width}px`
    }
  }

  const attach = async (el: HTMLElement) => {
    const attached = editor.parentElement === el
    if (!attached) el.replaceChildren(editor)
    await editor.updateComplete
    await editor.host?.updateComplete
    applyTheme()
    fit(el)
    resize?.disconnect()
    resize = new ResizeObserver(() => fit(el))
    resize.observe(el)
    if (!attached) focus()
  }

  const detach = () => {
    resize?.disconnect()
    resize = undefined
    editor.remove()
  }

  let hadText = false

  const settle = () => {
    ensureEditable(doc)
    const empty = !docPlain(doc)
    if (empty) {
      doc.resetHistory()
      hadText = false
      return
    }
    hadText = true
  }

  const onHistory = () => {
    const empty = !docPlain(doc)
    if (hadText && empty) doc.resetHistory()
    hadText = !empty
    ensureEditable(doc)
  }

  const guard = () => {
    ensureEditable(doc)
  }

  const undo = () => {
    if (!doc.canUndo) return
    doc.undo()
    settle()
    requestAnimationFrame(focus)
  }

  const redo = () => {
    if (!doc.canRedo) return
    doc.redo()
    onHistory()
    requestAnimationFrame(focus)
  }

  return {
    doc,
    editor,
    attach,
    detach,
    guard,
    onHistory,
    plain: () => docPlain(doc),
    empty: () => !docPlain(doc),
    undo,
    redo,
    canUndo: () => doc.canUndo,
    canRedo: () => doc.canRedo,
    setTheme: (theme: "light" | "dark") => {
      editor.std.get(ThemeProvider).app$.value = scheme(theme)
    },
    dispose: () => {
      resize?.disconnect()
      resize = undefined
      detach()
      doc.dispose()
    },
  }
}
