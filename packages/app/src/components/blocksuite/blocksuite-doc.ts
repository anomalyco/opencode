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
  let mutate: MutationObserver | undefined
  let unload: (() => void) | undefined
  let cursors: (() => void) | undefined

  const clamp = (height: number) => Math.min(650, Math.max(50, Math.ceil(height)))

  const content = (host: HTMLElement, root?: HTMLElement, preview?: HTMLElement) => {
    const base = host.getBoundingClientRect().top
    const boxes = Array.from(
      editor.querySelectorAll(
        [
          "img",
          "svg",
          "canvas",
          "video",
          "affine-image",
          "affine-image-block",
          "affine-attachment",
          "affine-embed",
          "[data-block-id]",
        ].join(","),
      ),
    )
      .filter((node): node is HTMLElement | SVGElement => node instanceof HTMLElement || node instanceof SVGElement)
      .map((node) => node.getBoundingClientRect().bottom - base)
    return Math.max(root?.scrollHeight ?? 0, preview?.scrollHeight ?? 0, ...boxes)
  }

  const fit = (host: HTMLElement) => {
    const width = host.clientWidth
    const root = editor.querySelector(".affine-page-root-block-container")
    const preview = editor.querySelector("affine-preview-root")
    const height =
      input.readonly && root instanceof HTMLElement
        ? content(host, root, preview instanceof HTMLElement ? preview : undefined)
        : host.clientHeight
    const tall = input.readonly ? clamp(height) : height
    if (tall <= 0) return
    if (input.readonly) host.style.height = `${tall}px`
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
    if (root instanceof HTMLElement) {
      root.style.maxWidth = "none"
      root.style.margin = "0"
      if (width > 0) root.style.width = `${width}px`
      if (input.readonly) root.style.minHeight = "0"
    }
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
      resize.observe(editor)
      const root = editor.querySelector(".affine-page-root-block-container")
      if (root instanceof HTMLElement) resize.observe(root)
      const preview = editor.querySelector("affine-preview-root")
      if (preview instanceof HTMLElement) resize.observe(preview)
      mutate?.disconnect()
      mutate = input.readonly ? new MutationObserver(() => fit(el)) : undefined
      mutate?.observe(editor, { childList: true, characterData: true, subtree: true })
      unload?.()
      const loaded = () => fit(el)
      editor.addEventListener("load", loaded, true)
      unload = () => editor.removeEventListener("load", loaded, true)
      cursors?.()
      cursors = input.readonly ? undefined : watchCursorLabels(editor, el)
      if (!attached && ready) await focus(ready)
      if (input.sync && awareness && !aware) {
        collection.awarenessSync.connect()
        aware = true
      }
      await frame()
      fit(el)
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
    mutate?.disconnect()
    mutate = undefined
    unload?.()
    unload = undefined
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
            directory: input.sync.directory,
            client: input.sync.client,
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
      mutate?.disconnect()
      mutate = undefined
      unload?.()
      unload = undefined
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
