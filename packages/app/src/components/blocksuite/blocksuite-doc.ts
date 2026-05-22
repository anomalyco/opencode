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
  locale?: () => string
  sync?: DocSyncOpts
  init?: boolean
  readonly?: boolean
  submit?: () => void
}

type SlashCtx = {
  rootComponent: unknown
  model: unknown
}

type SlashItem = SlashGroup | SlashAction | SlashSub | SlashGen
type SlashStatic = SlashGroup | SlashAction | SlashSub
type SlashGen = (ctx: SlashCtx) => SlashStatic[]
type SlashGroup = {
  groupName: string
  showWhen?: (ctx: SlashCtx) => boolean
}
type SlashAction = {
  name: string
  description?: string
  icon?: unknown
  tooltip?: unknown
  alias?: string[]
  showWhen?: (ctx: SlashCtx) => boolean
  action: (ctx: SlashCtx) => void | Promise<void>
  customTemplate?: unknown
}
type SlashSub = {
  name: string
  description?: string
  icon?: unknown
  alias?: string[]
  showWhen?: (ctx: SlashCtx) => boolean
  subMenu: SlashStatic[]
}
type SlashConfig = {
  triggerKeys: string[]
  ignoreBlockTypes: string[]
  items: SlashItem[]
  maxHeight: number
  tooltipTimeout: number
}
type SlashWidget = HTMLElement & {
  config: SlashConfig
  __opencode?: SlashConfig
}
type Para = { type: string }
type Svc = {
  placeholderGenerator: (model: Para) => string
  __opencode?: (model: Para) => string
}
type Host = HTMLElement & {
  std: {
    getService: (flavour: string) => unknown
  }
}
type Block = HTMLElement & {
  requestUpdate?: () => unknown
}

const ko: Record<string, string> = {
  "Type '/' for commands": "명령어를 보려면 '/'를 입력하세요",
  Basic: "기본",
  Text: "텍스트",
  "Start typing with plain text.": "일반 텍스트로 입력합니다.",
  "Heading 1": "제목 1",
  "Headings in the largest font.": "가장 큰 제목입니다.",
  "Heading 2": "제목 2",
  "Headings in the 2nd font size.": "두 번째 크기의 제목입니다.",
  "Heading 3": "제목 3",
  "Headings in the 3rd font size.": "세 번째 크기의 제목입니다.",
  "Heading 4": "제목 4",
  "Headings in the 4th font size.": "네 번째 크기의 제목입니다.",
  "Heading 5": "제목 5",
  "Headings in the 5th font size.": "다섯 번째 크기의 제목입니다.",
  "Heading 6": "제목 6",
  "Headings in the 6th font size.": "여섯 번째 크기의 제목입니다.",
  "Other Headings": "다른 제목",
  Headings: "제목",
  "Inline equation": "인라인 수식",
  "Create a equation block.": "수식 블록을 만듭니다.",
  List: "목록",
  "Bulleted List": "글머리 목록",
  "Create a bulleted list.": "글머리 기호 목록을 만듭니다.",
  "Numbered List": "번호 목록",
  "Create a numbered list.": "번호가 매겨진 목록을 만듭니다.",
  "To-do List": "할 일 목록",
  "Add tasks to a to-do list.": "할 일 목록에 작업을 추가합니다.",
  Style: "스타일",
  Bold: "굵게",
  Italic: "기울임",
  Underline: "밑줄",
  Strikethrough: "취소선",
  Page: "페이지",
  "New Doc": "새 문서",
  "Start a new document.": "새 문서를 시작합니다.",
  "Linked Doc": "문서 링크",
  "Link to another document.": "다른 문서로 연결합니다.",
  "Content & Media": "콘텐츠 및 미디어",
  Image: "이미지",
  "Insert an image.": "이미지를 삽입합니다.",
  Link: "링크",
  "Add a bookmark for reference.": "참조용 북마크를 추가합니다.",
  Attachment: "첨부 파일",
  "Attach a file to document.": "문서에 파일을 첨부합니다.",
  YouTube: "YouTube",
  "Embed a YouTube video.": "YouTube 동영상을 임베드합니다.",
  GitHub: "GitHub",
  "Link to a GitHub repository.": "GitHub 저장소로 연결합니다.",
  Figma: "Figma",
  "Embed a Figma document.": "Figma 문서를 임베드합니다.",
  Loom: "Loom",
  Equation: "수식",
  "Frame: ": "프레임: ",
  "Group: ": "그룹: ",
  "Document Group & Frame": "문서 그룹 및 프레임",
  Date: "날짜",
  Today: "오늘",
  Tomorrow: "내일",
  Yesterday: "어제",
  Now: "지금",
  Database: "데이터베이스",
  "Table View": "테이블 보기",
  "Display items in a table format.": "항목을 테이블 형식으로 표시합니다.",
  Todo: "할 일",
  "Kanban View": "칸반 보기",
  "Visualize data in a dashboard.": "데이터를 대시보드로 시각화합니다.",
  Actions: "동작",
  "Move Up": "위로 이동",
  "Shift this line up.": "이 줄을 위로 이동합니다.",
  "Move Down": "아래로 이동",
  "Shift this line down.": "이 줄을 아래로 이동합니다.",
  Copy: "복사",
  "Copy this line to clipboard.": "이 줄을 클립보드에 복사합니다.",
  Duplicate: "복제",
  "Create a duplicate of this line.": "이 줄의 복사본을 만듭니다.",
  Delete: "삭제",
  "Remove this line permanently.": "이 줄을 영구적으로 삭제합니다.",
  "Code Block": "코드 블록",
  "Code snippet with formatting.": "서식이 있는 코드 조각입니다.",
  Quote: "인용",
  "Add a blockquote for emphasis.": "강조를 위한 인용 블록을 추가합니다.",
  Divider: "구분선",
  "Visually separate content.": "콘텐츠를 시각적으로 구분합니다.",
}

