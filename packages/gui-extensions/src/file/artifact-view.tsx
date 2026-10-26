import {
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  untrack,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Dynamic } from "solid-js/web"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { FileIcon } from "@opencode/ui/file-icon"
import { ImagePreview } from "@opencode/ui/image-preview"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Loader } from "@opencode/ui/loader"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { artifactKind, type ArtifactKind } from "@opencode/util/artifact"
import { getDirectory, getFilename } from "@opencode/util/path"
import { createKeyed, useExtension, type FileContent, type MountedSession } from "../sdk"
import { blobUrlFromContent, bytesFromContent, contentBytes, parseDelimited, resolveArtifactPath } from "./artifact"
import { current, useShared } from "./context"
import { FileViewer } from "./contract"
import { workspaceFileUrl } from "./path"

type ArtifactMode = "preview" | "source"

/** Facts a viewer learns from the decoded media, shown in the toolbar. */
type ArtifactInfo = {
  width?: number
  height?: number
  duration?: number
  rows?: number
  columns?: number
  /** Facts an extension's viewer reports, already localized. */
  details?: readonly string[]
}

type ViewerState = {
  readonly mode: ArtifactMode
  readonly info: ArtifactInfo
  readonly undecodable: boolean
  /** Why the file shows as binary, when a viewer said. */
  readonly reason?: string
}

type MediaProps = {
  path: string
  content: FileContent
  onInfo: (info: ArtifactInfo) => void
  /** The browser could not decode the bytes; the host falls back to the binary placeholder. */
  onError: () => void
}

/** Kinds that render a preview from their text and can toggle back to highlighted source. */
const previewableKinds: readonly ArtifactKind[] = ["svg", "html", "markdown", "mermaid", "table"]

/**
 * Renders a loaded non-text file: media, documents, and data get a dedicated viewer with a toolbar;
 * previewable text kinds can switch to `source`, which the host supplies (its code view).
 */
