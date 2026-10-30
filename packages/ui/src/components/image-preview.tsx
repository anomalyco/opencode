import { Dialog as Kobalte, useDialogContext } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, createMemo, createSignal, on, onCleanup, Show } from "solid-js"
import { useDialogLayer } from "../context/dialog"
import { useI18n } from "../context/i18n"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { frameLoop, prefersReducedMotion, Spring, type DurationOptions } from "../motion"
import {
  createFlight,
  elementFrame,
  FLIGHT_SPRING,
  flightStyle,
  intersect,
  KICK,
  type Box,
  type FlightFrame,
} from "./image-flight"
import {
  clampView,
  detailScale,
  FIT_VIEW,
  maxScale,
  panBy,
  viewBox,
  wheelZoomFactor,
  zoomAt,
  type ZoomView,
} from "./image-zoom"

export interface ImagePreviewProps {
  src: string
  alt?: string
  /** The image on the page that the preview grows out of and shrinks back into. */
  origin?: HTMLElement
  /**
   * A video on the page to show instead of the image. The preview borrows this element, so it keeps playing as it
   * flies out of its place and back, and returns it once the close lands.
   */
  video?: HTMLVideoElement
}

const STEP = Math.SQRT2

// How far up from its bottom edge a video keeps its own controls, whose drag scrubs rather than pans.
const CONTROLS = 56

// Without a flight (reduced motion, or no thumbnail to fly to), the preview only fades.
const fade = { duration: 0.15, bounce: 0 }

// How long the dialog stays mounted after a close starts, in milliseconds: the flight lands and hands the image back
// to the page well within this.
const exitDuration = Math.max(FLIGHT_SPRING.duration, fade.duration) * 3200

const CENTER = { x: 0, y: 0 }

