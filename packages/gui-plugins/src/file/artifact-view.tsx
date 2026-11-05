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
import { PreviewControls } from "@opencode/ui/preview-controls"
import { useDialog } from "@opencode/ui/context/dialog"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ImagePreview } from "@opencode/ui/image-preview"
import { Loader } from "@opencode/ui/loader"
import { showToast } from "@opencode/ui/toast"
import { Markdown } from "@opencode/session-ui/markdown"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { artifactKind } from "@opencode/util/artifact"
import { getDirectory, getFilename } from "@opencode/util/path"
import { createKeyed, usePlugin, type FileContent, type MountedSession, type SessionScreen } from "@opencode/plugin/gui"
import {
  blobUrlFromContent,
  bytesFromContent,
  contentBytes,
  parseDelimited,
  resolveArtifactPath,
  splitFrontmatter,
  type FrontmatterProperty,
} from "./artifact"
import { FileViewer } from "@opencode/plugin/gui/file"
import { uuid } from "@opencode/util/uuid"
import { ArtifactToolbar } from "./artifact-toolbar"
import {
  createArtifactViewerState,
  createVideoOverlayState,
  INITIAL_IMAGE_STAGE_GESTURE_STATE,
  selectArtifactInfo,
  selectArtifactMode,
  selectArtifactPreviewable,
  selectArtifactReason,
  selectArtifactShowingPreview,
  selectArtifactStageKind,
  selectStageClickSuppressed,
  selectStageCursor,
  selectStagePanMoved,
  selectStagePanPointer,
  selectVideoControlsVisible,
  selectVideoLoading,
  STAGE_DRAG_THRESHOLD_PX,
  transitionArtifactViewer,
  transitionImageStageGesture,
  transitionVideoOverlay,
  type ArtifactInfo,
  type ArtifactViewerEvent,
  type ImageStageGestureEvent,
  type VideoOverlayEvent,
} from "./artifact-view-machine"

/** Results name the content they came from, so one from a file since reread changes nothing. */
type MediaProps = {
  path: string
  content: FileContent
  onInfo: (content: FileContent, info: ArtifactInfo) => void
  /** The browser could not decode the bytes; the host falls back to the binary placeholder. */
  onError: (content: FileContent) => void
}

/**
 * Renders a loaded non-text file: media, documents, and data get a dedicated viewer with a toolbar;
 * previewable text kinds can switch to `source`, which the host supplies (its code view).
 */
