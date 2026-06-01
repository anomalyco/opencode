import { AffineSchemas } from "@blocksuite/blocks/schemas"
import type { BlockModel, Doc, Query } from "@blocksuite/store"
import { getFilename } from "@opencode-ai/util/path"
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
import { FileReferenceBlockSpec, withFileReferenceSchema, type FileNodeType } from "./file-reference-block"
import { LineReferenceBlockSpec, withLineReferenceSchema } from "./line-reference-block"
import { lineReferenceUrl, normLineRef, type LineRefInput } from "./line-reference-url"

export type DocMountInput = {
  theme: () => "light" | "dark"
  locale?: () => string
  sync?: DocSyncOpts
  init?: boolean
  readonly?: boolean
  submit?: () => void
  onDraftChange?: () => void
}

export type DocActor = {
  actorID: string
  name: string
}

type TextProp = {
  toString?: () => string
}
type YBlock = {
  get?: (key: string) => unknown
}
type TextModel = {
  id?: string
  text?: TextProp
  yBlock?: YBlock
}

const IMAGES = new Set(["gif", "jpeg", "jpg", "png", "webp"])

const text = (value: unknown): value is TextProp => {
  if (!value || typeof value !== "object") return false
  return typeof (value as TextProp).toString === "function"
}

const yblock = (doc: Doc, block: TextModel) => {
  if (!block.id) return
  return (doc.blockCollection.yBlocks as { get?: (id: string) => unknown }).get?.(block.id) as YBlock | undefined
}

const models = (doc: Doc) => doc.getBlocks().map((model) => model as BlockModel & TextModel)

// Concurrent empty-doc initialization can leave a view Doc bound to a superseded Y.Map.
const desynced = (doc: Doc) =>
  models(doc).some((block) => {
    const live = yblock(doc, block)
    if (live && block.yBlock && live !== block.yBlock) return true
    const next = live?.get?.("prop:text") ?? block.yBlock?.get?.("prop:text")
    if (!text(block.text) || !text(next)) return false
    return block.text.toString?.() !== next.toString?.()
  })

const actor = (value: unknown): DocActor | undefined => {
  if (!value || typeof value !== "object") return
  const user = (value as { user?: unknown }).user
  if (!user || typeof user !== "object") return
  const actorID = (user as { actorID?: unknown }).actorID
  const name = (user as { name?: unknown }).name
  if (typeof actorID !== "string" || typeof name !== "string") return
  return { actorID, name }
}

