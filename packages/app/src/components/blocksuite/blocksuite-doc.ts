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
  if (!done) return
  await Promise.race([done, frame()])
}

function initDoc(doc: Doc) {
  doc.load()
  if (doc.root) return
  doc.withoutTransact(() => {
    const rootId = doc.addBlock("affine:page", {})
    doc.addBlock("affine:surface", {}, rootId)
    const noteId = doc.addBlock("affine:note", {}, rootId)
    doc.addBlock("affine:paragraph", {}, noteId)
  })
}

function saved(collection: DocCollection) {
  const status = collection.docSync.status
  const main = status.main
  if (status.retrying) return true
  if (!main) return true
  return main.pendingPushUpdates === 0
}

function synced(collection: DocCollection) {
  const status = collection.docSync.status
  const main = status.main
  if (!main || status.retrying) return false
  const docs = 1 + collection.doc.getSubdocs().size
  return main.loadedDocs >= docs && main.totalDocs >= docs && main.pendingPushUpdates === 0
}

async function flush(collection: DocCollection) {
  if (!saved(collection)) {
    await new Promise<void>((resolve) => {
      let sub: { dispose: () => void } | undefined
      const done = () => {
        sub?.dispose()
        resolve()
      }
      sub = collection.docSync.onStatusChange.on(() => {
        if (saved(collection)) done()
      })
      if (saved(collection)) done()
    })
  }
}

async function wait(collection: DocCollection) {
  if (!synced(collection)) {
    await new Promise<void>((resolve) => {
      let sub: { dispose: () => void } | undefined
      const done = () => {
        sub?.dispose()
        resolve()
      }
      sub = collection.docSync.onStatusChange.on(() => {
        if (synced(collection)) done()
      })
      if (synced(collection)) done()
    })
  }
}

async function pageReady(collection: DocCollection, page: string): Promise<Doc> {
  let doc: Doc | null = collection.getDoc(page)
  const ready = () => {
    doc = collection.getDoc(page)
    if (!doc) return false
    if (!doc.loaded) doc.load()
    return Boolean(doc.root)
  }
  if (ready() && doc) return doc
  await new Promise<void>((resolve) => {
    const subs: { dispose: () => void }[] = []
    let root: { dispose: () => void } | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let pulling = false
    const done = () => {
      if (!ready()) {
        if (doc && !root) {
          root = doc.slots.rootAdded.on(done)
          subs.push(root)
        }
        return
      }
      if (timer) clearInterval(timer)
      subs.forEach((sub) => sub.dispose())
      resolve()
    }
    const pull = () => {
      if (pulling || ready()) {
        done()
        return
      }
      pulling = true
      collection.start()
      void collection.waitForSynced().finally(() => {
        pulling = false
        done()
      })
    }
    subs.push(collection.slots.docAdded.on(done))
    subs.push(collection.docSync.onStatusChange.on(done))
    collection.doc.on("subdocs", done)
    subs.push({ dispose: () => collection.doc.off("subdocs", done) })
    timer = setInterval(pull, 500)
    done()
  })
  const next = doc
  if (!next) throw new Error("prompt doc page missing")
  return next
}

async function stop(collection: DocCollection) {
  await flush(collection)
  collection.forceStop()
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
  let collection: DocCollection
  let source: OpencodeDocSource | undefined
  let awareness: OpencodeAwarenessSource | undefined

  if (input.sync) {
    source = new OpencodeDocSource(input.sync)
    awareness = new OpencodeAwarenessSource(input.sync)
    collection = new DocCollection({
      schema,
      id: input.sync.docID,
      docSources: { main: source },
      awarenessSources: [awareness],
    })
    collection.meta.initialize()
    collection.awarenessStore.awareness.setLocalStateField("user", { name: input.sync.name })
    collection.awarenessStore.awareness.setLocalStateField("color", input.sync.color)
    collection.start()
    await collection.waitForSynced()
  } else {
    collection = new DocCollection({ schema })
    collection.meta.initialize()
  }

  const page = "page"
  const doc =
    input.sync && input.init === false
      ? await pageReady(collection, page)
      : (collection.getDoc(page) ?? collection.createDoc({ id: page }))
  if (!doc.loaded) doc.load()
  if (!doc.root && input.init !== false) initDoc(doc)
  baseline(doc)
  if (input.sync) await wait(collection)

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
    await settled(editor.updateComplete)
    await settled(editor.host?.updateComplete)
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
        await stop(collection)
        source?.close()
        awareness?.disconnect()
        collection.dispose()
      }
      doc.dispose()
    },
  }
}