export default function ArtifactView(props: {
  session: MountedSession
  screen: SessionScreen
  path: string
  content: FileContent
  cacheKey?: string
  source: JSX.Element
}) {
  const ctx = usePlugin()
  const locale = ctx.locale
  // The viewer state belongs to one loaded content: a reread file starts from the preview again.
  const [viewerState, setViewerState] = createSignal(createArtifactViewerState(props.content))

  const dispatchViewer = (event: ArtifactViewerEvent) => {
    const prev = untrack(viewerState)
    const next = transitionArtifactViewer(
      prev,
      untrack(() => props.content),
      event,
    )

    if (next !== prev) setViewerState(next)
  }

  // Media the browser could not decode falls back to the binary placeholder.
  const kind = createMemo(() => selectArtifactStageKind(viewerState(), props.path, props.content))
  const previewable = createMemo(() => selectArtifactPreviewable(props.path, props.content))

  const table = createMemo(() =>
    kind() === "table"
      ? parseDelimited(props.content.content, props.path.toLowerCase().endsWith(".tsv") ? "\t" : ",")
      : undefined,
  )

  const meta = createMemo(() => {
    const parsed = table()

    const info: ArtifactInfo = parsed
      ? { rows: parsed.total, columns: parsed.columns }
      : selectArtifactInfo(viewerState(), props.content)

    return [
      info.duration ? formatDuration(info.duration) : undefined,
      info.width && info.height ? `${info.width} × ${info.height}` : undefined,
      info.columns !== undefined ? ctx.plural("view.table.columns", info.columns) : undefined,
      info.rows !== undefined ? ctx.plural("view.table.rows", Math.max(0, info.rows - 1)) : undefined,
      ...(info.details ?? []),
      formatBytes(locale.locale(), contentBytes(props.content)),
    ].filter((item): item is string => !!item)
  })

  const media = {
    onInfo: (content: FileContent, info: ArtifactInfo) => dispatchViewer({ type: "info.reported", content, info }),
    onError: (content: FileContent) =>
      dispatchViewer({ type: "decode.failed", content, reason: ctx.t("view.loadFailed") }),
  }

  const size = () => formatBytes(locale.locale(), contentBytes(props.content))

  // A kind the file view does not render itself goes to the first plugin viewer that lists it.
  const viewer = createMemo(() => {
    const value = kind()

    return value === "binary" ? undefined : ctx.list(FileViewer).find((item) => item.kinds.includes(value))
  })

  const rendered = () => (
    <Show
      when={kind() === "markdown"}
      fallback={<ArtifactMermaid text={props.content.content} cacheKey={props.cacheKey} />}
    >
      <div
        data-slot="artifact-document-stage"
        data-kind="markdown"
        data-document-surface-inset
        data-document-surface-scrollport
        data-document-surface-column
        class="min-h-0 flex-1 overflow-auto"
        data-scrollable
      >
        <ArtifactMarkdown
          session={props.session}
          path={props.path}
          text={props.content.content}
          cacheKey={props.cacheKey}
        />
      </div>
    </Show>
  )

  return (
    <div data-slot="artifact-view" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ArtifactToolbar
        session={props.session}
        screen={props.screen}
        path={props.path}
        text={previewable() ? props.content.content : undefined}
        mode={selectArtifactMode(viewerState(), props.content)}
        onModeChange={previewable() ? (mode) => dispatchViewer({ type: "mode.changed", mode }) : undefined}
        meta={meta()}
        html={kind() === "html"}
      />
      <Show when={selectArtifactShowingPreview(viewerState(), props.path, props.content)} fallback={props.source}>
        <Switch
          fallback={
            <ArtifactBinary
              path={props.path}
              size={size()}
              reason={selectArtifactReason(viewerState(), props.content)}
            />
          }
        >
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
                onDetails={(content, details) => dispatchViewer({ type: "info.reported", content, info: { details } })}
                onError={(content, reason) => dispatchViewer({ type: "decode.failed", content, reason })}
              />
            )}
          </Match>
        </Switch>
      </Show>
    </div>
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

/**
 * The URL media loads from, with the content it was made for. A reread that streams from the same URL keeps the
 * source, so media already showing is not reloaded.
 */
function createMediaSource(content: () => FileContent) {
  return createMemo(
    () => {
      const value = content()

      if (value.url) return { content: value, src: value.url }
      const src = blobUrlFromContent(value)
      onCleanup(() => URL.revokeObjectURL(src))

      return { content: value, src }
    },
    undefined,
    { equals: (prev, next) => prev.src === next.src },
  )
}

/** Holds the pane until the media's first frame, so a file still streaming never shows as blank. */
function MediaLoading() {
  const ctx = usePlugin()

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
  const source = createMediaSource(() => props.content)

  return (
    <Show when={source()} keyed>
      {(source) => <ImageStage {...props} content={source.content} src={source.src} />}
    </Show>
  )
}

