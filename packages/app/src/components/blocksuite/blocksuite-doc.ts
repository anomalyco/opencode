import { AffineSchemas } from "@blocksuite/blocks/schemas"
import type { Doc } from "@blocksuite/store"
import { DocCollection, Schema } from "@blocksuite/store"
import "@/components/blocksuite/blocksuite-doc.css"
import { watchCursorLabels } from "./cursor-labels"
import { baseline, docPlain, ensureEditable } from "./doc-content"
import { initDoc } from "./doc-init"
import { link, load, remote } from "./doc-remote"
import { ensureEffects } from "./effects"
import { frame, settled } from "./frame"
import { inlineReady } from "./inline-editor"
import {
  OpencodeAwarenessSource,
  OpencodeBlobSource,
  OpencodeDocSource,
  type DocSyncOpts,
} from "./opencode-doc-source"
import { scheme } from "./theme"

export type DocMountInput = {
  theme: () => "light" | "dark"
  sync?: DocSyncOpts
  init?: boolean
}

export async function createPage(input: DocMountInput) {
  await ensureEffects()
  const [{ PageEditor }, { ThemeProvider }] = await Promise.all([
    import("@blocksuite/presets"),
    import("@blocksuite/blocks"),
  ])

  const schema = new Schema().register(AffineSchemas)
  const page = "page"
  let doc: Doc | undefined
  let collection: DocCollection
  let direct: OpencodeDocSource | undefined
  let unlink: (() => void) | undefined
  let awareness: OpencodeAwarenessSource | undefined
  let aware = false

  if (input.sync) {
    direct = new OpencodeDocSource(input.sync)
    awareness = new OpencodeAwarenessSource(input.sync)
    collection = new DocCollection({
      schema,
      id: input.sync.docID,
      blobSources: { main: new OpencodeBlobSource(input.sync) },
      awarenessSources: [awareness],
    })
    collection.meta.initialize()
    collection.awarenessStore.awareness.setLocalStateField("user", { name: input.sync.name })
    collection.awarenessStore.awareness.setLocalStateField("color", input.sync.color)
    if (input.init !== false) {
      doc = await remote(direct, collection, input.sync.docID, page)
      doc = doc ?? collection.getDoc(page) ?? collection.createDoc({ id: page })
      if (!doc.loaded) doc.load()
      await load(direct, page, doc.spaceDoc)
      if (!doc.root) initDoc(doc)
      baseline(doc)
    }
    if (input.init === false) {
      while (!doc) {
        doc = await remote(direct, collection, input.sync.docID, page)
        if (doc) break
        await frame()
      }
    }
  } else {
    collection = new DocCollection({ schema })
    collection.meta.initialize()
  }

  doc = doc ?? collection.getDoc(page) ?? collection.createDoc({ id: page })
  if (!doc.loaded) doc.load()
  if (!doc.root && input.init !== false) initDoc(doc)
  baseline(doc)
  if (input.sync) {
    unlink = await link(direct!, collection.doc, doc.spaceDoc)
  }

  const editor = new PageEditor()
  editor.doc = doc
  editor.hasViewport = true

  const applyTheme = () => {
    editor.std.get(ThemeProvider).app$.value = scheme(input.theme())
  }

  const focus = async (ready?: Awaited<ReturnType<typeof inlineReady>>) => {
    ensureEditable(doc)
    const next = ready ?? (await inlineReady(editor))
    next.focusEnd()
    await next.waitForUpdate()
  }

  let resize: ResizeObserver | undefined
  let cursors: (() => void) | undefined

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
    const events = el.style.pointerEvents
    el.style.pointerEvents = "none"
    el.setAttribute("aria-busy", "true")
    if (!attached) el.replaceChildren(editor)
    try {
      await settled(editor.updateComplete)
      await settled(editor.host?.updateComplete)
      const ready = await inlineReady(editor)
      applyTheme()
      fit(el)
      resize?.disconnect()
      resize = new ResizeObserver(() => fit(el))
      resize.observe(el)
      cursors?.()
      cursors = watchCursorLabels(editor, el)
      if (!attached) await focus(ready)
      if (input.sync && !aware) {
        collection.awarenessSync.connect()
        aware = true
      }
      await frame()
    } finally {
      el.style.pointerEvents = events
      el.removeAttribute("aria-busy")
    }
  }

  const detach = () => {
    cursors?.()
    cursors = undefined
    resize?.disconnect()
    resize = undefined
    editor.remove()
  }

  let hadText = false

  const settle = () => {
    ensureEditable(doc)
    const empty = !docPlain(doc)
    if (empty) {
      if (!input.sync) doc.resetHistory()
      hadText = false
      return
    }
    hadText = true
  }

  const onHistory = () => {
    const empty = !docPlain(doc)
    if (hadText && empty && !input.sync) doc.resetHistory()
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
    requestAnimationFrame(() => void focus())
  }

  const redo = () => {
    if (!doc.canRedo) return
    doc.redo()
    onHistory()
    requestAnimationFrame(() => void focus())
  }

  return {
    doc,
    editor,
    collection,
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
    dispose: async () => {
      cursors?.()
      cursors = undefined
      resize?.disconnect()
      resize = undefined
      detach()
      if (input.sync) {
        unlink?.()
        direct?.close()
        if (aware) collection.awarenessSync.disconnect()
        collection.dispose()
      }
      doc.dispose()
    },
  }
}
