import { Button } from "@opencode-ai/ui/button"
import { Mark } from "@opencode-ai/ui/logo"
import { getFilename } from "@opencode-ai/util/path"
import { createEffect, createMemo, createSignal, on, onCleanup, Match, Show, Switch } from "solid-js"
import { useFile } from "@/context/file"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import {
  audioExtensions,
  blobUrlFromBase64,
  getExtension,
  htmlExtensions,
  normalizeMimeType,
  pdfExtensions,
} from "./preview-tab-helper"

export function SessionPreviewTab(props: {
  path: () => string | undefined
  file: ReturnType<typeof useFile>
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  language: ReturnType<typeof useLanguage>
}) {
  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined
  const [pdfObjectUrl, setPdfObjectUrl] = createSignal<string | undefined>()

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

  const isPdf = createMemo(() => {
    const path = props.path()
    const value = content()
    if (value?.encoding !== "base64") return false
    const mime = normalizeMimeType(value.mimeType)
    if (mime === "application/pdf") return true
    if (!path) return false
    return pdfExtensions.has(getExtension(path))
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

  const pdfMimeType = createMemo(() => {
    if (!isPdf()) return
    const value = content()
    return normalizeMimeType(value?.mimeType) ?? "application/pdf"
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

  createEffect(() => {
    const value = content()
    const mime = pdfMimeType()

    if (!isPdf() || !value?.content || !mime) {
      setPdfObjectUrl(undefined)
      return
    }

    const url = blobUrlFromBase64(value.content, mime)
    setPdfObjectUrl(url)

    onCleanup(() => {
      if (!url) return
      URL.revokeObjectURL(url)
    })
  })

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

  const downloadPdf = () => {
    const url = pdfObjectUrl()
    if (!url) return

    const link = document.createElement("a")
    link.href = url
    link.download = filename().toLowerCase().endsWith(".pdf") ? filename() : `${filename()}.pdf`
    link.click()
  }

  const openPdf = () => {
    const url = pdfObjectUrl()
    if (!url) return
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <div class="flex flex-col h-full overflow-hidden bg-background-stronger contain-strict">
      <div class="sticky top-0 z-20 h-8 shrink-0 px-6 flex items-center justify-between bg-background-stronger">
        <div class="min-w-0 truncate text-16-medium text-text-strong">{filename()}</div>
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
          <Match when={isPdf()}>
            <div class="h-full px-6 pb-6">
              <div class="flex min-h-96 h-full justify-center">
                <div class="w-full max-w-[960px] flex flex-col gap-4">
                  <Show
                    when={pdfObjectUrl()}
                    fallback={
                      <div class="px-4 py-3 rounded-lg border border-border-weak-base text-text-weak bg-background">
                        {props.language.t("session.preview.deletedUnavailable")}
                      </div>
                    }
                  >
                    {(src) => (
                      <>
                        <iframe
                          src={src()}
                          title={filename()}
                          class="w-full min-h-[70vh] rounded-lg border border-border-weak-base bg-white"
                          onLoad={() => requestAnimationFrame(restoreScroll)}
                        />
                        <div class="flex items-center gap-2">
                          <Button size="small" variant="secondary" onClick={openPdf}>
                            Open PDF
                          </Button>
                          <Button size="small" variant="ghost" onClick={downloadPdf}>
                            Download PDF
                          </Button>
                        </div>
                      </>
                    )}
                  </Show>
                </div>
              </div>
            </div>
          </Match>
          <Match when={state()?.loaded}>{empty(props.language.t("session.preview.unsupported"))}</Match>
          <Match when={true}>{empty(props.language.t("session.preview.empty"))}</Match>
        </Switch>
      </div>
    </div>
  )
}
