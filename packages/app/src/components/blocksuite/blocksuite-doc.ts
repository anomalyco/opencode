import { ColorScheme } from "@blocksuite/affine-model"
import { AffineSchemas } from "@blocksuite/blocks/schemas"
import type { Doc } from "@blocksuite/store"
import { DocCollection, Schema } from "@blocksuite/store"
import "@/components/blocksuite/blocksuite-doc.css"
import { OpencodeAwarenessSource, OpencodeDocSource, type DocSyncOpts } from "./opencode-doc-source"

function scheme(theme: "light" | "dark") {
  return theme === "dark" ? ColorScheme.Dark : ColorScheme.Light
}

const state = globalThis as typeof globalThis & { __opencode_blocksuite_effects?: boolean }
let effectsReady = Boolean(state.__opencode_blocksuite_effects)

async function ensureEffects() {
  if (effectsReady) return
  if (customElements.get("page-editor")) {
    effectsReady = true
    state.__opencode_blocksuite_effects = true
    return
  }
  const [{ effects: presetEffects }, { effects: blockEffects }] = await Promise.all([
    import("@blocksuite/presets/effects"),
    import("@blocksuite/blocks/effects"),
  ])
  presetEffects()
  blockEffects()
  effectsReady = true
  state.__opencode_blocksuite_effects = true
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
  if (!doc.canUndo) return
  doc.resetHistory()
}

function frame() {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish)
    }
    setTimeout(finish, 50)
  })
}

async function settled(done?: Promise<unknown>) {
  if (done) await done
  await frame()
}

type Inline = {
  focusEnd: () => void
  mounted: boolean
  rendering: boolean
  waitForUpdate: () => Promise<void>
}

type Rich = HTMLElement & {
  inlineEditor?: Inline | null
  updateComplete?: Promise<unknown>
}

type EditorEl = HTMLElement & { host?: { querySelector: HTMLElement["querySelector"] } | null }
type YDoc = InstanceType<typeof DocCollection.Y.Doc>

function rich(editor: EditorEl) {
  const rich = editor.host?.querySelector("rich-text") ?? editor.querySelector("rich-text")
  if (!rich || !("inlineEditor" in rich)) return
  return rich as Rich
}

async function inlineReady(editor: EditorEl) {
  while (true) {
    const el = rich(editor)
    await el?.updateComplete
    const next = el?.inlineEditor
    if (next?.mounted && !next.rendering) {
      await next.waitForUpdate()
      if (next.mounted && !next.rendering) return next
    }
    await frame()
  }
}

function add(doc: Doc, flavour: string, id: string, parent?: string) {
  return doc.addBlock(flavour as never, { id }, parent)
}

function initDoc(doc: Doc) {
  doc.load()
  if (doc.root) return
  doc.withoutTransact(() => {
    const root = add(doc, "affine:page", "prompt-page")
    add(doc, "affine:surface", "prompt-surface", root)
    const note = add(doc, "affine:note", "prompt-note", root)
    add(doc, "affine:paragraph", "prompt-paragraph", note)
  })
}

function subdoc(collection: DocCollection, page: string) {
  return collection.doc.spaces.get(page)
}

function bind(collection: DocCollection, page: string) {
  const doc = collection.getDoc(page)
  if (doc) return doc
  if (!subdoc(collection, page)) return null
  if (!collection.meta.getDocMeta(page)) {
    collection.meta.addDocMeta({
      id: page,
      title: "",
      createDate: Date.now(),
      tags: [],
    })
  }
  return collection.getDoc(page)
}

async function load(source: OpencodeDocSource, id: string, doc: YDoc) {
  const next = await source.pull(id, DocCollection.Y.encodeStateVector(doc))
  if (next?.data.length) DocCollection.Y.applyUpdate(doc, next.data, source.name)
}

async function link(source: OpencodeDocSource, root: YDoc, page: YDoc) {
  const apply = (id: string, data: Uint8Array) => {
    if (id !== page.guid) return
    DocCollection.Y.applyUpdate(page, data, source.name)
  }
  const stop = await source.subscribe(apply, () => undefined)
  await load(source, root.guid, root)
  await load(source, page.guid, page)
  await source.push(root.guid, DocCollection.Y.encodeStateAsUpdate(root))
  await source.push(page.guid, DocCollection.Y.encodeStateAsUpdate(page))
  const push = (data: Uint8Array, origin: unknown, doc: YDoc) => {
    if (origin === source.name) return
    void source.push(doc.guid, data)
  }
  page.on("update", push)
  return () => {
    page.off("update", push)
    stop()
    source.close()
  }
}

async function remote(source: OpencodeDocSource, collection: DocCollection, root: string, page: string) {
  await load(source, root, collection.doc)
  const doc = bind(collection, page)
  if (!doc) return
  if (!doc.loaded) doc.load()
  await load(source, page, doc.spaceDoc)
  if (!doc.root) return
  return doc
}

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

  const focus = async (ready?: Inline) => {
    ensureEditable(doc)
    const next = ready ?? (await inlineReady(editor))
    next.focusEnd()
    await next.waitForUpdate()
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