export default function ArtifactView(props: {
  session: MountedSession
  path: string
  content: FileContent
  cacheKey?: string
  source: JSX.Element
}) {
  const ctx = useExtension()
  const locale = ctx.locale
  // Media the browser could not decode falls back to the binary placeholder.
  const initial: ViewerState = { mode: "preview", info: {}, undecodable: false }
  // The viewer state belongs to one loaded content: a reloaded file starts from the preview again.
  const [saved, setSaved] = createSignal({ ...initial, content: props.content })

  const state = () => {
    const value = saved()

    return value.content === props.content ? value : initial
  }

  const change = (next: Partial<ViewerState>) => setSaved({ ...state(), ...next, content: props.content })

  const kind = createMemo<ArtifactKind | "binary">(() => {
    if (props.content.type === "binary" && !props.content.mimeType) return "binary"

    if (state().undecodable) return "binary"

    return artifactKind(props.path)
  })

  const previewable = createMemo(() => {
    const value = kind()

    return value !== "binary" && previewableKinds.includes(value)
  })

  const table = createMemo(() =>
    kind() === "table"
      ? parseDelimited(props.content.content, props.path.toLowerCase().endsWith(".tsv") ? "\t" : ",")
      : undefined,
  )

  const meta = createMemo(() => {
    const parsed = table()
    const info: ArtifactInfo = parsed ? { rows: parsed.total, columns: parsed.columns } : state().info

    return [
      info.width && info.height ? `${info.width} × ${info.height}` : undefined,
      info.duration ? formatDuration(info.duration) : undefined,
      info.rows !== undefined ? ctx.plural("view.table.rows", Math.max(0, info.rows - 1)) : undefined,
      info.columns !== undefined ? ctx.plural("view.table.columns", info.columns) : undefined,
      ...(info.details ?? []),
      formatBytes(locale.locale(), contentBytes(props.content)),
    ].filter((item): item is string => !!item)
  })

  // A file that fails also drops the facts its viewer reported, such as a page count.
  const fail = (reason?: string) => change({ undecodable: true, info: {}, reason })

  const media = { onInfo: (info: ArtifactInfo) => change({ info }), onError: () => fail(ctx.t("view.loadFailed")) }

  const size = () => formatBytes(locale.locale(), contentBytes(props.content))

  // A kind the file view does not render itself goes to the first extension viewer that lists it.
  const viewer = createMemo(() => {
    const value = kind()

    return value === "binary" ? undefined : ctx.list(FileViewer).find((item) => item.kinds.includes(value))
  })

  const rendered = () => (
    <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
      <Show
        when={kind() === "markdown"}
        fallback={<ArtifactMermaid text={props.content.content} cacheKey={props.cacheKey} />}
      >
        <ArtifactMarkdown
          session={props.session}
          path={props.path}
          text={props.content.content}
          cacheKey={props.cacheKey}
        />
      </Show>
    </div>
  )

  return (
    <>
      <ArtifactToolbar
        mode={state().mode}
        onModeChange={previewable() ? (mode) => change({ mode }) : undefined}
        meta={meta()}
        actions={
          <Show when={kind() === "html"}>
            <OpenInBrowserButton session={props.session} path={props.path} />
          </Show>
        }
      />
      <Show when={!previewable() || state().mode === "preview"} fallback={props.source}>
        <Switch fallback={<ArtifactBinary path={props.path} size={size()} reason={state().reason} />}>
          <Match when={kind() === "image" || kind() === "svg"}>
            <ArtifactImage path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "video"}>
            <ArtifactVideo path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "audio"}>
            <ArtifactAudio path={props.path} content={props.content} {...media} />
          </Match>
          <Match when={kind() === "pdf" || kind() === "html"}>
            <ArtifactFrame path={props.path} content={props.content} kind={kind() === "pdf" ? "pdf" : "html"} />
          </Match>
          <Match when={kind() === "font"}>
            <ArtifactFont path={props.path} content={props.content} />
          </Match>
          <Match when={table()}>{(parsed) => <ArtifactTable parsed={parsed()} />}</Match>
          <Match when={kind() === "markdown" || kind() === "mermaid"}>{rendered()}</Match>
          {/* Keyed, so another viewer for the file mounts with bytes of its own. */}
          <Match when={viewer()} keyed>
            {(viewer) => (
              <ArtifactViewer
                viewer={viewer}
                path={props.path}
                size={size()}
                content={props.content}
                onDetails={(details) => change({ info: { details } })}
                onError={fail}
              />
            )}
          </Match>
        </Switch>
      </Show>
    </>
  )
}

function formatBytes(locale: string, bytes: number) {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const
  const index = Math.min(units.length - 1, bytes > 0 ? Math.floor(Math.log10(bytes) / 3) : 0)
  const value = bytes / 1000 ** index

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[index],
    // "short" bytes render as the singular "byte"; the long form pluralizes correctly.
    unitDisplay: index === 0 ? "long" : "short",
    maximumFractionDigits: value >= 100 || index === 0 ? 0 : 1,
  }).format(value)
}

function formatDuration(seconds: number) {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)

  return `${minutes}:${String(total % 60).padStart(2, "0")}`
}

function ArtifactToolbar(props: {
  mode?: ArtifactMode
  onModeChange?: (mode: ArtifactMode) => void
  meta: string[]
  actions?: JSX.Element
}) {
  const ctx = useExtension()

  return (
    <div data-slot="artifact-toolbar" class="flex h-10 shrink-0 items-center gap-3 px-4">
      <Show when={props.onModeChange}>
        <SegmentedControl
          value={props.mode ?? "preview"}
          onChange={(value) => {
            if (value === "preview" || value === "source") props.onModeChange?.(value)
          }}
        >
          <SegmentedControlItem value="preview">{ctx.t("view.preview")}</SegmentedControlItem>
          <SegmentedControlItem value="source">{ctx.t("view.source")}</SegmentedControlItem>
        </SegmentedControl>
      </Show>
      <div class="ms-auto flex min-w-0 items-center gap-3">
        <div class="flex min-w-0 items-center gap-2 text-12-regular text-text-weak">
          <For each={props.meta}>
            {(item, index) => (
              <>
                <Show when={index() > 0}>
                  <span aria-hidden class="text-text-faint">
                    ·
                  </span>
                </Show>
                <span class="truncate tabular-nums">{item}</span>
              </>
            )}
          </For>
        </div>
        {props.actions}
      </div>
    </div>
  )
}

