import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Markdown } from "./markdown"
import DOMPurify from "dompurify"

interface OoxmlViewer {
  load(source: ArrayBuffer): Promise<void>
  destroy?(): void
}

export type DocumentKind = "pdf" | "docx" | "xlsx" | "pptx" | "markdown" | "fallback"

export interface DocumentPreviewProps {
  filename: string
  kind: DocumentKind
  url: string
  sourceLabel?: string
  actions?: JSX.Element
  children?: JSX.Element
}

export function DocumentPreviewPanel(props: DocumentPreviewProps & { onClose?: () => void }) {
  const i18n = useI18n()
  return (
    <div data-component="document-preview-panel" class="flex h-full w-full flex-col overflow-hidden">
      <div
        data-slot="document-preview-header"
        class="flex flex-shrink-0 items-center justify-between gap-2 border-b border-border-weak-base p-2"
      >
        <div data-slot="document-preview-title" class="flex min-w-0 items-center gap-2">
          <span data-slot="document-preview-filename" class="truncate text-14-semibold text-text-strong">
            {props.filename}
          </span>
          <Show when={props.sourceLabel}>
            <span
              data-slot="document-preview-source"
              class="shrink-0 rounded-full bg-background-weak px-2 py-0.5 text-12-regular text-text-weak"
            >
              {props.sourceLabel}
            </span>
          </Show>
        </div>
        <div data-slot="document-preview-actions" class="flex shrink-0 items-center gap-1">
          <Show when={props.actions}>{props.actions}</Show>
          <Show when={props.onClose}>
            <IconButton
              data-slot="document-preview-close"
              icon="close"
              variant="ghost"
              aria-label={i18n.t("ui.common.close")}
              onClick={props.onClose}
            />
          </Show>
        </div>
      </div>
      <div data-slot="document-preview-body" class="flex min-h-0 flex-1">
        <Show
          when={props.children}
          fallback={<DocumentBody kind={props.kind} url={props.url} filename={props.filename} />}
        >
          {props.children}
        </Show>
      </div>
    </div>
  )
}

export function DocumentPreview(props: DocumentPreviewProps) {
  const dialog = useDialog()
  return (
    <div data-component="document-preview" class="fixed inset-0 z-50 flex items-center justify-center">
      <div
        data-slot="document-preview-container"
        class="relative z-50 flex h-[min(90vh,calc(100vh-32px))] w-[min(90vw,calc(100vw-32px))] max-w-[1200px] flex-col"
      >
        <Kobalte.Content
          data-slot="document-preview-content"
          class="flex h-full w-full flex-col overflow-hidden rounded-lg bg-background-stronger shadow-2xl"
        >
          <DocumentPreviewPanel {...props} onClose={() => dialog.close()} />
        </Kobalte.Content>
      </div>
    </div>
  )
}

export function DocumentBody(props: { kind: DocumentKind; url: string; filename: string }) {
  if (props.kind === "pdf") return <PdfBody url={props.url} />
  if (props.kind === "docx") return <DocxBody url={props.url} filename={props.filename} />
  if (props.kind === "xlsx") return <XlsxBody url={props.url} filename={props.filename} />
  if (props.kind === "pptx") return <PptxBody url={props.url} filename={props.filename} />
  if (props.kind === "markdown") return <MarkdownBody url={props.url} filename={props.filename} />
  return <FallbackBody filename={props.filename} />
}

function PdfBody(props: { url: string }) {
  const i18n = useI18n()
  const [src, setSrc] = createSignal(props.url)
  let blobUrl: string | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
    if (blobUrl) URL.revokeObjectURL(blobUrl)
  })
  onMount(() => {
    if (!props.url.startsWith("data:")) return
    fetch(props.url)
      .then((res) => res.blob())
      .then((blob) => {
        if (disposed) return
        blobUrl = URL.createObjectURL(blob)
        setSrc(blobUrl)
      })
      .catch(() => {
        // ponytail: on fetch failure keep the data: URL; Chromium's iframe can render data: PDFs directly
      })
  })
  return (
    <iframe
      data-slot="document-preview-pdf"
      class="h-full w-full border-0"
      src={src()}
      title={i18n.t("ui.documentPreview.pdfTitle")}
    />
  )
}

function DocxBody(props: { url: string; filename: string }) {
  const [failed, setFailed] = createSignal(false)
  if (failed()) return <FallbackBody filename={props.filename} />
  return <DocxRender url={props.url} onFail={() => setFailed(true)} />
}