const kind = (file: File) => {
  const type = file.type.split(";", 1)[0]?.trim().toLowerCase()
  if (type) return type
  const idx = file.name.lastIndexOf(".")
  const ext = idx === -1 ? "" : file.name.slice(idx + 1).toLowerCase()
  if (IMAGES.has(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`
  return "application/octet-stream"
}

const image = (file: File) => kind(file).startsWith("image/")

export async function createPage(input: DocMountInput) {
  await ensureEffects()
  const [{ PageEditor }, { DocModeExtension, PageEditorBlockSpecs, PreviewEditorBlockSpecs, ThemeProvider }] =
    await Promise.all([import("@blocksuite/presets"), import("@blocksuite/blocks")])

  const schema = new Schema().register(withLineReferenceSchema(withFileReferenceSchema(AffineSchemas)))
  const page = "page"
  const query = { match: [], mode: "loose" } satisfies Query
  let draft: Doc | undefined
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
      collection.awarenessStore.awareness.setLocalStateField("user", {
        actorID: input.sync.actorID,
        name: input.sync.name,
      })
      collection.awarenessStore.awareness.setLocalStateField("color", input.sync.color)
    }
    if (input.init !== false) {
      draft = await remote(direct, collection, input.sync.docID, page, input.readonly, query)
      draft =
        draft ?? collection.getDoc(page, { readonly: input.readonly, query }) ?? collection.createDoc({ id: page, query })
      if (!draft.loaded) draft.load()
      await load(direct, page, draft.spaceDoc)
      if (!draft.root && !input.readonly) initDoc(draft)
      if (!input.readonly) baseline(draft)
    }
    if (input.init === false) {
      if (input.readonly) {
        draft = await remote(direct, collection, input.sync.docID, page, input.readonly, query)
        if (!draft?.root) throw new Error("doc viewer load failed")
      } else {
        while (!draft) {
          draft = await remote(direct, collection, input.sync.docID, page, input.readonly, query)
          if (draft) break
          await frame()
        }
      }
    }
  } else {
    collection = new DocCollection({ schema })
    collection.meta.initialize()
  }

  let doc = draft ?? collection.getDoc(page, { readonly: input.readonly, query }) ?? collection.createDoc({ id: page, query })
  const dnd = (item: Doc) => {
    if (!input.readonly) item.awarenessStore.setFlag("enable_new_dnd", false)
  }
  if (!doc.loaded) doc.load()
  if (!doc.root && input.init !== false && !input.readonly) initDoc(doc)
  if (!input.readonly) baseline(doc)
  dnd(doc)

  const editor = new PageEditor()
  editor.doc = doc
  editor.specs = [
    ...(input.readonly ? PreviewEditorBlockSpecs : PageEditorBlockSpecs),
    DocModeExtension({
      getEditorMode: () => "page",
      getPrimaryMode: () => "page",
      onPrimaryModeChange: () => ({ dispose() {} }),
      setEditorMode: () => {},
      setPrimaryMode: () => {},
      togglePrimaryMode: () => "page",
    }),
    ...FileReferenceBlockSpec,
    ...LineReferenceBlockSpec,
  ]
  editor.hasViewport = true

  let reload: (() => void) | undefined
  let tick = 0
  let checks = 0

  const applyTheme = () => {
    editor.std.get(ThemeProvider).app$.value = scheme(input.theme())
  }

  const focus = async (ready?: Awaited<ReturnType<typeof inlineReady>>) => {
    ensureEditable(doc)
    const root = editor.querySelector("affine-page-root")
    if (root instanceof HTMLElement) root.focus()
    const next = ready ?? (await inlineReady(editor))
    next.focusEnd()
    await next.waitForUpdate()
  }

  let resize: ResizeObserver | undefined
  let mutate: MutationObserver | undefined
  let unload: (() => void) | undefined
  let cursors: (() => void) | undefined
  let unkeys: (() => void) | undefined
  let offY: (() => void) | undefined
  let draftFrame: number | undefined

  const notifyDraft = () => {
    if (!input.onDraftChange) return
    if (draftFrame) cancelAnimationFrame(draftFrame)
    draftFrame = requestAnimationFrame(() => {
      draftFrame = undefined
      input.onDraftChange?.()
    })
  }

  if (input.sync && !input.readonly) {
    unlink = await link(direct!, collection.doc, doc.spaceDoc)
    const onY = () => notifyDraft()
    doc.spaceDoc.on("update", onY)
    offY = () => doc.spaceDoc.off("update", onY)
  }

  const rebind = () => {
    const current = editor.std?.doc ?? doc
    if (!desynced(current)) return
    const active = document.activeElement
    const restore = active instanceof Element && editor.contains(active)
    current.blockCollection.clearQuery(query, input.readonly)
    const fresh = collection.getDoc(page, { readonly: input.readonly, query })
    if (!fresh) return
    if (!fresh.loaded) fresh.load()
    dnd(fresh)
    doc = fresh
    editor.doc = fresh
    if (fresh !== current) current.dispose()
    editor.requestUpdate()
    const el = editor.parentElement
    if (!(el instanceof HTMLElement)) return
    requestAnimationFrame(() => {
      cursors?.()
      cursors = input.readonly ? undefined : watchCursorLabels(editor, el)
      fit(el)
      if (restore) void focus()
    })
  }

  const probe = (count = 8) => {
    checks = Math.max(checks, count)
    if (tick) return
    const run = () => {
      tick = 0
      if (checks <= 0) return
      checks--
      rebind()
      if (checks > 0) tick = requestAnimationFrame(run)
    }
    tick = requestAnimationFrame(run)
  }

  if (input.sync) {
    const space = doc.spaceDoc
    const update = () => probe()
    space.on("update", update)
    probe(2)
    reload = () => {
      space.off("update", update)
      checks = 0
      if (!tick) return
      cancelAnimationFrame(tick)
      tick = 0
    }
  }

  const clamp = (height: number) => Math.min(650, Math.max(40, Math.ceil(height)))

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
    const height = input.readonly
      ? content(
          host,
          root instanceof HTMLElement ? root : undefined,
          preview instanceof HTMLElement ? preview : undefined,
        )
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
      mutate = input.readonly
        ? undefined
        : new MutationObserver(() => {
            fit(el)
            notifyDraft()
          })
      mutate?.observe(editor, { childList: true, characterData: true, subtree: true })
      unload?.()
      const loaded = () => fit(el)
      editor.addEventListener("load", loaded, true)
      unload = () => editor.removeEventListener("load", loaded, true)
      cursors?.()
      cursors = input.readonly ? undefined : watchCursorLabels(editor, el)
      unkeys?.()
      unkeys = undefined
      const send = input.submit
      if (!input.readonly && send) {
        const onKey = (event: KeyboardEvent) => {
          if (event.key !== "Enter" || event.isComposing) return
          if (event.altKey || event.metaKey || event.ctrlKey) return
          if (!event.shiftKey) return
          event.preventDefault()
          event.stopPropagation()
          if (event.repeat) return
          send()
        }
        editor.addEventListener("keydown", onKey, true)
        unkeys = () => editor.removeEventListener("keydown", onKey, true)
      }
      if (!attached && ready) await focus(ready)
      if (input.sync && awareness && !aware) {
        collection.awarenessSync.connect()
        aware = true
      }
      await frame()
      fit(el)
      notifyDraft()
      if (!input.readonly && document.activeElement === editor.querySelector("affine-page-root")) await focus(ready)
    } finally {
      el.removeAttribute("aria-busy")
    }
  }

  const detach = () => {
    unkeys?.()
    unkeys = undefined
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
      notifyDraft()
      return
    }
    hadText = true
    notifyDraft()
  }

  const onHistory = () => {
    const empty = !docPlain(doc)
    if (hadText && empty && !input.sync) doc.resetHistory()
    hadText = !empty
    ensureEditable(doc)
    notifyDraft()
  }

  const guard = () => {
    ensureEditable(doc)
  }

  const refocus = (target?: Element) => {
    const active = document.activeElement
    if (target?.closest(".inline-editor") && active instanceof Element && editor.contains(active)) return
    void focus()
  }

  const addFile = async (file: File) => {
    if (input.readonly) return false
    ensureEditable(doc)
    const parent = doc.getBlockByFlavour("affine:note")[0]
    if (!parent) return false
    const id = await doc.blobSync.set(file)
    if (image(file)) {
      doc.addBlock("affine:image", { sourceId: id, caption: file.name, size: file.size }, parent.id)
    } else {
      doc.addBlock(
        "affine:attachment",
        { sourceId: id, name: file.name, size: file.size, type: kind(file), embed: false },
        parent.id,
      )
    }
    onHistory()
    requestAnimationFrame(() => void focus())
    return true
  }

  const addReference = (path: string, nodeType: FileNodeType = "file") => {
    if (input.readonly) return false
    ensureEditable(doc)
    const parent = doc.getBlockByFlavour("affine:note")[0]
    if (!parent) return false
    const name = nodeType === "directory" ? path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path : getFilename(path)
    doc.addBlock(
      "opencode:file-reference",
      { name, path, url: path, nodeType },
      parent.id,
    )
    onHistory()
    requestAnimationFrame(() => void focus())
    return true
  }

  const addLineReference = (ref: LineRefInput) => {
    if (input.readonly) return false
    ensureEditable(doc)
    const parent = doc.getBlockByFlavour("affine:note")[0]
    if (!parent) return false
    const norm = normLineRef(ref)
    const path = ref.path
    const comment = ref.comment?.trim() ?? ""
    const preview = ref.preview?.trim() ?? ""
    doc.addBlock(
      "opencode:line-reference",
      {
        name: getFilename(path),
        path,
        url: lineReferenceUrl({ ...ref, ...norm }),
        start: norm.start,
        end: norm.end,
        side: norm.side ?? "",
        endSide: norm.endSide ?? "",
        additionStart: ref.additionStart ?? 0,
        additionEnd: ref.additionEnd ?? 0,
        deletionStart: ref.deletionStart ?? 0,
        deletionEnd: ref.deletionEnd ?? 0,
        label: ref.label?.trim() ?? "",
        preview,
        comment,
      },
      parent.id,
    )
    onHistory()
    requestAnimationFrame(() => void focus())
    return true
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

  const actors = () => {
    const own = input.sync ? [{ actorID: input.sync.actorID, name: input.sync.name }] : []
    const states = Array.from(collection.awarenessStore.awareness.getStates().values())
    return Array.from(
      [...own, ...states.map(actor).filter((item): item is DocActor => !!item)]
        .reduce((map, item) => map.set(item.actorID, item), new Map<string, DocActor>())
        .values(),
    )
  }

  return {
    get doc() {
      return doc
    },
    editor,
    collection,
    attach,
    detach,
    guard,
    refocus,
    addFile,
    addReference,
    addLineReference,
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
    actors,
    setTheme: (theme: "light" | "dark") => {
      editor.std.get(ThemeProvider).app$.value = scheme(theme)
    },
    dispose: async () => {
      reload?.()
      reload = undefined
      if (draftFrame) cancelAnimationFrame(draftFrame)
      draftFrame = undefined
      offY?.()
      offY = undefined
      unkeys?.()
      unkeys = undefined
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