/** Shows only while the browser pane is active and can load the file. */
function OpenInBrowserButton(props: { session: MountedSession; path: string }) {
  const ctx = useExtension()
  const shared = useShared()

  const pane = () => {
    const browser = current(shared.browser())

    return browser?.canOpen(props.session, props.path) ? browser : undefined
  }

  return (
    <Show when={pane()}>
      {(browser) => (
        <Button
          size="small"
          variant="ghost"
          icon="globe"
          onClick={() => {
            // The screen's workspace root, read when the user acts.
            const root = ctx.screen.current()?.file.root

            if (root !== undefined) browser().open(props.session, workspaceFileUrl(root, props.path))
          }}
        >
          {ctx.t("view.openInBrowser")}
        </Button>
      )}
    </Show>
  )
}

function createMediaUrl(content: () => FileContent) {
  return createMemo(() => {
    const streamed = content().url

    if (streamed) return streamed
    const value = blobUrlFromContent(content())
    onCleanup(() => URL.revokeObjectURL(value))

    return value
  })
}

/** Holds the pane until the media's first frame, so a file still streaming never shows as blank. */
function MediaLoading() {
  const ctx = useExtension()

  return (
    <div
      role="status"
      aria-label={ctx.t("common.loading")}
      class="pointer-events-none absolute inset-0 flex items-center justify-center text-text-weak"
    >
      <Loader class="size-4" />
    </div>
  )
}

/** Images and SVG previews: each decoded image owns its viewport. */
function ArtifactImage(props: MediaProps) {
  const url = createMediaUrl(() => props.content)

  return (
    <Show when={url()} keyed>
      {(src) => <ImageStage {...props} src={src} />}
    </Show>
  )
}