function DocxRender(props: { url: string; onFail: () => void }) {
  const [target, setTarget] = createSignal<HTMLDivElement>()
  let viewer: OoxmlViewer | undefined
  onCleanup(() => viewer?.destroy?.())
  onMount(async () => {
    const el = target()
    if (!el) return
    try {
      const buffer = await fetch(props.url).then((res) => res.arrayBuffer())
      const fallbackBuffer = buffer.slice(0)
      // ponytail: offline 100% - @silurus/ooxml is Rust/WASM canvas like Word (measures every line, handles w:tab leader, pagination). Falls back to docx-renderer if WASM fails.
      try {
        const mod = await import("@silurus/ooxml/docx")
        const v: OoxmlViewer = new mod.DocxScrollViewer(el, { enableTextSelection: true })
        await v.load(buffer)
        viewer = v
        return
      } catch (wasmError) {
        console.warn("WASM viewer failed, fallback to docx-renderer", wasmError)
      }
      const { render } = await import("docx-renderer")
      await render(fallbackBuffer, el)
      // docx-renderer interpolates document-derived char codes into innerHTML
      // (e.g. `&#x${char};`); re-sanitize the rendered tree before display.
      el.innerHTML = DOMPurify.sanitize(el.innerHTML)
    } catch (error) {
      console.error("Document preview failed", error)
      props.onFail()
    }
  })
  // ponytail: light gray canvas like Word; WASM draws on canvas, fallback injects .docx-wrapper
  return (
    <div
      data-slot="document-preview-docx"
      class="h-full w-full overflow-auto bg-[#f1f5f9] dark:bg-[#1a1a1a] p-0"
      ref={setTarget}
    />
  )
}

function XlsxBody(props: { url: string; filename: string }) {
  const [failed, setFailed] = createSignal(false)
  if (failed()) return <FallbackBody filename={props.filename} />
  return <XlsxRender url={props.url} onFail={() => setFailed(true)} />
}

// ponytail: shared table builder — column widths from Excel model, merge cells, freeze cols
function buildXlsxTable(ws: any, cellText: (ws: any, cell: any) => string): HTMLTableElement {
  const colPx = (colIdx: number): number => {
    let charW = ws.defaultColWidth ?? 8
    if (ws.colWidths?.[colIdx] != null) charW = ws.colWidths[colIdx]
    else if (ws.colWidthRanges)
      for (const rng of ws.colWidthRanges) {
        if (colIdx >= rng.min && colIdx <= rng.max) {
          charW = rng.width
          break
        }
      }
    return Math.min(charW * 7 + 16, 400)
  }
  const table = document.createElement("table")
  table.className = "min-w-full border-collapse text-12-regular"
  table.style.tableLayout = "fixed"
  table.style.width = "max-content"
  table.style.minWidth = "100%"
  const colCount = (ws.rows[0]?.cells?.length as number) || 0
  if (colCount) {
    const colgroup = document.createElement("colgroup")
    for (let c = 0; c < colCount; c++) {
      const col = document.createElement("col")
      const px = colPx(c)
      col.style.width = `${px}px`
      col.style.minWidth = `${px}px`
      colgroup.appendChild(col)
    }
    table.appendChild(colgroup)
  }
  const mergeMap = new Map<string, { rs: number; cs: number }>()
  const consumedCells = new Set<string>()
  if (ws.mergeCells?.length) {
    for (const mc of ws.mergeCells) {
      const rs = mc.bottom - mc.top + 1
      const cs = mc.right - mc.left + 1
      if (rs > 1 || cs > 1) {
        mergeMap.set(`${mc.top},${mc.left}`, { rs, cs })
        for (let r = mc.top; r <= mc.bottom; r++) {
          for (let c = mc.left; c <= mc.right; c++) {
            if (r !== mc.top || c !== mc.left) consumedCells.add(`${r},${c}`)
          }
        }
      }
    }
  }
  const freezeCols = ws.freezeCols ?? 0
  const headerRow = ws.rows[0]
  if (headerRow) {
    const tr = document.createElement("tr")
    tr.style.backgroundColor = "#5B3F86"
    tr.style.color = "white"
    tr.style.position = "sticky"
    tr.style.top = "0"
    tr.style.zIndex = "2"
    for (const cell of headerRow.cells) {
      if (consumedCells.has(`${cell.row},${cell.col}`)) continue
      const th = document.createElement("th")
      th.textContent = cellText(ws, cell) || ""
      th.style.border = "1px solid #4A2F6B"
      th.style.padding = "8px 10px"
      th.style.wordBreak = "break-word"
      th.style.whiteSpace = "normal"
      th.style.verticalAlign = "middle"
      th.style.fontSize = "12px"
      th.style.fontWeight = "600"
      const mg = mergeMap.get(`${cell.row},${cell.col}`)
      if (mg) {
        th.rowSpan = mg.rs
        th.colSpan = mg.cs
      }
      if (freezeCols && cell.col < freezeCols) {
        th.style.position = "sticky"
        let leftPx = 0
        for (let c = 0; c < cell.col; c++) leftPx += colPx(c)
        th.style.left = `${leftPx}px`
        th.style.zIndex = "3"
        th.style.backgroundColor = "#5B3F86"
      }
      tr.appendChild(th)
    }
    table.appendChild(tr)
  }
  for (let r = 1; r < ws.rows.length; r++) {
    const row = ws.rows[r]
    if (!row) continue
    const tr = document.createElement("tr")
    tr.style.backgroundColor = r % 2 === 0 ? "#F8F9FA" : "white"
    tr.style.color = "#111827"
    for (const cell of row.cells as any[]) {
      if (consumedCells.has(`${cell.row},${cell.col}`)) continue
      const td = document.createElement("td")
      td.textContent = cellText(ws, cell) || ""
      td.style.border = "1px solid #E5E7EB"
      td.style.padding = "6px 8px"
      td.style.wordBreak = "break-word"
      td.style.whiteSpace = "normal"
      td.style.verticalAlign = "top"
      td.style.fontSize = "12px"
      td.style.color = "#111827"
      const mg = mergeMap.get(`${cell.row},${cell.col}`)
      if (mg) {
        td.rowSpan = mg.rs
        td.colSpan = mg.cs
      }
      if (freezeCols && cell.col < freezeCols) {
        td.style.position = "sticky"
        let leftPx = 0
        for (let c = 0; c < cell.col; c++) leftPx += colPx(c)
        td.style.left = `${leftPx}px`
        td.style.zIndex = "1"
        td.style.backgroundColor = "inherit"
      }
      tr.appendChild(td)
    }
    while (tr.children.length < colCount) {
      const td = document.createElement("td")
      td.style.border = "1px solid #E5E7EB"
      tr.appendChild(td)
    }
    table.appendChild(tr)
  }
  return table
}