function ImageStage(props: MediaProps & { src: string }) {
  const [view, setView] = createStore({ width: 0, height: 0, imageWidth: 0, imageHeight: 0, zoom: 1 })
  const [gesture, setGesture] = createSignal(INITIAL_IMAGE_STAGE_GESTURE_STATE)
  // The pan offsets paint straight to the image, so a pointer move writes no reactive state.
  let panX = 0
  let panY = 0
  // Where the pan's pointer pressed, then where it was on its last move.
  const origin = { x: 0, y: 0 }
  let stage: HTMLDivElement | undefined
  let image: HTMLImageElement | undefined

  const fit = () =>
    Math.min(
      artifactKind(props.path) === "svg" ? Infinity : 1,
      Math.max(1, view.width - 48) / (view.imageWidth || 1),
      Math.max(1, view.height - 48) / (view.imageHeight || 1),
    )

  const minZoom = () => Math.min(0.25, 1 / fit())
  const maxZoom = () => Math.max(8, 1 / fit())

  const bound = (offset: number, size: number) => {
    // Keep the fitted footprint covered, including its letterboxing. Clamping to
    // the stage edges instead would move the anchor during small pinch increments.
    const limit = Math.max(0, (size * fit() * (view.zoom - 1)) / 2)

    return Math.max(-limit, Math.min(limit, offset))
  }

  const paint = () => {
    if (image) image.style.transform = `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${view.zoom})`
  }

  const pan = (left: number, top: number) => {
    panX = bound(left, view.imageWidth)
    panY = bound(top, view.imageHeight)
    paint()
  }

  const dispatchGesture = (event: ImageStageGestureEvent) => {
    const prev = untrack(gesture)
    const next = transitionImageStageGesture(prev, event)

    if (next.state !== prev) setGesture(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "pointer.capture") return image?.setPointerCapture(effect.pointerId)

      if (image?.hasPointerCapture(effect.pointerId)) image.releasePointerCapture(effect.pointerId)
    })
  }

  const setZoom = (zoom: number, left: number, top: number) => {
    setView("zoom", zoom)
    pan(left, top)
    dispatchGesture({ type: "zoom.changed", zoomed: zoom > 1 })
  }

  const reset = () => setZoom(1, 0, 0)

  const zoomAt = (zoom: number, clientX: number, clientY: number) => {
    if (!stage) return

    const rect = stage.getBoundingClientRect()
    const next = Math.max(minZoom(), Math.min(maxZoom(), zoom))
    const ratio = next / view.zoom
    const anchor = { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 }
    setZoom(next, anchor.x - (anchor.x - panX) * ratio, anchor.y - (anchor.y - panY) * ratio)
  }

  const zoomBy = (factor: number) => {
    if (!stage) return
    const rect = stage.getBoundingClientRect()

    zoomAt(view.zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  const cancel = (event: PointerEvent) => dispatchGesture({ type: "pointer.cancel", pointerId: event.pointerId })

  createResizeObserver(
    () => stage,
    () => {
      if (!stage) return

      setView({ width: stage.clientWidth, height: stage.clientHeight })
      pan(panX, panY)
    },
  )

  onCleanup(() => dispatchGesture({ type: "disposed" }))

  return (
    <div
      ref={stage}
      data-slot="artifact-stage"
      data-zoom={view.zoom === 1 ? "fit" : "actual"}
      data-overflow={fit() < 1 || undefined}
      class="relative min-h-0 flex-1 overflow-hidden"
      on:wheel={(event) => {
        if (!view.imageWidth || (!event.ctrlKey && view.zoom <= 1)) return

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
        pan(panX - event.deltaX * unit, panY - event.deltaY * unit)
      }}
    >
      <img
        ref={(element) => {
          image = element
          paint()
        }}
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
          "touch-action": view.zoom > 1 ? "none" : "auto",
          cursor: selectStageCursor(gesture(), view.zoom > 1),
        }}
        onPointerDown={(event) => {
          dispatchGesture({
            type: "pointer.down",
            pointerId: event.pointerId,
            button: event.button,
            primary: event.isPrimary,
            zoomed: view.zoom > 1,
          })

          if (!selectStagePanPointer(gesture(), event.pointerId)) return
          origin.x = event.clientX
          origin.y = event.clientY
        }}
        onPointerMove={(event) => {
          const current = gesture()

          if (!selectStagePanPointer(current, event.pointerId)) return

          // The button came up where this element could not hear it.
          if (event.pointerType === "mouse" && (event.buttons & 1) === 0) return cancel(event)
          const dx = event.clientX - origin.x
          const dy = event.clientY - origin.y

          if (dx === 0 && dy === 0) return

          // Only the move that crosses the threshold changes the gesture; the rest dispatch and allocate nothing.
          if (!selectStagePanMoved(current)) {
            if (Math.hypot(dx, dy) < STAGE_DRAG_THRESHOLD_PX) return

            dispatchGesture({ type: "pointer.moved", pointerId: event.pointerId })
          }

          // Each move pans by its own delta, so reversing at a clamp wall moves the image at once.
          origin.x = event.clientX
          origin.y = event.clientY
          pan(panX + dx, panY + dy)
        }}
        onPointerUp={(event) => dispatchGesture({ type: "pointer.up", pointerId: event.pointerId })}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onError={() => props.onError(props.content)}
        onLoad={(event) => {
          const element = event.currentTarget
          const width = element.naturalWidth || element.width || element.clientWidth || 300
          const height = element.naturalHeight || element.height || element.clientHeight || 150

          setView({
            imageWidth: width,
            imageHeight: height,
            width: stage?.clientWidth ?? 0,
            height: stage?.clientHeight ?? 0,
          })
          pan(panX, panY)
          props.onInfo(props.content, { width, height })
        }}
        onClick={(event) => {
          // The click that ends a moved pan neither fits nor zooms.
          const suppressed = selectStageClickSuppressed(gesture())
          dispatchGesture({ type: "click" })

          if (suppressed) return

          if (view.zoom !== 1) return reset()

          zoomAt(1 / fit(), event.clientX, event.clientY)
        }}
      />
      <Show when={!view.imageWidth}>
        <MediaLoading />
      </Show>
      <PreviewControls
        disabled={!view.imageWidth}
        zoomInDisabled={view.zoom >= maxZoom()}
        zoomOutDisabled={view.zoom <= minZoom()}
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(1 / 1.25)}
        onFit={reset}
      />
    </div>
  )
}

