import { createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js"
import { arrayBufferFromMediaValue } from "../../pierre/media"

type Status = "loading" | "rendering" | "ready" | "error"

// FORK-BEGIN: 加载 pdfjs-dist/web/pdf_viewer.mjs 拿 TextLayerBuilder
// raw TextLayer(pdfjs-dist build/pdf.mjs)只渲染 spans,不带选区边界机制 →
// 选两行变选一页 + 选区中间字没底色 + pptx 选不到。
// TextLayerBuilder(pdfjs-dist web/pdf_viewer.mjs)装的是完整 pdf.js 官方 viewer 逻辑:
// 注册全局 selectionchange listener,动态把 endOfContent div 插入到 selection anchor 节点旁,
// 作 DOM-order 屏障防止 selection 跨越视觉边界。
// 配套 CSS 已在 pdfjs-dist/web/pdf_viewer.css 内置(`.textLayer .endOfContent` / `.textLayer.selecting`)。
// 详 docs/features/office-选中加聊天/3-changelog.md § R4 override 第 2 笔论证。
// [override-blacklist] [feat: office-选中加聊天] 2026-05-25
type PdfViewerLib = typeof import("pdfjs-dist/web/pdf_viewer.mjs")
let pdfjsLoader:
  | Promise<{
      lib: typeof import("pdfjs-dist")
      viewer: PdfViewerLib
    }>
  | undefined

async function loadPdfjs() {
  if (!pdfjsLoader) {
    pdfjsLoader = (async () => {
      const lib = await import("pdfjs-dist")
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
      lib.GlobalWorkerOptions.workerSrc = workerUrl
      await import("pdfjs-dist/web/pdf_viewer.css")
      const viewer = await import("pdfjs-dist/web/pdf_viewer.mjs")
      return { lib, viewer }
    })()
  }
  return pdfjsLoader
}
// FORK-END

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
  // FORK: TextLayerBuilder 注册全局 selectionchange listener,通过 abortSignal 在 PDF 切换/unmount 时清理
  // [override-blacklist] [feat: office-选中加聊天] 2026-05-25
  let textLayerAbortController: AbortController | undefined

  const [status, setStatus] = createSignal<Status>("loading")
  const [totalPages, setTotalPages] = createSignal(0)

  const cleanup = async () => {
    cancelled = true
    if (observer) {
      observer.disconnect()
      observer = undefined
    }
    pageStates.clear()
    // FORK: abort TextLayerBuilder 全局 listener [override-blacklist] [feat: office-选中加聊天] 2026-05-25
    if (textLayerAbortController) {
      textLayerAbortController.abort()
      textLayerAbortController = undefined
    }
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

  const renderPage = async (
    state: PageState,
    pdfjs: typeof import("pdfjs-dist"),
    viewer: PdfViewerLib,
  ) => {
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

      // FORK-BEGIN: TextLayerBuilder — 替代 raw TextLayer,带完整选区边界(endOfContent 动态重定位 +
      // 全局 selectionchange listener 防止选区跨视觉边界扩展)。修 ① 选两行变选一页 ② 选区中间字没底色
      // ③ pptx 选不到。详 docs/features/office-选中加聊天/3-changelog.md § R4 override 第 2 笔论证。
      // [override-blacklist] [feat: office-选中加聊天] 2026-05-25
      try {
        const TextLayerBuilderCtor = (viewer as any).TextLayerBuilder
        if (TextLayerBuilderCtor) {
          const builder = new TextLayerBuilderCtor({
            pdfPage: page,
            abortSignal: textLayerAbortController?.signal,
            onAppend: (div: HTMLDivElement) => {
              if (!cancelled) state.wrap.appendChild(div)
            },
          })
          await builder.render({ viewport })
        } else {
          // pdfjs-dist 升级移除 TextLayerBuilder 时降级回 raw TextLayer(选区会越界,但不崩)
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
          }
          state.wrap.appendChild(textLayerDiv)
        }
      } catch {
        // text layer not critical — 任一步失败都仅丢失选区能力,canvas 视觉不受影响
      }
      // FORK-END

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
          const { lib: pdfjs, viewer } = await loadPdfjs()
          if (cancelled) return
          // FORK: 新 file load 准备好 fresh abortController 给 TextLayerBuilder cleanup 用
          // [override-blacklist] [feat: office-选中加聊天] 2026-05-25
          textLayerAbortController = new AbortController()

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
            // FORK: 必须设 --total-scale-factor,否则 textLayer span font-size 用 fallback 值,
            // 视觉宽度比 canvas 文字窄 → 选区底色覆盖不到行末("都可审计、可" 等漏字)。
            // pdf.js 官方 PDFPageView 在 setScale 时设这个 var,我们手搓 renderPage 必须手动同步。
            // [override-blacklist] [feat: office-选中加聊天] 2026-05-25
            wrap.style.setProperty("--total-scale-factor", String(scale))
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
                void renderPage(state, pdfjs, viewer)
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
