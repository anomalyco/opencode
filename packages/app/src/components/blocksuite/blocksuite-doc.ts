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

  const editor = new PageEditor()
  editor.doc = doc
  editor.hasViewport = true

  const applyTheme = () => {
    editor.std.get(ThemeProvider).app$.value = scheme(input.theme())
  }

  const focus = () => {
    const rich = editor.querySelector("rich-text")
    const inline =
      rich && "inlineEditor" in rich
        ? (rich as { inlineEditor?: { focusEnd: () => void } }).inlineEditor
        : undefined
    inline?.focusEnd()
  }

  const attach = async (el: HTMLElement) => {
    if (editor.parentElement !== el) el.replaceChildren(editor)
    await editor.updateComplete
    applyTheme()
    focus()
  }

  const detach = () => {
    editor.remove()
  }

  return {
    doc,
    editor,
    attach,
    detach,
    focus,
    plain: () => docPlain(doc),
    empty: () => !docPlain(doc),
    undo: () => {
      doc.undo()
      requestAnimationFrame(focus)
    },
    redo: () => {
      doc.redo()
      requestAnimationFrame(focus)
    },
    canUndo: () => doc.canUndo,
    canRedo: () => doc.canRedo,
    setTheme: (theme: "light" | "dark") => {
      editor.std.get(ThemeProvider).app$.value = scheme(theme)
    },
    dispose: () => {
      detach()
      doc.dispose()
    },
  }
}