function XlsxRender(props: { url: string; onFail: () => void }) {
  const [target, setTarget] = createSignal<HTMLDivElement>()
  let viewer: OoxmlViewer | undefined
  onCleanup(() => viewer?.destroy?.())
  onMount(async () => {
    const el = target()
    if (!el) return
    try {
      const buffer = await fetch(props.url).then((res) => res.arrayBuffer())
      // ponytail: offline Excel - try WASM first, fallback to HTML table if text overflows (browser handles wrap/clip better)
      try {
        const mod = await import("@silurus/ooxml/xlsx")
        const wb = await mod.XlsxWorkbook.load(buffer.slice(0))
        const ws = await wb.getWorksheet(0)
        const table = buildXlsxTable(ws, wb.cellText.bind(wb))
        if (table.rows.length > 1) {
          el.innerHTML = ""
          el.style.display = "flex"
          el.style.flexDirection = "column"
          el.style.background = "white"
          el.style.overflow = "hidden"
          el.style.padding = "0"
          el.style.height = "100%"
          const wrap = document.createElement("div")
          wrap.style.flex = "1 1 0%"
          wrap.style.minHeight = "0"
          wrap.style.overflow = "auto"
          wrap.style.background = "white"
          wrap.appendChild(table)
          el.appendChild(wrap)
          const sheetNames: string[] = (wb as any).sheetNames ?? (wb as any).sheets?.map((s: any) => s.name) ?? []
          {
            const tabBar = document.createElement("div")
            tabBar.style.display = "flex"
            tabBar.style.alignItems = "center"
            tabBar.style.height = "28px"
            tabBar.style.flexShrink = "0"
            tabBar.style.background = "rgb(240,240,240)"
            tabBar.style.borderTop = "1px solid rgb(200,204,208)"
            tabBar.style.padding = "0 4px"
            tabBar.style.gap = "2px"
            tabBar.style.fontSize = "12px"
            const renderSheet = async (idx: number) => {
              const nwb = await (mod as any).XlsxWorkbook.load(buffer.slice(0))
              const nws = await nwb.getWorksheet(idx)
              const newTable = buildXlsxTable(nws, nwb.cellText.bind(nwb))
              wrap.innerHTML = ""
              wrap.appendChild(newTable)
              for (let i = 0; i < tabBar.children.length; i++) {
                const btn = tabBar.children[i] as HTMLElement
                if (btn.dataset.sheet !== undefined) {
                  const isActive = Number(btn.dataset.sheet) === idx
                  btn.style.background = isActive ? "white" : "transparent"
                  btn.style.borderBottom = isActive ? "2px solid #5B3F86" : "none"
                  btn.style.fontWeight = isActive ? "600" : "400"
                }
              }
              nwb.destroy?.()
            }
            for (let i = 0; i < Math.max(sheetNames.length, 1); i++) {
              const btn = document.createElement("button")
              btn.textContent = sheetNames[i] || "Sheet1"
              btn.dataset.sheet = String(i)
              btn.style.padding = "4px 12px"
              btn.style.border = "1px solid transparent"
              btn.style.borderBottom = i === 0 ? "2px solid #5B3F86" : "none"
              btn.style.background = i === 0 ? "white" : "transparent"
              btn.style.cursor = "pointer"
              btn.style.whiteSpace = "nowrap"
              btn.style.fontWeight = i === 0 ? "600" : "400"
              btn.style.color = "#111827"
              btn.onclick = () => renderSheet(i)
              tabBar.appendChild(btn)
            }
            const zoom = document.createElement("div")
            zoom.textContent = "100%"
            zoom.style.marginLeft = "auto"
            zoom.style.padding = "0 8px"
            zoom.style.color = "#374151"
            tabBar.appendChild(zoom)
            el.appendChild(tabBar)
          }
          wb.destroy?.()
          return
        }
        wb.destroy?.()
      } catch (e) {
        console.warn("HTML table failed, fallback to WASM", e)
      }
      const mod2 = await import("@silurus/ooxml/xlsx")
      // The canvas XlsxViewer exposes element selection, not text selection.
      const v: OoxmlViewer = new mod2.XlsxViewer(el, { enableElementSelection: true })
      await v.load(buffer)
      viewer = v
    } catch (error) {
      console.error("Document preview failed", error)
      props.onFail()
    }
  })
  return (
    <div
      data-slot="document-preview-xlsx"
      class="h-full w-full overflow-auto bg-white dark:bg-[#1a1a1a] p-0"
      ref={setTarget}
    />
  )
}

