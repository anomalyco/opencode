import { Button } from "@opencode-ai/ui/button"
import { Mark } from "@opencode-ai/ui/logo"
import { getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, on, onCleanup, Match, Show, Switch } from "solid-js"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"

const htmlExtensions = new Set(["html", "htm"])
const audioExtensions = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"])
const PRINT_MESSAGE = "opencode:preview-print"
const PRINT_DONE_MESSAGE = "opencode:preview-print-done"

function getExtension(path: string) {
  const idx = path.lastIndexOf(".")
  if (idx === -1) return ""
  return path.slice(idx + 1).toLowerCase()
}

function normalizeMimeType(type: string | undefined) {
  if (!type) return

  const mime = type.split(";", 1)[0]?.trim().toLowerCase()
  if (!mime) return
  if (mime === "audio/x-aac") return "audio/aac"
  if (mime === "audio/x-m4a") return "audio/mp4"
  return mime
}

function printable(input: string) {
  const style = `<style>@page{margin:12mm}html,body{background:#fff}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style>`
  const script = `<script>(function(){var done=false;function finish(){if(done)return;done=true;parent.postMessage({type:"${PRINT_DONE_MESSAGE}"},"*")}window.addEventListener("message",function(event){if(event.data?.type!=="${PRINT_MESSAGE}")return;var cleanup=function(){window.removeEventListener("afterprint",cleanup);finish()};window.addEventListener("afterprint",cleanup);window.focus();setTimeout(function(){window.print();setTimeout(finish,1000)},50)})})()</script>`
  if (input.includes("</head>")) return input.replace("</head>", `${style}${script}</head>`)
  if (input.includes("</body>")) return input.replace("</body>", `${script}</body>`)
  return `${style}${script}${input}`
}

