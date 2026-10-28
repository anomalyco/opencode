import { Dialog as Kobalte, useDialogContext } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { useI18n } from "../context/i18n"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { frameLoop, prefersReducedMotion, Spring } from "../motion"
import { FLIGHT_SPRING } from "./image-flight"
import {
  clampView,
  detailScale,
  FIT_VIEW,
  panBy,
  wheelPixels,
  wheelZoomFactor,
  zoomAt,
  zoomShortcut,
  type ZoomView,
} from "./image-zoom"

export interface DiagramPreviewProps {
  /** The diagram to show, which the preview takes over: pass a copy of one still on the page. */
  svg: SVGSVGElement
}

const STEP = Math.SQRT2

// How far one arrow key press pans, as a share of the window; Shift pans a whole window.
const ARROW_PAN = 0.15

// How far a diagram zooms in past the size it was drawn at: its labels are crisp at any size, so a few times is enough
// to read the smallest.
const MAX_ZOOM = 4

// The canvas around the diagram at its natural size, in pixels.
const PADDING = 24

const CENTER = { x: 0, y: 0 }

/**
 * A diagram maximized over the page, zoomed and panned like an image preview. The diagram stays a live SVG, so it is
 * redrawn sharp at every zoom and keeps the page's fonts and theme.
 */