function PptxBody(props: { url: string; filename: string }) {
  const [failed, setFailed] = createSignal(false)
  if (failed()) return <FallbackBody filename={props.filename} />
  return <PptxRender url={props.url} onFail={() => setFailed(true)} />
}

function PptxRender(props: { url: string; onFail: () => void }) {
  const [target, setTarget] = createSignal<HTMLDivElement>()
  let viewer: OoxmlViewer | undefined
  onCleanup(() => viewer?.destroy?.())
  onMount(async () => {
    const el = target()
    if (!el) return
    try {
      const buffer = await fetch(props.url).then((res) => res.arrayBuffer())
      // ponytail: offline 100% - PowerPoint WASM, PptxScrollViewer for container (virtualized slides). PptxViewer is canvas-only.
      const mod = await import("@silurus/ooxml/pptx")
      const Viewer = mod.PptxScrollViewer ?? mod.PptxViewer
      const v: OoxmlViewer = new Viewer(el, { enableTextSelection: true })
      await v.load(buffer)
      viewer = v
    } catch (error) {
      console.error("Document preview failed", error)
      props.onFail()
    }
  })
  return (
    <div
      data-slot="document-preview-pptx"
      class="h-full w-full overflow-hidden bg-[#f1f5f9] dark:bg-[#1a1a1a] p-0"
      ref={setTarget}
    />
  )
}

function MarkdownBody(props: { url: string; filename: string }) {
  const [text, setText] = createSignal("")
  const [failed, setFailed] = createSignal(false)
  onMount(() => {
    fetch(props.url)
      .then((res) => res.text())
      .then(setText)
      .catch((error) => {
        console.error("Document preview failed", error)
        setFailed(true)
      })
  })
  if (failed()) return <FallbackBody filename={props.filename} />
  return (
    <Show when={text()}>
      <Markdown text={text()} data-slot="document-preview-markdown" class="h-full w-full overflow-auto p-4" />
    </Show>
  )
}

function FallbackBody(props: { filename: string }) {
  const i18n = useI18n()
  return (
    <div
      data-slot="document-preview-fallback"
      class="flex h-full flex-1 flex-col items-center justify-center gap-3 text-center"
    >
      <FileIcon node={{ path: props.filename, type: "file" }} class="h-12 w-12 text-text-weak" />
      <p class="text-14-regular text-text-weak">{i18n.t("ui.documentPreview.fallback")}</p>
    </div>
  )
}