export function ImagePreview(props: ImagePreviewProps) {
  const i18n = useI18n()
  const dialog = useDialogContext()
  let root!: HTMLDivElement
  let scrim!: HTMLDivElement
  let content!: HTMLDivElement
  let viewport!: HTMLDivElement
  // For a video, an empty canvas of its size: the box it fits to in the window.
  let image!: HTMLImageElement | HTMLCanvasElement
  let standIn: HTMLImageElement | undefined
  // Where a borrowed video was on the page, holding its size until it comes back.
  let holder: HTMLElement | undefined
  let surface!: HTMLDivElement
  let edge!: HTMLDivElement
  let close: HTMLButtonElement | undefined
  // Nothing shows until the image has loaded and the preview knows where it lands; while flying, a stand-in image and
  // its shadow travel above the dialog in place of the real one.
  const [stage, setStage] = createSignal<"pending" | "flying" | "rest">("pending")

  // The flight under way: where the stand-in is laid out (the flight only transforms and clips it), the springs, and
  // what happens when it lands.
  let course: { at: Box; flight: ReturnType<typeof createFlight>; landed: () => void } | undefined

  const dim = Spring.fromDuration(0, FLIGHT_SPRING)
  // Once a close lands, the stand-in fades out over the image the page shows again, so whatever the page draws over
  // its own image (a fade under a sticky bar, say) comes in softly instead of in one frame.
  const veil = Spring.fromDuration(1, FLIGHT_SPRING)

  // How far the flight has lifted off the page, as last painted: the origin's outline fades out as it rises.
  let lift = 0
  // Without a flight (reduced motion, or nothing on the page to fly to) the preview only fades with the backdrop.
  let plain = false
  let stop: (() => void) | undefined
  const [view, setView] = createSignal(FIT_VIEW)
  const [fitRatio, setFitRatio] = createSignal(1)
  const [drag, setDrag] = createSignal<{ id: number; x: number; y: number }>()
  // Whether the press that ends in a click began on the backdrop around the image and stayed put. A pan captures the
  // pointer, so its click lands on the backdrop wherever it began.
  let backdrop = false
  // Whether the pan under way has moved, so the click that ends it neither closes the preview nor plays the video.
  let panned = false
  // Where an eased zoom is heading, so repeated steps build on the destination rather than the frame in flight.
  const [goal, setGoal] = createSignal(FIT_VIEW)
  const glide = [1, 0, 0].map((value) => Spring.fromDuration(value, FLIGHT_SPRING))
  let gliding: (() => void) | undefined

  const percent = createMemo(() => new Intl.NumberFormat(i18n.locale(), { style: "percent", maximumFractionDigits: 0 }))

  const natural = () =>
    image instanceof HTMLImageElement
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : { width: image.width, height: image.height }

  // A video zooms inside its own frame, so its controls stay where they are; an image zooms out across the window.
  const bounds = () => ({
    width: image.offsetWidth,
    height: image.offsetHeight,
    viewportWidth: props.video ? image.offsetWidth : viewport.clientWidth,
    viewportHeight: props.video ? image.offsetHeight : viewport.clientHeight,
    maxScale: maxScale(fitRatio()),
  })

  // The fitted size, read when the preview lays out rather than on every frame of a glide.
  let size = { width: 0, height: 0 }

  const show = (next: ZoomView) => {
    setView(next)

    if (props.video) {
      props.video.style.setProperty("object-view-box", viewBox(next, size, natural()))

      return
    }

    image.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`
  }

  const settle = () => {
    gliding?.()
    gliding = undefined
  }

  // Pinch, wheel and drag follow the hand directly and take over from an eased zoom mid-flight.
  const follow = (next: ZoomView) => {
    settle()
    setGoal(next)
    show(next)
  }

  // Scale and offsets ride springs of one shape, so the point under the pointer stays put; a new target mid-glide
  // keeps the velocity it has.
  const ease = (target: ZoomView) => {
    setGoal(target)

    if (prefersReducedMotion()) return follow(target)

    if (!gliding) [view().scale, view().x, view().y].forEach((value, index) => glide[index].snap(value))
    ;[target.scale, target.x, target.y].forEach((value, index) => glide[index].set(value))
    gliding ??= frameLoop.add((dt) => {
      const [scale, x, y] = glide.map((spring) => spring.step(dt))
      show({ scale, x, y })

      if (!glide.every((spring) => spring.resting)) return true
      gliding = undefined

      return false
    })
  }

  const step = (factor: number) => ease(zoomAt(goal(), goal().scale * factor, CENTER, bounds()))

  // Kobalte keeps the content mounted while an exit animation runs; the dialog stack waits for the flight too.
  const layer = useDialogLayer()
  const [exit, setExit] = createSignal(0)

  const holdExit = () => {
    setExit(exitDuration)
    layer?.setExitDuration(exit())
  }

  holdExit()

  const reveal = async () => {
    if (image instanceof HTMLImageElement) await Promise.all([image.decode(), standIn?.decode()]).catch(() => undefined)

    if (stage() !== "pending" || !dialog.isOpen()) return
    const from = prefersReducedMotion() ? undefined : originFrame()

    if (props.video) borrow(props.video)
    holdExit()
    dimTo(1, from ? FLIGHT_SPRING : fade)

    if (!from) {
      plain = true

      if (props.video) place(fitted())
      paint()
      setStage("rest")

      return run()
    }

    const flight = createFlight(from)
    const rest = restFrame()
    flight.to(rest, KICK.open, FLIGHT_SPRING)
    course = { at: place(fitted()), flight, landed: () => setStage("rest") }
    hideOrigin()
    paint()
    setStage("flying")
    run()
  }

  const dismiss = () => {
    // A video eases back to its whole frame on the way home; an image flies as it is shown.
    if (props.video) ease(FIT_VIEW)
    else settle()

    if (stage() === "pending") return
    const to = prefersReducedMotion() ? undefined : originFrame()
    dimTo(0, to ? FLIGHT_SPRING : fade)

    if (!to) {
      plain = true

      return run()
    }

    // A close mid-open turns the flight around where it is, keeping its velocity.
    if (!course) {
      const rest = restFrame()
      course = { at: place(fitted()), flight: createFlight(rest), landed: showOrigin }
    }

    course.flight.to(to, KICK.close, FLIGHT_SPRING)
    course.landed = () => {
      showOrigin()

      if (props.video) return giveBack()
      veil.omega = (2 * Math.PI) / (FLIGHT_SPRING.duration * 0.75)
      veil.set(0)
    }

    hideOrigin()
    paint()
    setStage("flying")
    run()
  }

  const dimTo = (target: number, spring: DurationOptions) => {
    dim.omega = (2 * Math.PI) / spring.duration
    dim.zeta = 1 - spring.bounce
    dim.set(target)
  }

  // One job on the shared frame loop steps the flight and the backdrop together and writes them straight to the DOM.
  const run = () => {
    stop ??= frameLoop.add((dt) => {
      const flying = course?.flight.step(dt)
      dim.step(dt)
      veil.step(dt)
      paint()

      // The real image takes over only once the panel holding it is fully opaque, so its brightness doesn't step.
      if (course && !flying && dim.resting) {
        const landed = course.landed
        course = undefined
        landed()
      }

      if (course || !dim.resting || !veil.resting) return true
      stop = undefined

      // A video that faded out rather than flying home goes back once it has.
      if (!dialog.isOpen()) giveBack()

      return false
    })
  }

  // The image flies as a stand-in over the preview; a video flies itself and stays where it lands.
  const flyer = () => (props.video ? holder && props.video : standIn)

  const paint = () => {
    const flying = flyer()
    scrim.style.opacity = String(dim.value)
    surface.style.opacity = course ? "1" : "0"

    if (flying) flying.style.opacity = String(plain ? dim.value : veil.value)

    if (course) {
      const frame = course.flight.frame()
      const style = flightStyle(course.at, frame)

      if (flying) {
        flying.style.transform = style.transform
        flying.style.clipPath = style.clipPath
      }

      // The shadow and the outline are leaf boxes, so sizing them every frame stays cheap; scaling them instead would
      // stretch their corners and shadow.
      layout(surface, frame.surface, frame.surfaceRadius)
      surface.style.setProperty("--image-preview-lift", String(frame.lift))
      layout(edge, frame.clip, frame.radius)
      lift = frame.lift
    }

    // Flying, the controls arrive as the image lifts; without a flight they fade with the backdrop.
    content.style.opacity = String(plain ? dim.value : course ? lift ** 2 : dim.value ** 2)
    edge.style.opacity = String((1 - lift) * veil.value)
  }

  const place = (box: Box) => {
    const flying = flyer()

    if (flying)
      Object.assign(flying.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      })

    return box
  }

  // Moves the video into the preview, leaving a box of its size in its place to fly back to.
  const borrow = (video: HTMLVideoElement) => {
    const rect = video.getBoundingClientRect()
    holder = document.createElement("div")
    Object.assign(holder.style, {
      flex: "none",
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderRadius: getComputedStyle(video).borderTopLeftRadius,
    })
    video.before(holder)
    root.moveBefore(video, null)
  }

  const giveBack = () => {
    const video = props.video

    if (!video || !holder) return

    // A page that closed under the preview, such as its tab, has nowhere to take the video back: let it go.
    if (holder.isConnected && holder.parentElement) holder.parentElement.moveBefore(video, holder)
    else dispose(video)
    holder.remove()
    holder = undefined
    ;["left", "top", "width", "height", "opacity", "transform", "clip-path", "object-view-box"].forEach((property) =>
      video.style.removeProperty(property),
    )
  }

  // The image as shown now, zoomed and panned and cropped to the viewport. There is no panel: the image is the surface.
  const restFrame = (): FlightFrame => {
    const shown = image.getBoundingClientRect()
    const clip = intersect(shown, viewport.getBoundingClientRect())
    const cropped = clip.width < shown.width - 0.5 || clip.height < shown.height - 0.5
    const radius = cropped ? 0 : parseFloat(getComputedStyle(image).borderTopLeftRadius) * scale()

    return { image: shown, clip, radius, surface: clip, surfaceRadius: radius, lift: 1 }
  }

  // The origin's frame, cropped to the part the page shows, or nothing when it is gone or out of sight.
  const originFrame = () => {
    const origin = home()

    if (!origin?.isConnected || !natural().width) return
    const rect = origin.getBoundingClientRect()

    if (!rect.width || !rect.height) return
    // The dialog stack portals the preview with its overlay; both sit over the page it looks through.
    const visible = visibleBox(origin, root.closest("[data-dialog-layer]")?.parentElement ?? root)

    if (!visible) return
    const style = getComputedStyle(origin)
    // An image's outline is often an overlay, since an inset shadow does not paint over an <img>. A video brings its
    // own.
    edge.style.boxShadow = props.video
      ? "none"
      : ([style.boxShadow, getComputedStyle(origin, "::after").boxShadow].find((shadow) => shadow !== "none") ?? "none")

    return elementFrame(rect, natural(), style.objectFit, parseFloat(style.borderTopLeftRadius) || 0, visible)
  }

  // The image's fitted layout box, wherever zoom has moved it. A video zooms inside its box, which stays put.
  const fitted = (): Box => {
    const shown = image.getBoundingClientRect()
    const offset = props.video ? CENTER : view()

    return {
      x: shown.x + shown.width / 2 - offset.x - image.offsetWidth / 2,
      y: shown.y + shown.height / 2 - offset.y - image.offsetHeight / 2,
      width: image.offsetWidth,
      height: image.offsetHeight,
    }
  }

  const scale = () => (props.video ? 1 : view().scale)
  const home = () => holder ?? props.origin ?? props.video
  const hideOrigin = () => home()?.setAttribute("data-image-preview-origin", "")
  const showOrigin = () => home()?.removeAttribute("data-image-preview-origin")

  onCleanup(() => {
    stop?.()
    settle()
    showOrigin()
    giveBack()
    document.body.removeAttribute("data-image-preview-closing")
  })

  createEffect(
    on(
      () => dialog.isOpen(),
      (open) => {
        // See image-preview.css: the body takes clicks again while the closing flight holds the dialog mounted.
        document.body.toggleAttribute("data-image-preview-closing", !open)

        if (!open) dismiss()
      },
      { defer: true },
    ),
  )

  // From the center of the box zoom is measured in: the window's for an image, the frame's for a video.
  const point = (event: MouseEvent) => {
    const rect = (props.video ? image : viewport).getBoundingClientRect()

    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
  }

  const measure = () => {
    if (!natural().width || !image.offsetWidth) return
    size = { width: image.offsetWidth, height: image.offsetHeight }
    setFitRatio(size.width / natural().width)
    follow(clampView(view(), bounds()))

    if (!props.video) return

    // A video is ready as soon as the preview has laid out its box.
    if (stage() === "pending") return void reveal()

    if (holder && !course) place(fitted())
  }

  createResizeObserver(() => [viewport, image], measure)

  createEffect(
    on(
      () => props.src,
      () => follow(FIT_VIEW),
      { defer: true },
    ),
  )

  const detail = (event: MouseEvent) => {
    if (goal().scale > 1) return ease(FIT_VIEW)
    ease(zoomAt(goal(), detailScale(fitRatio()), point(event), bounds()))
  }

  const grab = (event: PointerEvent, target: HTMLElement) => {
    if (event.button !== 0 || view().scale <= 1) return
    event.preventDefault()
    target.setPointerCapture(event.pointerId)
    setDrag({ id: event.pointerId, x: event.clientX, y: event.clientY })
  }

  const pan = (event: PointerEvent) => {
    const current = drag()

    if (current?.id !== event.pointerId) return
    backdrop = false
    panned = true
    setDrag({ id: current.id, x: event.clientX, y: event.clientY })
    follow(panBy(view(), { x: event.clientX - current.x, y: event.clientY - current.y }, bounds()))
  }

  const release = (event: PointerEvent) => {
    if (drag()?.id === event.pointerId) setDrag(undefined)
  }

  if (props.video) {
    const video = props.video
    makeEventListener(video, "pointerdown", (event: PointerEvent) => {
      panned = false

      if (holder && event.clientY < video.getBoundingClientRect().bottom - CONTROLS) grab(event, video)
    })
    makeEventListener(video, "pointermove", pan)
    makeEventListener(video, "pointerup", release)
    makeEventListener(video, "pointercancel", release)
    makeEventListener(video, "dblclick", (event: MouseEvent) => holder && detail(event))
    makeEventListener(
      video,
      "click",
      (event: MouseEvent) => {
        if (!panned) return
        panned = false
        event.preventDefault()
        event.stopImmediatePropagation()
      },
      { capture: true },
    )
  }

  // The preview owns zoom gestures while it is open: the page behind must neither scroll nor zoom the whole window.
  makeEventListener(
    window,
    "wheel",
    (event: WheelEvent) => {
      const inside =
        event.target instanceof Node && (viewport.contains(event.target) || (!!holder && event.target === props.video))

      const zoom = event.ctrlKey || event.metaKey

      if (!inside && !zoom) return
      event.preventDefault()
      event.stopPropagation()

      if (!inside) return
      const current = view()

      if (zoom) {
        follow(zoomAt(current, current.scale * wheelZoomFactor(pixels(event, event.deltaY)), point(event), bounds()))

        return
      }

      const horizontal = event.shiftKey && event.deltaX === 0
      follow(
        panBy(
          current,
          {
            x: -pixels(event, horizontal ? event.deltaY : event.deltaX),
            y: horizontal ? 0 : -pixels(event, event.deltaY),
          },
          bounds(),
        ),
      )
    },
    { passive: false, capture: true },
  )

  // Captured ahead of the desktop shell, which zooms the whole window on the same shortcuts.
  makeEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      const bare = !event.metaKey && !event.ctrlKey && !event.altKey

      if (bare && event.key === " " && props.video && holder) {
        event.preventDefault()
        event.stopPropagation()

        if (props.video.paused) return void props.video.play().catch(() => undefined)

        return props.video.pause()
      }

      const action = bare ? (event.key === "0" ? "fit" : undefined) : event.altKey ? undefined : shortcut(event.key)

      if (!action) return
      event.preventDefault()
      event.stopPropagation()

      if (action === "fit") return ease(FIT_VIEW)
      step(action === "in" ? STEP : 1 / STEP)
    },
    { capture: true },
  )

  return (
    <div
      ref={root}
      data-component="image-preview"
      data-stage={stage()}
      // Zoomed in, the first Escape zooms back out; the dialog stack leaves it to the preview.
      data-owns-escape={goal().scale > 1 ? "" : undefined}
      style={{ "--image-preview-exit": `${exit()}ms` }}
    >
      <div ref={scrim} data-slot="image-preview-scrim" />
      <Kobalte.Content
        ref={content}
        data-slot="image-preview-content"
        onOpenAutoFocus={(event) => {
          // Open with focus on Close, as before, rather than on the zoom controls that precede it.
          event.preventDefault()
          close?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (goal().scale <= 1) return
          event.preventDefault()
          ease(FIT_VIEW)
        }}
        // A borrowed video sits over the preview rather than in it; using its controls keeps the preview open.
        onInteractOutside={(event) => {
          if (props.video && event.target === props.video) event.preventDefault()
        }}
        onPointerDown={(event: PointerEvent) => {
          backdrop = event.target === content || event.target === viewport
        }}
        onClick={(event: MouseEvent) => {
          // The preview fills the window, so a click on the backdrop around the image lands here rather than outside.
          if (!backdrop || (event.target !== content && event.target !== viewport)) return
          dialog.close()
        }}
      >
        <div
          ref={viewport}
          data-slot="image-preview-body"
          data-zoomed={view().scale > 1 ? "" : undefined}
          data-dragging={drag() ? "" : undefined}
          onDblClick={detail}
          onPointerDown={(event) => grab(event, viewport)}
          onPointerMove={pan}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <Show
            when={props.video}
            fallback={
              <img
                ref={(element) => (image = element)}
                src={props.src}
                alt={props.alt ?? i18n.t("ui.imagePreview.alt")}
                data-slot="image-preview-image"
                draggable={false}
                onLoad={() => {
                  measure()
                  void reveal()
                }}
                onError={() => void reveal()}
              />
            }
          >
            {(video) => (
              <canvas
                ref={(element) => (image = element)}
                data-slot="image-preview-image"
                width={video().videoWidth}
                height={video().videoHeight}
              />
            )}
          </Show>
        </div>
        <div data-slot="image-preview-controls">
          <IconButton
            data-slot="image-preview-zoom-out"
            icon={<Icon name="minus" />}
            variant="ghost"
            aria-label={i18n.t("ui.imagePreview.zoomOut")}
            onClick={() => step(1 / STEP)}
          />
          <Button
            data-slot="image-preview-zoom-level"
            variant="ghost-muted"
            size="small"
            aria-label={i18n.t("ui.imagePreview.zoomToFit")}
            title={i18n.t("ui.imagePreview.zoomToFit")}
            onClick={() => ease(FIT_VIEW)}
          >
            {percent().format(view().scale * fitRatio())}
          </Button>
          <IconButton
            data-slot="image-preview-zoom-in"
            icon={<Icon name="plus" />}
            variant="ghost"
            aria-label={i18n.t("ui.imagePreview.zoomIn")}
            onClick={() => step(STEP)}
          />
          <div data-slot="image-preview-divider" />
          <Kobalte.CloseButton
            ref={close}
            data-slot="image-preview-close"
            as={IconButton}
            icon={<Icon name="close" />}
            variant="ghost"
            aria-label={i18n.t("ui.common.close")}
          />
        </div>
      </Kobalte.Content>
      <div data-slot="image-preview-surface" ref={surface} />
      <Show when={!props.video}>
        <img data-slot="image-preview-flight" src={props.src} alt="" aria-hidden="true" ref={standIn} />
      </Show>
      <div data-slot="image-preview-edge" ref={edge} />
    </div>
  )
}

// The part of `origin` the page under `preview` shows: inside its clipping ancestors and the window, and clear of
// anything drawn over its top or bottom, such as a sticky title bar. Nothing when none of it shows.
function visibleBox(origin: HTMLElement, preview: Element): Box | undefined {
  const clipped = ancestors(origin).reduce(
    (box: Box, element) => {
      const style = getComputedStyle(element)

      if (style.overflowX === "visible" && style.overflowY === "visible") return box

      return intersect(box, element.getBoundingClientRect())
    },
    intersect(origin.getBoundingClientRect(), { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }),
  )

  const rows = Math.floor(clipped.height)

  if (!clipped.width || rows < 1) return
  const x = clipped.x + clipped.width / 2

  // The origin is hidden while the preview flies, so the page shows it where the topmost element under the preview
  // holds it.
  const shows = (y: number) =>
    document
      .elementsFromPoint(x, y)
      .find((element) => !preview.contains(element))
      ?.contains(origin) ?? false

  const top = covered(rows, (row) => shows(clipped.y + row + 0.5))

  if (top === rows) return
  const bottom = covered(rows - top, (row) => shows(clipped.y + clipped.height - row - 0.5))

  return { x: clipped.x, y: clipped.y + top, width: clipped.width, height: clipped.height - top - bottom }
}

function ancestors(element: HTMLElement) {
  const list: HTMLElement[] = []

  for (let parent = element.parentElement; parent; parent = parent.parentElement) list.push(parent)

  return list
}

// How many of `rows`, counted in from an edge, are covered before the first that shows; a covering bar is one piece.
function covered(rows: number, shows: (row: number) => boolean) {
  let low = 0
  let high = rows

  while (low < high) {
    const middle = Math.floor((low + high) / 2)

    if (shows(middle)) {
      high = middle
      continue
    }

    low = middle + 1
  }

  return low
}

function dispose(video: HTMLVideoElement) {
  video.pause()
  video.remove()
  video.removeAttribute("src")
  video.srcObject = null
  video.load()
}

function layout(element: HTMLElement, frame: Box, radius: number) {
  Object.assign(element.style, {
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`,
    borderRadius: `${radius}px`,
  })
}

function shortcut(key: string) {
  if (key === "=" || key === "+") return "in"

  if (key === "-" || key === "_") return "out"

  if (key === "0") return "fit"
}

function pixels(event: WheelEvent, delta: number) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * window.innerHeight

  return delta
}
