import { AffineSchemas } from "@blocksuite/blocks/schemas"
import type { Doc } from "@blocksuite/store"
import { DocCollection, Schema } from "@blocksuite/store"
import "@/components/blocksuite/blocksuite-doc.css"
import { watchCursorLabels } from "./cursor-labels"
import { baseline, docMarkdown, docPlain, ensureEditable } from "./doc-content"
import { initDoc } from "./doc-init"
import { link, load, remote } from "./doc-remote"
import { ensureEffects } from "./effects"
import { frame, settled } from "./frame"
import { inlineReady } from "./inline-editor"
import { OpencodeAwarenessSource, OpencodeBlobSource, OpencodeDocSource, type DocSyncOpts } from "./opencode-doc-source"
import { scheme } from "./theme"

export type DocMountInput = {
  theme: () => "light" | "dark"
  sync?: DocSyncOpts
  init?: boolean
  readonly?: boolean
}

export async function createPage(input: DocMountInput) {
  await ensureEffects()
  const [{ PageEditor }, { PreviewEditorBlockSpecs, ThemeProvider }] = await Promise.all([
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
    awareness = input.readonly ? undefined : new OpencodeAwarenessSource(input.sync)
    collection = new DocCollection({
      schema,
      id: input.sync.docID,
      blobSources: { main: new OpencodeBlobSource(input.sync) },
      awarenessSources: awareness ? [awareness] : [],
    })
    collection.meta.initialize()
    if (awareness) {
      collection.awarenessStore.awareness.setLocalStateField("user", { name: input.sync.name })
      collection.awarenessStore.awareness.setLocalStateField("color", input.sync.color)
    }
    if (input.init !== false) {
      doc = await remote(direct, collection, input.sync.docID, page, input.readonly)
      doc = doc ?? collection.getDoc(page, { readonly: input.readonly }) ?? collection.createDoc({ id: page })
      if (!doc.loaded) doc.load()
      await load(direct, page, doc.spaceDoc)
      if (!doc.root && !input.readonly) initDoc(doc)
      if (!input.readonly) baseline(doc)
    }
    if (input.init === false) {
      if (input.readonly) {
        doc = await remote(direct, collection, input.sync.docID, page, input.readonly)
        if (!doc?.root) throw new Error("doc viewer load failed")
      } else {
        while (!doc) {
          doc = await remote(direct, collection, input.sync.docID, page, input.readonly)
          if (doc) break
          await frame()
        }
      }
    }
  } else {
    collection = new DocCollection({ schema })
    collection.meta.initialize()
  }

  doc = doc ?? collection.getDoc(page, { readonly: input.readonly }) ?? collection.createDoc({ id: page })
  if (!doc.loaded) doc.load()
  if (!doc.root && input.init !== false && !input.readonly) initDoc(doc)
  if (!input.readonly) baseline(doc)
  if (input.sync && !input.readonly) {
    unlink = await link(direct!, collection.doc, doc.spaceDoc)
  }

  const editor = new PageEditor()
  editor.doc = doc
  if (input.readonly) editor.specs = PreviewEditorBlockSpecs
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
    const tall = input.readonly ? Math.max(height || 180, 96) : height
    if (tall <= 0) return
    editor.style.display = "block"
    editor.style.height = `${tall}px`
    editor.style.width = width > 0 ? `${width}px` : "100%"
    const viewport = editor.querySelector(".affine-page-viewport")
    if (viewport instanceof HTMLElement) {
      viewport.style.width = width > 0 ? `${width}px` : "100%"
      viewport.style.height = `${tall}px`
      viewport.style.minHeight = input.readonly ? "0" : `${tall}px`
      viewport.style.overflowY = input.readonly ? "auto" : ""
    }
    const root = editor.querySelector(".affine-page-root-block-container")
    if (root instanceof HTMLElement) {
      root.style.maxWidth = "none"
      root.style.margin = "0"
      if (width > 0) root.style.width = `${width}px`
      if (input.readonly) root.style.minHeight = "0"
    }
    const preview = editor.querySelector("affine-preview-root")
    if (preview instanceof HTMLElement) {
      preview.style.display = "block"
      preview.style.width = width > 0 ? `${width}px` : "100%"
      preview.style.maxWidth = "none"
      preview.style.margin = "0"
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
      const ready = input.readonly ? undefined : await inlineReady(editor)
      applyTheme()
      fit(el)
      resize?.disconnect()
      resize = new ResizeObserver(() => fit(el))
      resize.observe(el)
      cursors?.()
      cursors = input.readonly ? undefined : watchCursorLabels(editor, el)
      if (!attached && ready) await focus(ready)
      if (input.sync && awareness && !aware) {
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
    markdown: () =>
      input.sync
        ? docMarkdown(doc, {
            docID: input.sync.docID,
            baseUrl: input.sync.baseUrl,
            directory: input.sync.directory,
            fetch: input.sync.fetch,
          })
        : Promise.resolve({ text: docPlain(doc), assets: [] }),
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