export function DiagramPreview(props: DiagramPreviewProps) {
  const i18n = useI18n()
  const dialog = useDialogContext()
  let viewport!: HTMLDivElement
  let canvas!: HTMLDivElement
  let close: HTMLButtonElement | undefined
  const [view, setView] = createSignal(FIT_VIEW)
  const [goal, setGoal] = createSignal(FIT_VIEW)
  const [fitRatio, setFitRatio] = createSignal(1)
  const [drag, setDrag] = createSignal<{ id: number; x: number; y: number }>()
  // Whether the press that ends in a click began on the backdrop around the diagram, and whether a pan moved since.
  let backdrop = false
  let panned = false
  const glide = [1, 0, 0].map((value) => Spring.fromDuration(value, FLIGHT_SPRING))
  let gliding: (() => void) | undefined

  const percent = createMemo(() => new Intl.NumberFormat(i18n.locale(), { style: "percent", maximumFractionDigits: 0 }))

  const bounds = () => ({
    width: canvas.offsetWidth,
    height: canvas.offsetHeight,
    viewportWidth: viewport.clientWidth,
    viewportHeight: viewport.clientHeight,
    maxScale: Math.max(1, MAX_ZOOM / fitRatio()),
  })

  const show = (next: ZoomView) => {
    setView(next)
    canvas.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.scale})`
  }

  const settle = () => {
    gliding?.()
    gliding = undefined
  }

  onCleanup(settle)

  // Pinch, wheel and drag follow the hand directly and take over from an eased zoom mid-flight.
  const follow = (next: ZoomView) => {
    settle()
    setGoal(next)
    show(next)
  }

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

  // Fits the diagram to the window without enlarging it past the size it was drawn at, keeping the zoom it has. The
  // padding around it shrinks with it.
  const measure = () => {
    const width = props.svg.width.baseVal.value
    const height = props.svg.height.baseVal.value

    // The window's own padding is where a zoomed diagram fades out, so a fitted one stays inside it.
    const inset = parseFloat(getComputedStyle(viewport).paddingLeft) * 2
    const room = { width: viewport.clientWidth - inset, height: viewport.clientHeight - inset }

    if (room.width <= 0 || room.height <= 0) return
    const fit = Math.min(1, room.width / (width + PADDING * 2), room.height / (height + PADDING * 2))
    canvas.style.padding = `${PADDING * fit}px`
    props.svg.style.width = `${width * fit}px`
    props.svg.style.height = `${height * fit}px`
    setFitRatio(fit)
    follow(clampView(view(), bounds()))
  }

  // Pele sizes the inline diagram to its column; here the preview sizes it.
  props.svg.style.maxWidth = "none"

  createResizeObserver(() => viewport, measure)

  const point = (event: MouseEvent) => {
    const rect = viewport.getBoundingClientRect()

    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }
  }

  const detail = (event: MouseEvent) => {
    if (goal().scale > 1) return ease(FIT_VIEW)
    ease(zoomAt(goal(), detailScale(fitRatio()), point(event), bounds()))
  }

  const grab = (event: PointerEvent) => {
    panned = false

    if (event.button !== 0 || view().scale <= 1) return
    event.preventDefault()
    viewport.setPointerCapture(event.pointerId)
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

  // The preview owns zoom gestures while it is open: the page behind must neither scroll nor zoom the whole window.
  makeEventListener(
    window,
    "wheel",
    (event: WheelEvent) => {
      const inside = event.target instanceof Node && viewport.contains(event.target)
      const zoom = event.ctrlKey || event.metaKey

      if (!inside && !zoom) return
      event.preventDefault()
      event.stopPropagation()

      if (!inside) return
      const current = view()

      if (zoom) {
        follow(
          zoomAt(current, current.scale * wheelZoomFactor(wheelPixels(event, event.deltaY)), point(event), bounds()),
        )

        return
      }

      const horizontal = event.shiftKey && event.deltaX === 0
      follow(
        panBy(
          current,
          {
            x: -wheelPixels(event, horizontal ? event.deltaY : event.deltaX),
            y: horizontal ? 0 : -wheelPixels(event, event.deltaY),
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
      const arrow = bare ? arrowDirection(event.key) : undefined

      if (arrow) {
        event.preventDefault()
        event.stopPropagation()
        const distance = event.shiftKey ? 1 : ARROW_PAN

        return ease(
          panBy(
            goal(),
            { x: arrow.x * distance * viewport.clientWidth, y: arrow.y * distance * viewport.clientHeight },
            bounds(),
          ),
        )
      }

      const action = bare ? (event.key === "0" ? "fit" : undefined) : event.altKey ? undefined : zoomShortcut(event.key)

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
      data-component="diagram-preview"
      // Zoomed in, the first Escape zooms back out; the dialog stack leaves it to the preview.
      data-owns-escape={goal().scale > 1 ? "" : undefined}
    >
      <Kobalte.Content
        data-slot="diagram-preview-content"
        aria-label={i18n.t("ui.diagramPreview.label")}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          close?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (goal().scale <= 1) return
          event.preventDefault()
          ease(FIT_VIEW)
        }}
        onPointerDown={(event: PointerEvent) => {
          backdrop = event.target === viewport
        }}
        onClick={(event: MouseEvent) => {
          // The preview fills the window, so a click on the backdrop around the diagram lands here.
          if (!backdrop || panned || event.target !== viewport) return
          dialog.close()
        }}
      >
        <div
          ref={viewport}
          data-slot="diagram-preview-body"
          data-zoomed={view().scale > 1 ? "" : undefined}
          data-dragging={drag() ? "" : undefined}
          onDblClick={detail}
          onPointerDown={grab}
          onPointerMove={pan}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <div ref={canvas} data-slot="diagram-preview-canvas">
            {props.svg}
          </div>
        </div>
        <div data-slot="diagram-preview-controls">
          <IconButton
            data-slot="diagram-preview-zoom-out"
            icon={<Icon name="minus" />}
            variant="ghost"
            aria-label={i18n.t("ui.imagePreview.zoomOut")}
            onClick={() => step(1 / STEP)}
          />
          <Button
            data-slot="diagram-preview-zoom-level"
            variant="ghost-muted"
            size="small"
            aria-label={i18n.t("ui.imagePreview.zoomToFit")}
            title={i18n.t("ui.imagePreview.zoomToFit")}
            onClick={() => ease(FIT_VIEW)}
          >
            {percent().format(view().scale * fitRatio())}
          </Button>
          <IconButton
            data-slot="diagram-preview-zoom-in"
            icon={<Icon name="plus" />}
            variant="ghost"
            aria-label={i18n.t("ui.imagePreview.zoomIn")}
            onClick={() => step(STEP)}
          />
          <div data-slot="diagram-preview-divider" />
          <Kobalte.CloseButton
            ref={close}
            data-slot="diagram-preview-close"
            as={IconButton}
            icon={<Icon name="close" />}
            variant="ghost"
            aria-label={i18n.t("ui.common.close")}
          />
        </div>
      </Kobalte.Content>
    </div>
  )
}

// Arrow keys move the view over the diagram, so the diagram moves the other way.
function arrowDirection(key: string) {
  if (key === "ArrowLeft") return { x: 1, y: 0 }

  if (key === "ArrowRight") return { x: -1, y: 0 }

  if (key === "ArrowUp") return { x: 0, y: 1 }

  if (key === "ArrowDown") return { x: 0, y: -1 }
}