function ImageStage(props: MediaProps & { src: string }) {
  const ctx = useExtension()

  const [view, setView] = createStore({
    width: 0,
    height: 0,
    imageWidth: 0,
    imageHeight: 0,
    zoom: 1,
    x: 0,
    y: 0,
    dragging: false,
  })

  const fit = () =>
    Math.min(
      1,
      Math.max(1, view.width - 48) / (view.imageWidth || 1),
      Math.max(1, view.height - 48) / (view.imageHeight || 1),
    )

  const bound = (offset: number, image: number, zoom: number) => {
    // Keep the fitted footprint covered, including its letterboxing. Clamping to
    // the stage edges instead would move the anchor during small pinch increments.
    const limit = (image * fit() * (zoom - 1)) / 2

    return Math.max(-limit, Math.min(limit, offset))
  }

  const x = () => bound(view.x, view.imageWidth, view.zoom)
  const y = () => bound(view.y, view.imageHeight, view.zoom)
  const reset = () => setView({ zoom: 1, x: 0, y: 0 })

  const pan = (left: number, top: number) =>
    setView({ x: bound(left, view.imageWidth, view.zoom), y: bound(top, view.imageHeight, view.zoom) })

  let stage: HTMLDivElement | undefined
  let drag: { id: number; clientX: number; clientY: number; x: number; y: number } | undefined
  let dragged = false

  const cursor = () => {
    if (view.zoom === 1) return undefined

    return view.dragging ? "grabbing" : "grab"
  }

  const endDrag = (event: PointerEvent) => {
    if (event.pointerId !== drag?.id) return

    drag = undefined
    setView("dragging", false)
  }

  const zoomAt = (zoom: number, clientX: number, clientY: number) => {
    if (!stage) return

    const rect = stage.getBoundingClientRect()
    const next = Math.max(1, Math.min(Math.max(8, 1 / fit()), zoom))
    const ratio = next / view.zoom
    const anchor = { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
    setView({
      zoom: next,
      x: bound(anchor.x - (anchor.x - x()) * ratio, view.imageWidth, next),
      y: bound(anchor.y - (anchor.y - y()) * ratio, view.imageHeight, next),
    })
  }

  createResizeObserver(
    () => stage,
    () => {
      if (!stage) return

      setView({ width: stage.clientWidth, height: stage.clientHeight })
      setView({ x: x(), y: y() })
    },
  )

  return (
    <div
      ref={stage}
      data-slot="artifact-stage"
      data-checker
      data-zoom={view.zoom === 1 ? "fit" : "actual"}
      data-overflow={fit() < 1 || undefined}
      class="relative min-h-0 flex-1 overflow-hidden"
      on:wheel={(event) => {
        if (!view.imageWidth || (!event.ctrlKey && view.zoom === 1)) return

        // Chromium delivers trackpad pinch as Ctrl-wheel. Consume it here before
        // Desktop's window-level zoom handler; ordinary fitted scrolling stays native.
        event.preventDefault()
        event.stopPropagation()
        const unit = [1, 16, view.height][event.deltaMode] ?? 1

        if (event.ctrlKey) {
          zoomAt(view.zoom * Math.exp((-event.deltaY * unit) / 100), event.clientX, event.clientY)

          return
        }

        // Use the OS's trackpad momentum directly, with no second animation loop.
        pan(x() - event.deltaX * unit, y() - event.deltaY * unit)
      }}
    >
      <img
        data-slot="artifact-media"
        src={props.src}
        alt={getFilename(props.path)}
        draggable={false}
        class="absolute left-1/2 top-1/2 select-none"
        style={{
          width: view.imageWidth ? `${view.imageWidth * fit()}px` : undefined,
          height: view.imageHeight ? `${view.imageHeight * fit()}px` : undefined,
          "max-width": "none",
          "max-height": "none",
          transform: `translate(-50%, -50%) translate(${x()}px, ${y()}px) scale(${view.zoom})`,
          "touch-action": view.zoom > 1 ? "none" : "auto",
          cursor: cursor(),
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return

          dragged = false

          if (view.zoom === 1) return

          drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: x(), y: y() }
          event.currentTarget.setPointerCapture(event.pointerId)
          setView("dragging", true)
        }}
        onPointerMove={(event) => {
          if (!drag || drag.id !== event.pointerId) return

          const dx = event.clientX - drag.clientX
          const dy = event.clientY - drag.clientY

          if (!dragged && Math.hypot(dx, dy) < 3) return

          dragged = true
          pan(drag.x + dx, drag.y + dy)
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onError={() => props.onError()}
        onLoad={(event) => {
          const image = event.currentTarget
          const width = image.naturalWidth || image.width || image.clientWidth || 300
          const height = image.naturalHeight || image.height || image.clientHeight || 150

          setView({
            imageWidth: width,
            imageHeight: height,
            width: stage?.clientWidth ?? 0,
            height: stage?.clientHeight ?? 0,
          })
          props.onInfo({ width, height })
        }}
        onClick={(event) => {
          if (dragged) {
            dragged = false

            return
          }

          if (view.zoom > 1) return reset()

          zoomAt(1 / fit(), event.clientX, event.clientY)
        }}
      />
      <Show when={!view.imageWidth}>
        <MediaLoading />
      </Show>
      <div class="absolute end-3 top-3">
        <Button size="small" variant="neutral" disabled={view.zoom === 1} onClick={reset}>
          {ctx.t("view.fit")}
        </Button>
      </div>
    </div>
  )
}

function ArtifactVideo(props: MediaProps) {
  const ctx = useExtension()
  const dialog = useDialog()
  const url = createMediaUrl(() => props.content)
  const [loadedUrl, setLoadedUrl] = createSignal<string>()
  const [paused, setPaused] = createSignal(true)
  const [active, setActive] = createSignal(false)
  const [open, setOpen] = createSignal(false)
  const [box, setBox] = createStore({ left: 0, top: 0, ready: false })

  let stage: HTMLDivElement | undefined
  let video: HTMLVideoElement | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined

  const clearIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = undefined
  }

  const wake = () => {
    setActive(true)
    clearIdle()
    idleTimer = setTimeout(() => setActive(false), 2500)
  }

  onCleanup(clearIdle)

  // The preview fills the window and borrows this <video> element, so playback carries on as it flies out and back.
  const expand = () => {
    const el = video

    if (!el?.videoWidth || open() || !stage?.contains(el)) return
    setOpen(true)
    dialog.show(
      () => <ImagePreview src={el.currentSrc} alt={getFilename(props.path)} video={el} />,
      () => setOpen(false),
    )
  }

  const measure = () => {
    if (!video || video.offsetWidth === 0 || video.offsetHeight === 0) return

    // Chromium's media controls place the 48x48 fullscreen slot 48px from the right edge (beside the
    // 48px overflow button) and 24px above the bottom edge (above the 24px timeline scrubber).
    setBox({
      left: video.offsetLeft + video.offsetWidth - 96,
      top: video.offsetTop + video.offsetHeight - 72,
      ready: true,
    })
  }

  createResizeObserver(
    () => [stage, video],
    () => measure(),
  )

  const controlsVisible = () => !open() && (paused() || active())

  return (
    <div
      ref={stage}
      data-slot="artifact-stage"
      data-zoom="fit"
      class="relative min-h-0 flex-1 overflow-hidden"
      onPointerMove={wake}
      onPointerLeave={() => {
        clearIdle()
        setActive(false)
      }}
    >
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <video
          ref={video}
          data-slot="artifact-media"
          class="w-full bg-black"
          controls
          preload="metadata"
          playsinline
          onError={() => props.onError()}
          src={url()}
          onClick={(event) => {
            // Chromium's controls answer the second click of a double click with a native fullscreen request, which
            // covers the preview the double click opens. Opting out with controlslist="nofullscreen" would also end
            // their click-to-play. The fullscreen element ready check refuses an open popover, so the video is one
            // while its controls handle this click, and is released before the next frame renders.
            const el = event.currentTarget

            // In native fullscreen, the controls' own exit must run; showPopover would throw there.
            if (event.detail < 2 || document.fullscreenElement === el) return
            el.setAttribute("popover", "manual")
            el.showPopover?.()
            requestAnimationFrame(() => el.removeAttribute("popover"))
          }}
          onDblClick={expand}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => setPaused(true)}
          onLoadedMetadata={(event) => {
            const el = event.currentTarget
            setPaused(el.paused)
            props.onInfo({ width: el.videoWidth, height: el.videoHeight, duration: el.duration })
            measure()
          }}
          onLoadedData={() => setLoadedUrl(url())}
        />
        <Show when={loadedUrl() !== url()}>
          <MediaLoading />
        </Show>
        <button
          type="button"
          data-slot="artifact-video-fullscreen"
          aria-label={ctx.t("view.fullscreen")}
          title={ctx.t("view.fullscreen")}
          onClick={expand}
          style={box.ready ? { left: `${box.left}px`, top: `${box.top}px` } : { right: "72px", bottom: "48px" }}
          classList={{
            "absolute z-10 flex size-12 items-center justify-center transition-opacity focus-visible:opacity-100 focus-visible:outline-none": true,
            "opacity-100": controlsVisible(),
            "pointer-events-none opacity-0": !controlsVisible(),
          }}
        >
          <span class="flex size-9 items-center justify-center rounded-full transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M3 6V3H6M10 3H13V6M13 10V13H10M6 13H3V10"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="square"
              />
            </svg>
          </span>
        </button>
      </div>
    </div>
  )
}