function ArtifactVideo(props: MediaProps) {
  const source = createMediaSource(() => props.content)

  return (
    <Show when={source()} keyed>
      {(source) => <VideoStage {...props} content={source.content} src={source.src} />}
    </Show>
  )
}

function VideoStage(props: MediaProps & { src: string }) {
  const ctx = usePlugin()
  const dialog = useDialog()
  const [overlay, setOverlay] = createSignal(createVideoOverlayState())
  const [box, setBox] = createStore({ left: 0, top: 0, ready: false })

  let stage: HTMLDivElement | undefined
  let frame: HTMLDivElement | undefined
  let video: HTMLVideoElement | undefined
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let popoverFrame: number | undefined
  let preview: { attempt: number; id: string; observer: MutationObserver } | undefined

  const dispatch = (event: VideoOverlayEvent) => {
    const prev = untrack(overlay)
    const next = transitionVideoOverlay(prev, event)

    if (next.state !== prev) setOverlay(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "idle.schedule") {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => dispatch({ type: "idle.elapsed", attempt: effect.attempt }), effect.delayMs)

        return
      }

      if (effect.type === "idle.clear") {
        clearTimeout(idleTimer)
        idleTimer = undefined

        return
      }

      if (effect.type === "preview.open") return open(effect.attempt)

      if (preview?.attempt !== effect.attempt) return
      preview.observer.disconnect()

      if (effect.type === "preview.close") dialog.close(preview.id)
      preview = undefined
    })
  }

  // The preview fills the window and borrows this <video> element, so playback carries on as it flies out and back.
  // The overlay controls stay hidden until the video is back in the stage, or the preview is gone without it.
  const open = (attempt: number) => {
    const el = video

    if (!el || !frame) return dispatch({ type: "preview.returned", attempt })

    const back = () => {
      if (stage?.contains(el)) dispatch({ type: "preview.returned", attempt })
    }

    // The preview hands the video back into this frame; nothing else in it changes while the preview is open.
    const observer = new MutationObserver(back)
    const id = uuid()

    observer.observe(frame, { childList: true })
    preview = { attempt, id, observer }
    dialog.show(
      () => {
        onCleanup(() => dispatch({ type: "preview.returned", attempt }))

        return <ImagePreview src={el.currentSrc} alt={getFilename(props.path)} video={el} />
      },
      // A preview that closes before it borrowed the video, or never mounts, leaves it in place.
      back,
      id,
    )
  }

  const expand = () =>
    dispatch({ type: "expand.requested", canExpand: !!video?.videoWidth && !!stage?.contains(video) })

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

  onCleanup(() => {
    if (popoverFrame !== undefined) {
      cancelAnimationFrame(popoverFrame)
      video?.removeAttribute("popover")
    }

    dispatch({ type: "disposed" })
  })

  return (
    <div
      ref={stage}
      data-slot="artifact-stage"
      data-zoom="fit"
      class="relative min-h-0 flex-1 overflow-hidden"
      onPointerMove={() => dispatch({ type: "pointer.moved" })}
      onPointerLeave={() => dispatch({ type: "pointer.left" })}
    >
      <div ref={frame} class="absolute inset-0 flex items-center justify-center p-6">
        <video
          ref={video}
          data-slot="artifact-media"
          class="w-full bg-black"
          controls
          preload="metadata"
          playsinline
          onError={() => props.onError(props.content)}
          src={props.src}
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

            if (popoverFrame !== undefined) cancelAnimationFrame(popoverFrame)
            popoverFrame = requestAnimationFrame(() => {
              popoverFrame = undefined
              el.removeAttribute("popover")
            })
          }}
          onDblClick={expand}
          onPlay={() => dispatch({ type: "playback.changed", paused: false })}
          onPause={() => dispatch({ type: "playback.changed", paused: true })}
          onEnded={() => dispatch({ type: "playback.changed", paused: true })}
          onLoadedMetadata={(event) => {
            const el = event.currentTarget
            props.onInfo(props.content, { width: el.videoWidth, height: el.videoHeight, duration: el.duration })
            measure()
          }}
          onLoadedData={(event) => dispatch({ type: "media.loaded", paused: event.currentTarget.paused })}
        />
        <Show when={selectVideoLoading(overlay())}>
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
            "opacity-100": selectVideoControlsVisible(overlay()),
            "pointer-events-none opacity-0": !selectVideoControlsVisible(overlay()),
          }}
        >
          <span class="flex size-9 items-center justify-center rounded-full transition-colors">
            <Icon name="outline-expand" size="normal" />
          </span>
        </button>
      </div>
    </div>
  )
}