const tr = (locale: string | undefined, text: string | undefined) => {
  if (!text) return text
  if (locale !== "ko") return text
  return ko[text] ?? text
}

const service = (value: unknown): value is Svc => {
  if (!value || typeof value !== "object") return false
  return typeof (value as { placeholderGenerator?: unknown }).placeholderGenerator === "function"
}

const hint = (editor: Host, locale: string | undefined) => {
  const svc = editor.std.getService("affine:paragraph")
  if (!service(svc)) return
  const base = svc.__opencode ?? svc.placeholderGenerator
  svc.__opencode = base
  svc.placeholderGenerator = locale === "ko" ? (model) => tr(locale, base(model)) ?? "" : base
  editor.querySelectorAll("affine-paragraph").forEach((node) => {
    if ("requestUpdate" in node) (node as Block).requestUpdate?.()
  })
}

const localize = (locale: string | undefined, entry: SlashStatic): SlashStatic => {
  if ("groupName" in entry) return { ...entry, groupName: tr(locale, entry.groupName) ?? entry.groupName }
  if ("subMenu" in entry) {
    return {
      ...entry,
      name: tr(locale, entry.name) ?? entry.name,
      description: tr(locale, entry.description),
      subMenu: entry.subMenu.map((child) => localize(locale, child)),
    }
  }
  return {
    ...entry,
    name: tr(locale, entry.name) ?? entry.name,
    description: tr(locale, entry.description),
  }
}

const slash = (editor: HTMLElement, locale: string | undefined) => {
  const widget = editor.querySelector("affine-slash-menu-widget") as SlashWidget | null
  if (!widget) return
  widget.__opencode ??= widget.config
  widget.config = {
    ...widget.__opencode,
    items: widget.__opencode.items.map((entry) => {
      if (typeof entry !== "function") return localize(locale, entry)
      return (ctx: SlashCtx) => entry(ctx).map((child) => localize(locale, child))
    }),
  }
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
    el.setAttribute("aria-busy", "true")
    if (!attached) el.replaceChildren(editor)
    try {
      await settled(editor.updateComplete)
      await settled(editor.host?.updateComplete)
      const ready = input.readonly ? undefined : await inlineReady(editor)
      applyTheme()
      slash(editor, input.locale?.())
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
      hint(editor, input.locale?.())
      if (input.sync && awareness && !aware) {
        collection.awarenessSync.connect()
        aware = true
      }
      await frame()
      fit(el)
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

  const refocus = (target?: Element) => {
    const active = document.activeElement
    if (target?.closest(".inline-editor") && active instanceof Element && editor.contains(active)) return
    void focus()
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
    refocus,
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