export function SessionPreviewTab(props: {
  path: () => string | undefined
  file: ReturnType<typeof useFile>
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  language: ReturnType<typeof useLanguage>
  onOpenCode: (path: string) => void
}) {
  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const state = createMemo(() => {
    const path = props.path()
    if (!path) return
    return props.file.get(path)
  })

  const content = createMemo(() => state()?.content)
  const filename = createMemo(() => {
    const path = props.path()
    return path ? getFilename(path) : props.language.t("session.tab.preview")
  })

  const isHtml = createMemo(() => {
    const path = props.path()
    const mime = normalizeMimeType(content()?.mimeType)
    if (mime === "text/html") return true
    if (!path) return false
    return htmlExtensions.has(getExtension(path))
  })

  const isSvg = createMemo(() => content()?.mimeType === "image/svg+xml")
  const isImage = createMemo(() => {
    const value = content()
    return value?.encoding === "base64" && value?.mimeType?.startsWith("image/") && value?.mimeType !== "image/svg+xml"
  })

  const isAudio = createMemo(() => {
    const path = props.path()
    const value = content()
    if (value?.encoding !== "base64") return false
    const mime = normalizeMimeType(value.mimeType)
    if (mime?.startsWith("audio/")) return true
    if (!path) return false
    return audioExtensions.has(getExtension(path))
  })

  const htmlSrc = createMemo(() => {
    if (!isHtml()) return
    const value = content()
    if (value?.type !== "text") return
    return value.content
  })

  const svgPreviewUrl = createMemo(() => {
    if (!isSvg()) return
    const value = content()
    if (!value) return
    if (value.encoding === "base64") return `data:image/svg+xml;base64,${value.content}`
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value.content)}`
  })

  const imageDataUrl = createMemo(() => {
    if (!isImage()) return
    const value = content()
    const mime = normalizeMimeType(value?.mimeType)
    if (!value?.content || !mime) return
    return `data:${mime};base64,${value.content}`
  })

  const audioDataUrl = createMemo(() => {
    if (!isAudio()) return
    const value = content()
    const mime = normalizeMimeType(value?.mimeType)
    if (!value?.content || !mime) return
    return `data:${mime};base64,${value.content}`
  })

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const pos = props.view().scroll("preview")
    if (!pos) return
    if (el.scrollTop !== pos.y) el.scrollTop = pos.y
    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return
      props.view().setScroll("preview", next)
    })
  }

  createEffect(() => {
    const path = props.path()
    if (!path) return
    void props.file.load(path)
  })

  createEffect(
    on(
      () => [props.path(), state()?.loaded] as const,
      () => requestAnimationFrame(restoreScroll),
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  const empty = (message: string) => (
    <div class="h-full px-6 pb-30 flex flex-col items-center justify-center text-center gap-6">
      <Mark class="w-14 opacity-10" />
      <div class="text-14-regular text-text-weak max-w-56">{message}</div>
    </div>
  )

  const exportPdf = () => {
    const value = htmlSrc()
    if (!value) return

    const iframe = document.createElement("iframe")
    iframe.setAttribute("sandbox", "allow-scripts allow-modals")
    iframe.setAttribute("aria-hidden", "true")
    iframe.style.position = "fixed"
    iframe.style.top = "0"
    iframe.style.left = "-20000px"
    iframe.style.width = "1280px"
    iframe.style.height = "1800px"
    iframe.style.border = "0"
    iframe.style.opacity = "0"
    iframe.srcdoc = printable(value)

    const cleanup = () => {
      window.removeEventListener("message", done)
      iframe.remove()
    }

    const done = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      if (event.data?.type !== PRINT_DONE_MESSAGE) return
      cleanup()
    }

    window.addEventListener("message", done)
    iframe.onload = () => iframe.contentWindow?.postMessage({ type: PRINT_MESSAGE }, "*")
    document.body.append(iframe)
  }

  return (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="sticky top-0 z-20 h-8 shrink-0 px-6 flex items-center justify-between bg-background-stronger">
        <div class="min-w-0 truncate text-16-medium text-text-strong">{filename()}</div>
        <div class="flex items-center gap-1">
          <Show when={htmlSrc()}>
            <Button size="small" variant="ghost" onClick={exportPdf}>
              {props.language.t("session.preview.exportPdf")}
            </Button>
          </Show>
          <Show when={props.path()}>
            {(path) => (
              <Button size="small" variant="ghost" onClick={() => props.onOpenCode(path())}>
                {props.language.t("session.preview.openCode")}
              </Button>
            )}
          </Show>
        </div>
      </div>
      <div
        ref={(el) => {
          scroll = el
          restoreScroll()
        }}
        onScroll={handleScroll}
        class="relative pt-2 flex-1 min-h-0 overflow-auto"
      >
        <Switch>
          <Match when={!props.path()}>{empty(props.language.t("session.preview.empty"))}</Match>
          <Match when={!state() || state()?.loading}>
            <div class="px-6 py-4 text-text-weak">{props.language.t("common.loading")}...</div>
          </Match>
          <Match when={state()?.error}>{empty(props.language.t("session.preview.deletedUnavailable"))}</Match>
          <Match when={htmlSrc()}>
            {(src) => (
              <div class="h-full px-6 pb-6">
                <iframe
                  srcdoc={src()}
                  sandbox="allow-scripts"
                  title={filename()}
                  class="w-full h-full min-h-96 rounded-lg border border-border-weak-base bg-white"
                  onLoad={() => requestAnimationFrame(restoreScroll)}
                />
              </div>
            )}
          </Match>
          <Match when={imageDataUrl()}>
            {(src) => (
              <div class="px-6 pb-6 flex justify-center">
                <img
                  src={src()}
                  alt={filename()}
                  class="max-w-full rounded-lg border border-border-weak-base"
                  onLoad={() => requestAnimationFrame(restoreScroll)}
                />
              </div>
            )}
          </Match>
          <Match when={svgPreviewUrl()}>
            {(src) => (
              <div class="px-6 pb-6 flex justify-center">
                <img
                  src={src()}
                  alt={filename()}
                  class="max-w-full max-h-[70vh] rounded-lg border border-border-weak-base"
                  onLoad={() => requestAnimationFrame(restoreScroll)}
                />
              </div>
            )}
          </Match>
          <Match when={audioDataUrl()}>
            {(src) => (
              <div class="px-6 pb-6 flex justify-center">
                <audio controls src={src()} class="w-full max-w-[560px]" />
              </div>
            )}
          </Match>
          <Match when={state()?.loaded}>{empty(props.language.t("session.preview.unsupported"))}</Match>
          <Match when={true}>{empty(props.language.t("session.preview.empty"))}</Match>
        </Switch>
      </div>
    </div>
  )
}