function ArtifactAudio(props: MediaProps) {
  const source = createMediaSource(() => props.content)

  return (
    <div data-slot="artifact-stage" class="relative min-h-0 flex-1 overflow-auto">
      <div class="absolute inset-0 flex items-center justify-center p-6">
        <div class="flex w-full max-w-lg flex-col items-center gap-5 rounded-xl bg-v2-background-bg-base px-8 py-8 shadow-[var(--v2-elevation-raised)]">
          <div class="flex size-14 items-center justify-center rounded-full bg-v2-background-bg-layer-02">
            <FileIcon node={{ path: props.path, type: "file" }} mono class="size-7 text-v2-icon-icon-muted" />
          </div>
          <div class="max-w-full truncate text-14-medium text-text-strong">{getFilename(props.path)}</div>
          <audio
            class="w-full"
            // Setting a new src drops the old one's queued events, so these always describe the current source.
            onError={() => props.onError(source().content)}
            controls
            preload="metadata"
            src={source().src}
            onLoadedMetadata={(event) => props.onInfo(source().content, { duration: event.currentTarget.duration })}
          />
        </div>
      </div>
    </div>
  )
}

function ArtifactFrame(props: { path: string; content: FileContent; kind: "pdf" | "html" }) {
  const source = createMediaSource(() => props.content)
  // PDF Open Parameters: start with the thumbnail pane closed and the page fitted to the pane width.
  const src = () => (props.kind === "pdf" ? `${source().src}#navpanes=0&view=FitH` : source().src)

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
  const ctx = usePlugin()
  const links = ctx.links
  const parent = useMarkdown()
  // getDirectory yields "/" for a root-level file, which would make relative links absolute.
  const dir = createMemo(() => (props.path.includes("/") || props.path.includes("\\") ? getDirectory(props.path) : ""))
  // Absolute references bypass the file's directory; relative ones resolve against it.
  const resolve = (href: string) => (/^([a-z]:)?\//i.test(href) ? href : (resolveArtifactPath(dir(), href) ?? href))
  const split = createMemo(() => splitFrontmatter(props.text))

  return (
    <MarkdownProvider
      readImage={(src, signal) => parent?.readImage?.(resolve(src), signal) ?? Promise.resolve(undefined)}
      openLocalFile={(href) => void links.open({ href, base: dir(), session: props.session })}
      localFileExists={(href) => untrack(() => links.exists({ href, base: dir(), session: props.session }))}
    >
      <div data-slot="artifact-markdown-page" data-component="document-surface">
        <div data-slot="artifact-markdown-content">
          <Show when={split().properties}>{(properties) => <ArtifactProperties properties={properties()} />}</Show>
          <Markdown text={split().body} cacheKey={props.cacheKey} />
        </div>
      </div>
    </MarkdownProvider>
  )
}

function ArtifactProperties(props: { properties: FrontmatterProperty[] }) {
  const ctx = usePlugin()
  const [expanded, setExpanded] = createSignal(false)
  // Long frontmatter shows its first entries until the reader asks for the rest.
  const shown = () => (expanded() || props.properties.length <= 8 ? props.properties : props.properties.slice(0, 6))

  return (
    <div data-slot="artifact-properties">
      <dl aria-label={ctx.t("view.properties")}>
        <For each={shown()}>
          {(property) => (
            <>
              <dt>{property.key}</dt>
              <dd data-code={property.code ? "" : undefined}>{property.value}</dd>
            </>
          )}
        </For>
      </dl>
      <Show when={shown().length < props.properties.length}>
        <button type="button" data-slot="artifact-properties-more" onClick={() => setExpanded(true)}>
          {ctx.t("view.properties.showAll", { count: props.properties.length })}
        </button>
      </Show>
    </div>
  )
}

/** Mermaid sources render through the same fenced-block pipeline the timeline uses. */
function ArtifactMermaid(props: { text: string; cacheKey?: string }) {
  const [view, setView] = createStore({ zoom: 1, width: 0 })
  let scroller: HTMLDivElement | undefined

  createResizeObserver(
    () => scroller,
    (rect) => setView("width", rect.width),
  )

  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} class="min-h-0 flex-1 overflow-auto" data-scrollable>
        <div class="grid min-h-full w-max min-w-full place-items-center">
          <div data-slot="artifact-diagram" style={{ width: `${Math.min(view.width, 896)}px`, zoom: view.zoom }}>
            <Markdown text={`\`\`\`mermaid\n${props.text}\n\`\`\``} cacheKey={props.cacheKey} />
          </div>
        </div>
      </div>
      <PreviewControls
        disabled={view.width === 0}
        zoomInDisabled={view.zoom >= 4}
        zoomOutDisabled={view.zoom <= 0.25}
        onZoomIn={() => setView("zoom", Math.min(4, view.zoom * 1.25))}
        onZoomOut={() => setView("zoom", Math.max(0.25, view.zoom / 1.25))}
        onFit={() => {
          setView("zoom", 1)
          scroller?.scrollTo({ top: 0, left: 0 })
        }}
      />
    </div>
  )
}