function ArtifactAudio(props: MediaProps) {
  const url = createMediaUrl(() => props.content)

  return (
    <div data-slot="artifact-stage" class="relative min-h-0 flex-1 overflow-auto">
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="flex w-full max-w-lg flex-col items-center gap-5 rounded-xl border border-v2-border-border-muted bg-v2-background-bg-base px-8 py-8 shadow-[var(--v2-elevation-raised)]">
          <div class="flex size-14 items-center justify-center rounded-full bg-v2-background-bg-layer-02">
            <FileIcon node={{ path: props.path, type: "file" }} class="size-7" />
          </div>
          <div class="max-w-full truncate text-14-medium text-text-strong">{getFilename(props.path)}</div>
          <audio
            class="w-full"
            onError={() => props.onError()}
            controls
            preload="metadata"
            src={url()}
            onLoadedMetadata={(event) => props.onInfo({ duration: event.currentTarget.duration })}
          />
        </div>
      </div>
    </div>
  )
}

function ArtifactFrame(props: { path: string; content: FileContent; kind: "pdf" | "html" }) {
  const url = createMediaUrl(() => props.content)
  // PDF Open Parameters: start with the thumbnail pane closed and the page fitted to the pane width.
  const src = () => (props.kind === "pdf" ? `${url()}#navpanes=0&view=FitH` : url())

  return (
    <iframe
      class="block h-full w-full flex-1 border-0 bg-white"
      title={getFilename(props.path)}
      src={src()}
      // The PDF viewer is Chromium's own and does not run in a sandboxed frame. HTML runs as an
      // opaque origin: no app storage, cookies, or credentialed requests reach it.
      sandbox={props.kind === "html" ? "allow-scripts allow-popups allow-forms allow-modals" : undefined}
      referrerPolicy="no-referrer"
    />
  )
}

