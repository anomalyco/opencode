import { abort } from "@opencode/util/abort"
import { isLineRangeHash, parsePathLineSuffix } from "@opencode/util/path"
import type { MarkdownMediaSource, ReadMarkdownImage, ReadMarkdownMedia } from "../context/markdown"
import {
  INITIAL_MARKDOWN_IMAGES_STATE,
  selectMarkdownImageUrl,
  transitionMarkdownImages,
  type MarkdownImagesEffect,
  type MarkdownImagesEvent,
} from "./markdown-image-machine"

export function localMediaPath(source: string) {
  // Marked percent-encodes image sources, so `C:\tmp\chart.png` arrives as `C:%5Ctmp%5Cchart.png`.
  const value = source.trim().replace(/\\|%5c/gi, "/")

  if (!value || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith("//")) return

  if (/^file:/i.test(value)) {
    if (!URL.canParse(value)) return
    const url = new URL(value)

    if (url.hostname && url.hostname !== "localhost") return

    return decodePath(url.pathname.replace(/^\/([a-z]:\/)/i, "$1"))
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:\//i.test(value)) return

  return decodePath(value)
}

/**
 * A link is local when it names a file on disk instead of a web resource. Fragment-only and
 * query-only hrefs stay in-page; mailto and other schemes stay external. Line-range fragments
 * such as `#L42` and `#L42-L58` stay attached so the file viewer can select the target lines.
 */
export function localLinkPath(href: string) {
  const value = href.trim()

  if (!value || value.startsWith("#") || value.startsWith("?")) return

  const hashIndex = value.indexOf("#")
  const hash = hashIndex === -1 ? "" : value.slice(hashIndex)
  const target = (value.split(/[?#]/, 1)[0] ?? "").replace(/\\|%5c/gi, "/")
  // `app.tsx:42` is a file and line, not a URL scheme. The `.` or `/` keeps `tel:5551234` external.
  const cited = parsePathLineSuffix(target)
  const line = cited.path !== target && /[./]/.test(cited.path) ? cited : undefined
  const base = localMediaPath(line?.path ?? target)

  if (!base) return

  if (line?.selection) {
    const range = line.selection.end === line.selection.start ? "" : `-L${line.selection.end}`

    return `${base}#L${line.selection.start}${range}`
  }

  return `${base}${isLineRangeHash(hash) ? hash : ""}`
}

function decodePath(value: string) {
  try {
    const path = decodeURIComponent(value)

    if (/[\u0000-\u001f\u007f]/.test(path) || path.startsWith("//") || path.startsWith("\\\\")) return

    return path
  } catch {
    return
  }
}

export function createMarkdownImages(read: ReadMarkdownImage) {
  return createInlineMedia({
    elements: (container) => Array.from(container.querySelectorAll<HTMLImageElement>("img[data-local-image]")),
    path: (element) => element.dataset.localImage ?? "",
    async read(path, signal) {
      const blob = await read(path, signal)

      if (!blob) return

      // SVG documents must not inherit the app origin if opened outside the image element.
      if (blob.type === "image/svg+xml")
        return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await blob.text())}`, revoke: false }

      return { url: URL.createObjectURL(blob), revoke: true }
    },
  })
}

export function createMarkdownMedia(read: ReadMarkdownMedia) {
  return createInlineMedia({
    elements: (container) =>
      Array.from(
        container.querySelectorAll<HTMLVideoElement | HTMLAudioElement | HTMLSourceElement>("[data-local-media]"),
      ),
    path: (element) => element.dataset.localMedia ?? "",
    read,
    // A downloaded video can be far larger than an image, so its fallback read is allowed to finish.
    readTimeoutMs: 5 * 60_000,
    applied(element) {
      // A source added after its media element was inserted needs its parent to select it again.
      if (!(element instanceof HTMLSourceElement)) return
      const parent = element.parentElement

      if (parent instanceof HTMLMediaElement) parent.load()
    },
  })
}

type InlineMediaElement = HTMLImageElement | HTMLVideoElement | HTMLAudioElement | HTMLSourceElement

function createInlineMedia(options: {
  elements(container: HTMLElement): InlineMediaElement[]
  path(element: InlineMediaElement): string
  read(path: string, signal: AbortSignal): Promise<MarkdownMediaSource | undefined>
  readTimeoutMs?: number
  applied?(element: InlineMediaElement): void
}) {
  let state = INITIAL_MARKDOWN_IMAGES_STATE
  let root: HTMLElement | undefined
  const pending = new Map<number, { controller?: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const syncDom = (container: HTMLElement) =>
    options.elements(container).forEach((element) => {
      const url = selectMarkdownImageUrl(state, options.path(element))

      if (!url || element.getAttribute("src") === url) return
      element.src = url
      options.applied?.(element)
    })

  const dispatch = (event: MarkdownImagesEvent) => {
    const next = transitionMarkdownImages(state, event, options.readTimeoutMs)
    const changed = next.state !== state
    state = next.state

    if (changed && root) syncDom(root)
    next.effects.forEach(run)
  }

  const run = (effect: MarkdownImagesEffect) => {
    if (effect.type === "revoke-url") return URL.revokeObjectURL(effect.url)

    if (effect.type === "cancel") {
      const item = pending.get(effect.attempt)
      pending.delete(effect.attempt)

      if (!item) return
      clearTimeout(item.timer)
      abort(item.controller)

      return
    }

    if (effect.type === "wait") {
      const retry = { type: "retry.due", path: effect.path, attempt: effect.attempt } as const
      pending.set(effect.attempt, { timer: setTimeout(() => dispatch(retry), effect.delayMs) })

      return
    }

    const controller = new AbortController()
    const result = { path: effect.path, attempt: effect.attempt }
    const timer = setTimeout(() => dispatch({ type: "read.timed-out", ...result }), effect.timeoutMs)
    pending.set(effect.attempt, { controller, timer })
    void options
      .read(effect.path, controller.signal)
      .then((source) => {
        if (controller.signal.aborted) return

        if (!source) return dispatch({ type: "read.empty", ...result })
        dispatch({ type: "read.succeeded", ...result, url: source.url, revoke: source.revoke })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        dispatch({ type: "read.failed", ...result })
      })
  }

  return {
    update(container: HTMLElement) {
      root = container
      const paths = new Set(options.elements(container).flatMap((element) => options.path(element) || []))
      dispatch({ type: "paths.synced", paths })
      // Newly inserted media of an already loaded path gets its `src` before paint.
      syncDom(container)
    },
    dispose() {
      root = undefined
      dispatch({ type: "disposed" })
    },
  }
}