function ArtifactTable(props: { parsed: ReturnType<typeof parseDelimited> }) {
  const ctx = usePlugin()
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  const parsed = () => props.parsed
  // Pad the header to the widest row so no data column is dropped.
  const header = () => Array.from({ length: parsed().columns }, (_, index) => parsed().rows[0]?.[index] ?? "")
  const body = () => parsed().rows.slice(1)

  const copy = (text: string) => {
    // Read the parsed value, not the ellipsized presentation, including embedded tabs and newlines.
    void ctx.system.copy(text).catch(() => {
      if (!controller.signal.aborted) showToast({ variant: "error", title: ctx.t("view.table.copyFailed") })
    })
  }

  return (
    <div class="min-h-0 flex-1 overflow-auto" data-scrollable>
      <table data-slot="artifact-table" class="min-w-full text-13-regular text-text-base">
        <thead>
          <tr>
            <For each={header()}>
              {(cell) => (
                <th scope="col">
                  <span data-slot="artifact-table-cell-text">{cell}</span>
                  <IconButton
                    data-slot="artifact-table-copy"
                    variant="ghost-muted"
                    size="small"
                    icon={<Icon name="outline-copy" size="normal" />}
                    aria-label={ctx.t("view.table.copyCell")}
                    title={ctx.t("view.table.copyCell")}
                    onClick={() => copy(cell)}
                  />
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={body()}>
            {(row) => (
              <tr>
                <For each={header()}>
                  {(_, column) => (
                    <td>
                      <span data-slot="artifact-table-cell-text">{row[column()] ?? ""}</span>
                      <IconButton
                        data-slot="artifact-table-copy"
                        variant="ghost-muted"
                        size="small"
                        icon={<Icon name="outline-copy" size="normal" />}
                        aria-label={ctx.t("view.table.copyCell")}
                        title={ctx.t("view.table.copyCell")}
                        onClick={() => copy(row[column()] ?? "")}
                      />
                    </td>
                  )}
                </For>
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
  const ctx = usePlugin()
  const source = createMediaSource(() => props.content)
  const family = createMemo(() => `artifact-${Math.random().toString(36).slice(2)}`)

  // The document's font set holds the face while it shows.
  createKeyed(source, (value) => {
    const face = new FontFace(family(), `url(${value.src})`)

    document.fonts.add(face)
    void face.load().catch(() => undefined)
    onCleanup(() => document.fonts.delete(face))
  })

  return (
    <div
      data-slot="artifact-document-stage"
      data-kind="font"
      data-document-surface-inset
      data-document-surface-scrollport
      data-document-surface-column
      class="min-h-0 flex-1 overflow-auto"
      data-scrollable
    >
      <div
        data-component="document-surface"
        class="flex min-h-full w-full flex-col gap-6 px-8 py-8"
        style={{ "font-family": `"${family()}"` }}
      >
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
 * Hands a file to a plugin's viewer, decoding its bytes once per loaded content; the viewer owns them, and may move
 * their buffer to a worker. Bytes the viewer rejects, and a viewer that throws, show the binary placeholder in this
 * area alone rather than the whole file panel failing.
 */
function ArtifactViewer(props: {
  viewer: FileViewer
  path: string
  size: string
  content: FileContent
  onDetails: (content: FileContent, details: readonly string[]) => void
  onError: (content: FileContent, reason?: string) => void
}) {
  // Checked together, so the check only ever reads bytes freshly decoded, never ones the viewer has moved away. The
  // callbacks name the content these bytes came from, so a viewer that answers after a reread changes nothing.
  const decoded = createMemo(() => {
    const content = props.content
    const bytes = bytesFromContent(content)

    return {
      bytes,
      problem: props.viewer.problem?.(bytes),
      onDetails: (details: readonly string[]) => props.onDetails(content, details),
      onError: (reason?: string) => props.onError(content, reason),
    }
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
          untrack(decoded).onError()

          return <ArtifactBinary path={props.path} size={props.size} />
        }}
      >
        <Dynamic
          component={props.viewer.View}
          bytes={decoded().bytes}
          onDetails={decoded().onDetails}
          onError={decoded().onError}
        />
      </ErrorBoundary>
    </Show>
  )
}

function ArtifactBinary(props: { path: string; size: string; reason?: string }) {
  const ctx = usePlugin()

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