function ArtifactMarkdown(props: { session: MountedSession; path: string; text: string; cacheKey?: string }) {
  const ctx = useExtension()
  const links = ctx.links
  const parent = useMarkdown()
  // getDirectory yields "/" for a root-level file, which would make relative links absolute.
  const dir = createMemo(() => (props.path.includes("/") || props.path.includes("\\") ? getDirectory(props.path) : ""))
  // Absolute references bypass the file's directory; relative ones resolve against it.
  const resolve = (href: string) => (/^([a-z]:)?\//i.test(href) ? href : (resolveArtifactPath(dir(), href) ?? href))

  return (
    <MarkdownProvider
      readImage={(src, signal) => parent?.readImage?.(resolve(src), signal) ?? Promise.resolve(undefined)}
      openLocalFile={(href) => void links.open({ href, base: dir(), session: props.session })}
      localFileExists={(href) => untrack(() => links.exists({ href, base: dir(), session: props.session }))}
    >
      <div class="mx-auto w-full max-w-3xl px-8 py-6">
        <Markdown text={props.text} cacheKey={props.cacheKey} />
      </div>
    </MarkdownProvider>
  )
}

/** Mermaid sources render through the same fenced-block pipeline the timeline uses. */
function ArtifactMermaid(props: { text: string; cacheKey?: string }) {
  return (
    <div class="mx-auto w-full max-w-4xl px-8 py-6">
      <Markdown text={`\`\`\`mermaid\n${props.text}\n\`\`\``} cacheKey={props.cacheKey} />
    </div>
  )
}

function ArtifactTable(props: { parsed: ReturnType<typeof parseDelimited> }) {
  const ctx = useExtension()
  const parsed = () => props.parsed
  // Pad the header to the widest row so no data column is dropped.
  const header = () => Array.from({ length: parsed().columns }, (_, index) => parsed().rows[0]?.[index] ?? "")
  const body = () => parsed().rows.slice(1)

  return (
    <div class="min-h-0 flex-1 overflow-auto">
      <table data-slot="artifact-table" class="min-w-full text-13-regular text-text-base">
        <thead>
          <tr>
            <th data-index />
            <For each={header()}>{(cell) => <th>{cell}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={body()}>
            {(row, index) => (
              <tr>
                <td data-index>{index() + 1}</td>
                <For each={header()}>{(_, column) => <td>{row[column()] ?? ""}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={parsed().total > parsed().rows.length}>
        <div class="px-4 py-3 text-12-regular text-text-weak">
          {ctx.t("view.table.truncated", { shown: parsed().rows.length - 1, total: parsed().total - 1 })}
        </div>
      </Show>
    </div>
  )
}

const specimenSizes = [12, 16, 24, 40, 64]

function ArtifactFont(props: { path: string; content: FileContent }) {
  const ctx = useExtension()
  const url = createMediaUrl(() => props.content)
  const family = createMemo(() => `artifact-${Math.random().toString(36).slice(2)}`)

  // The document's font set holds the face while it shows.
  createKeyed(url, (source) => {
    const face = new FontFace(family(), `url(${source})`)

    document.fonts.add(face)
    void face.load().catch(() => undefined)
    onCleanup(() => document.fonts.delete(face))
  })

  return (
    <div class="min-h-0 flex-1 overflow-auto">
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8" style={{ "font-family": `"${family()}"` }}>
        <div class="text-text-strong" style={{ "font-size": "56px", "line-height": "1.1" }}>
          {getFilename(props.path).replace(/\.[^.]+$/, "")}
        </div>
        <div class="break-all text-text-base" style={{ "font-size": "22px", "line-height": "1.4" }}>
          ABCDEFGHIJKLMNOPQRSTUVWXYZ
          <br />
          abcdefghijklmnopqrstuvwxyz
          <br />
          0123456789 !?&@#%(){}[]
        </div>
        <div class="flex flex-col gap-3 border-t border-v2-border-border-muted pt-6">
          <For each={specimenSizes}>
            {(size) => (
              <div class="flex items-baseline gap-4">
                <span
                  class="w-8 shrink-0 text-12-regular text-text-faint tabular-nums"
                  style={{ "font-family": "var(--font-family-mono)" }}
                >
                  {size}
                </span>
                <span class="text-text-base" style={{ "font-size": `${size}px`, "line-height": "1.25" }}>
                  {ctx.t("view.fontSample")}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

/**
 * Hands a file to an extension's viewer, decoding its bytes once per loaded content; the viewer owns them, and may move
 * their buffer to a worker. Bytes the viewer rejects, and a viewer that throws, show the binary placeholder in this
 * area alone rather than the whole file panel failing.
 */
function ArtifactViewer(props: {
  viewer: FileViewer
  path: string
  size: string
  content: FileContent
  onDetails: (details: readonly string[]) => void
  onError: (reason?: string) => void
}) {
  // Checked together, so the check only ever reads bytes freshly decoded, never ones the viewer has moved away.
  const decoded = createMemo(() => {
    const bytes = bytesFromContent(props.content)

    return { bytes, problem: props.viewer.problem?.(bytes) }
  })

  return (
    <Show
      when={!decoded().problem}
      fallback={<ArtifactBinary path={props.path} size={props.size} reason={decoded().problem} />}
    >
      <ErrorBoundary
        // Taking the error makes Solid call this once per error, untracked, rather than render it as a reactive child.
        fallback={(_) => {
          // Fails the file as a rejection does: its details leave the toolbar, and a reloaded file mounts a new viewer.
          props.onError()

          return <ArtifactBinary path={props.path} size={props.size} />
        }}
      >
        <Dynamic
          component={props.viewer.View}
          bytes={decoded().bytes}
          onDetails={props.onDetails}
          onError={props.onError}
        />
      </ErrorBoundary>
    </Show>
  )
}

function ArtifactBinary(props: { path: string; size: string; reason?: string }) {
  const ctx = useExtension()

  return (
    <div data-slot="artifact-stage" class="relative min-h-0 flex-1">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <FileIcon node={{ path: props.path, type: "file" }} class="size-8 text-text-weak" />
        <div class="text-14-medium text-text-strong">{getFilename(props.path)}</div>
        <div class="text-13-regular text-text-weak">{ctx.t("view.binary", { size: props.size })}</div>
        <Show when={props.reason}>{(reason) => <div class="text-13-regular text-text-weak">{reason()}</div>}</Show>
      </div>
    </div>
  )
}
