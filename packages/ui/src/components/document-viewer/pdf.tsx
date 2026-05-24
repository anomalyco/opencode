import { createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { arrayBufferFromMediaValue } from "../../pierre/media"

// FORK-BEGIN: textLayer 选区边界机制(endOfContent + .selecting class)
// pdfjs-dist 5.6.205 不导出 TextLayerBuilder,raw TextLayer class 不带这层处理。
// 不修就会 ① 选两行变选一页(浏览器沿 DOM order 扩展,跨整页 spans) ② 选区中间字"没底色"
// (DOM 顺序 ≠ 视觉顺序,部分 span 在 range 外)。
// 配套 CSS 在 pdfjs-dist/web/pdf_viewer.css `.textLayer .endOfContent` + `.textLayer.selecting`。
// 详 docs/features/office-选中加聊天/3-changelog.md § R4 override 论证。
// [override-blacklist] [feat: office-选中加聊天] 2026-05-25
let pdfTextSelectionMouseupHandlerInstalled = false
function ensurePdfTextSelectionMouseupHandler() {
  if (pdfTextSelectionMouseupHandlerInstalled) return
  if (typeof document === "undefined") return
  pdfTextSelectionMouseupHandlerInstalled = true
  document.addEventListener("mouseup", () => {
    document.querySelectorAll(".textLayer.selecting").forEach((el) => el.classList.remove("selecting"))
  })
}
// FORK-END

type Status = "loading" | "rendering" | "ready" | "error"

let pdfjsLoader:
  | Promise<{
      lib: typeof import("pdfjs-dist")
    }>
  | undefined

async function loadPdfjs() {
  if (!pdfjsLoader) {
    pdfjsLoader = (async () => {
      const lib = await import("pdfjs-dist")
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      await import("pdfjs-dist/web/pdf_viewer.css")
      return { lib }
    })()
  }
  return pdfjsLoader
}

type PageState = {
  index: number
  wrap: HTMLDivElement
  rendered: boolean
  rendering: boolean
  // pdf.js page proxy is opaque; keep loose typing
  page?: any
  viewport?: any
}

const MAX_RENDER_SCALE = 1.5
const MIN_RENDER_SCALE = 0.6

function resolveScale(containerWidthPx: number, naturalWidthPx: number): number {
  // Container has px-6 (24px each side = 48px), and we want a small extra gap
  // so the canvas never bumps against the scrollbar (~17px on Windows).
  const target = Math.max(0, containerWidthPx - 72)
  if (naturalWidthPx <= 0) return MAX_RENDER_SCALE
  const fit = target / naturalWidthPx
  return Math.max(MIN_RENDER_SCALE, Math.min(MAX_RENDER_SCALE, fit))
}

export function PdfViewer(props: {
  value: unknown
  loadBinary?: () => Promise<Uint8Array | undefined>
  onLoad?: () => void
  onError?: () => void
  fallback: () => JSX.Element
}): JSX.Element {
  let containerRef!: HTMLDivElement
  let cancelled = false
  let activeDoc: { destroy: () => Promise<unknown> } | undefined
  let observer: IntersectionObserver | undefined
  const pageStates = new Map<HTMLDivElement, PageState>()

  const [status, setStatus] = createSignal<Status>("loading")
  const [totalPages, setTotalPages] = createSignal(0)

  const cleanup = async () => {
    cancelled = true
    if (observer) {
      observer.disconnect()
      observer = undefined
    }
    pageStates.clear()
    if (activeDoc) {
      try {
        await activeDoc.destroy()
      } catch {}
      activeDoc = undefined
    }
    if (containerRef) containerRef.replaceChildren()
  }

  onCleanup(() => {
    void cleanup()
  })

  const renderPage = async (state: PageState, pdfjs: typeof import("pdfjs-dist")) => {
    if (state.rendered || state.rendering || cancelled) return
    state.rendering = true
    try {
      const page = state.page
      const viewport = state.viewport
      if (!page || !viewport) return

      const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio ?? 1, 2) : 1

      const canvas = document.createElement("canvas")
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      canvas.style.display = "block"

      const ctx = canvas.getContext("2d")
      if (!ctx) return

      const transform: [number, number, number, number, number, number] | undefined =
        dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]

      await page.render({
        canvasContext: ctx,
        viewport,
        transform,
      } as any).promise
      if (cancelled) return

      // remove placeholder text, then attach canvas + text layer
      state.wrap.replaceChildren()
      state.wrap.appendChild(canvas)

      try {
        const textContent = await page.getTextContent()
        if (cancelled) return
        const textLayerDiv = document.createElement("div")
        textLayerDiv.className = "textLayer"
        textLayerDiv.style.position = "absolute"
        textLayerDiv.style.inset = "0"

        const TextLayerCtor = (pdfjs as any).TextLayer
        if (TextLayerCtor) {
          const textLayer = new TextLayerCtor({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport,
          })
          await textLayer.render()
          // FORK-BEGIN: 选区边界 — 加 .endOfContent 哨兵 + .selecting class 切换
          // 详模块顶部 ensurePdfTextSelectionMouseupHandler 注释。
          // [override-blacklist] [feat: office-选中加聊天] 2026-05-25
          const endOfContent = document.createElement("div")
          endOfContent.className = "endOfContent"
          textLayerDiv.appendChild(endOfContent)
          textLayerDiv.addEventListener("mousedown", (e) => {
            if ((e as MouseEvent).button !== 0) return
            textLayerDiv.classList.add("selecting")
          })
          ensurePdfTextSelectionMouseupHandler()
          // FORK-END
        }
        state.wrap.appendChild(textLayerDiv)
      } catch {
        // text layer not critical
      }

      state.rendered = true
    } catch {
      // ignore single-page render failure
    } finally {
      state.rendering = false
    }
  }

  createEffect(
    on(
      () => props.value,
      async (value) => {
        await cleanup()
        cancelled = false
        setStatus("loading")
        setTotalPages(0)

        let bytes = arrayBufferFromMediaValue(value)
        if ((!bytes || bytes.length === 0) && props.loadBinary) {
          try {
            bytes = await props.loadBinary()
          } catch {
            bytes = undefined
          }
          if (cancelled) return
        }
        if (!bytes || bytes.length === 0) {
          setStatus("error")
          props.onError?.()
          return
        }

        try {
          const { lib: pdfjs } = await loadPdfjs()
          if (cancelled) return

          // pdfjs transfers (detaches) the input buffer; always pass a fresh
          // copy so cached buffers (LRU in app layer) stay reusable across
          // tab switches.
          const task = pdfjs.getDocument({ data: bytes.slice() })
          const doc = await task.promise
          if (cancelled) {
            await doc.destroy()
            return
          }
          activeDoc = doc as unknown as { destroy: () => Promise<unknown> }

          setStatus("rendering")
          setTotalPages(doc.numPages)

          // Probe page 1 to derive a fit scale based on container width.
          const firstPage = await doc.getPage(1)
          if (cancelled) return
          const naturalViewport = firstPage.getViewport({ scale: 1 })
          const containerWidth = containerRef.clientWidth || 800
          const scale = resolveScale(containerWidth, naturalViewport.width)

          // Build all page placeholders first (cheap), defer actual rendering
          // to IntersectionObserver to keep memory bounded for large decks.
          for (let i = 1; i <= doc.numPages; i++) {
            if (cancelled) break
            const page = i === 1 ? firstPage : await doc.getPage(i)
            if (cancelled) break
            const viewport = page.getViewport({ scale })

            const wrap = document.createElement("div")
            wrap.className = "pdf-page-wrapper"
            wrap.style.position = "relative"
            wrap.style.width = `${viewport.width}px`
            wrap.style.height = `${viewport.height}px`
            wrap.style.margin = "0 auto 12px"
            wrap.style.boxShadow = "0 1px 4px rgba(0,0,0,0.08)"
            wrap.style.background = "#fff"
            wrap.style.display = "flex"
            wrap.style.alignItems = "center"
            wrap.style.justifyContent = "center"
            wrap.style.color = "#9ca3af"
            wrap.style.fontSize = "13px"
            wrap.textContent = `第 ${i} 页`

            const state: PageState = {
              index: i,
              wrap,
              rendered: false,
              rendering: false,
              page,
              viewport,
            }
            pageStates.set(wrap, state)
            containerRef.appendChild(wrap)
          }

          if (cancelled) return

          observer = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue
                const state = pageStates.get(entry.target as HTMLDivElement)
                if (!state || state.rendered || state.rendering) continue
                void renderPage(state, pdfjs)
              }
            },
            {
              root: containerRef,
              // Pre-render pages within ~one viewport before they enter view to
              // smooth out fast scrolling.
              rootMargin: "800px 0px 800px 0px",
              threshold: 0.01,
            },
          )

          for (const [wrap] of pageStates) observer.observe(wrap)

          setStatus("ready")
          props.onLoad?.()
        } catch {
          if (!cancelled) {
            setStatus("error")
            props.onError?.()
          }
        }
      },
    ),
  )

  return (
    <div style={{ position: "relative", "min-height": "240px" }}>
      <Show when={status() === "loading"}>
        <div
          style={{
            display: "flex",
            "flex-direction": "column",
            "align-items": "center",
            "justify-content": "center",
            "min-height": "60vh",
            gap: "8px",
            "padding-top": "12vh",
            "text-align": "center",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              "border-radius": "50%",
              border: "3px solid #e5e7eb",
              "border-top-color": "#2563eb",
              animation: "oc-spin 0.9s linear infinite",
              "margin-bottom": "4px",
            }}
          />
          <div class="text-14-semibold text-text-strong">正在加载预览…</div>
          <div
            class="text-13-regular text-text-weak"
            style={{ "max-width": "420px" }}
          >
            大文件首次打开需要传输与解析（PPT/PDF 几百 MB 时约 5-15 秒）
          </div>
          <style>{`@keyframes oc-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </Show>
      <Show when={status() === "error"}>
        <div class="flex min-h-40 items-center justify-center px-6 py-4 text-center text-text-weak">
          无法预览此文件
        </div>
      </Show>
      <div
        ref={containerRef}
        class="overflow-auto bg-background-stronger px-6 py-4"
        style={{
          "max-height": "80vh",
          display: status() === "rendering" || status() === "ready" ? "block" : "none",
        }}
      />
      <Show when={status() === "rendering" || status() === "ready"}>
        <div
          style={{
            position: "absolute",
            right: "16px",
            top: "16px",
            background: "rgba(255,255,255,0.92)",
            border: "1px solid #e5e7eb",
            "border-radius": "6px",
            padding: "4px 10px",
            "font-size": "12px",
            color: "#6b7280",
            "pointer-events": "none",
          }}
        >
          共 {totalPages()} 页
        </div>
      </Show>
    </div>
  )
}
