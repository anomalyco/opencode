import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import type { EmbedProps, Embeds } from "@opencode/plugin/gui"
import type { Bridge } from "@opencode/plugin/gui/host"
import {
  createEmbedStillState,
  INITIAL_FLIGHT_STATE,
  selectFlightStill,
  selectStillOnscreen,
  selectStillUnchanged,
  transitionEmbedFlight,
  transitionEmbedStill,
  type EmbedFlightEffect,
  type EmbedFlightEvent,
  type EmbedFlightState,
  type EmbedStillEffect,
  type EmbedStillEvent,
  type EmbedStillState,
} from "./embed-flight-machine"
import {
  INITIAL_SNAPSHOT_STATE,
  selectPaintingUrl,
  selectSnapshotHidesNative,
  selectSnapshotNeedsSync,
  selectSnapshotUrl,
  transitionEmbedSnapshot,
  type EmbedSnapshotEffect,
  type EmbedSnapshotEvent,
  type EmbedSnapshotState,
} from "./embed-snapshot-machine"

const geometry =
  /^(inset|left|right|top|bottom|translate|transform|scale|rotate|margin|padding|flex|grid|gap|row-gap|column-gap)|(^|-)(width|height)$/

type Input = {
  readonly bridge: Bridge | undefined
  readonly zoom: () => number
  readonly dialog: () => boolean
  /** A panel is moving; native views would float unclipped over the app until it lands. */
  readonly moving: () => boolean
}

// Measuring runs every frame of a transition or a drag, so the events it sends without data are shared.
const OFFSCREEN_STILL_EVENT: EmbedStillEvent = Object.freeze({ type: "offscreen" })

const MOVING_STILL_EVENT: EmbedStillEvent = Object.freeze({ type: "motion.changed", moving: true })

const SETTLED_STILL_EVENT: EmbedStillEvent = Object.freeze({ type: "motion.changed", moving: false })

const FOCUSED_STILL_EVENT: EmbedStillEvent = Object.freeze({ type: "focus.changed", focused: true })

const BLURRED_STILL_EVENT: EmbedStillEvent = Object.freeze({ type: "focus.changed", focused: false })

const DISPOSED_EVENT = Object.freeze({ type: "disposed" } as const)

/** Main-process embeds laid out over the DOM box a plugin renders for them. */
export function createEmbeds(input: Input): Embeds {
  return {
    View: (props) => {
      const bridge = input.bridge

      // Without the desktop bridge there is no embed; the box still renders its children.
      if (!bridge) return <div class={props.class}>{props.children}</div>

      return <EmbedView {...props} input={input} bridge={bridge} />
    },
    capture: (id) => input.bridge?.capture(id) ?? Promise.resolve(undefined),
  }
}

function EmbedView(props: EmbedProps & { input: Input; bridge: Bridge }) {
  // A signal, not a store: the machines return frozen singletons and the same object when nothing changes.
  const [embedState, setEmbedState] = createSignal<{
    readonly documentVisible: boolean
    /** A still of the embed shown in the DOM while floating content covers the hidden native view. */
    readonly snapshot: EmbedSnapshotState
    /** The latest still of the shown page, which stands in for it while a panel flight hides the native view. */
    readonly still: EmbedStillState
    readonly flight: EmbedFlightState
  }>({
    documentVisible: typeof document === "undefined" || document.visibilityState === "visible",
    snapshot: INITIAL_SNAPSHOT_STATE,
    still: createEmbedStillState({
      id: props.id,
      page: props.page,
      focused: document.hasFocus(),
      reducedMotion: prefersReducedMotion(),
    }),
    flight: INITIAL_FLIGHT_STATE,
  })

  const current = () => untrack(embedState)
  const documentVisible = createMemo(() => embedState().documentVisible)
  // Decoded flight stills, kept decoded so a flight's first frame paints them without a blank decode.
  const decodedStills = new Map<string, HTMLImageElement>()

  let element: HTMLDivElement | undefined
  let frame: number | undefined
  let layout: string | undefined
  let until = 0
  // The embed the last layout went to; it hides when another one takes the box.
  let placed: string | undefined
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  let stillTimer: ReturnType<typeof setTimeout> | undefined
  let flightTimer: ReturnType<typeof setTimeout> | undefined
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })

  // Let the browser resolve colors, including custom themes using color formats
  // that Electron's color parser cannot read.
  const resolve = (color: string) => {
    if (!paint) return undefined
    paint.clearRect(0, 0, 1, 1)
    paint.fillStyle = color
    paint.fillRect(0, 0, 1, 1)
    const data = paint.getImageData(0, 0, 1, 1).data

    return [data[0], data[1], data[2], data[3]] as const
  }

  const revoke = (url: string) => {
    decodedStills.delete(url)
    URL.revokeObjectURL(url)
  }

  const dispatchSnapshot = (event: EmbedSnapshotEvent) => {
    const state = current()
    const next = transitionEmbedSnapshot(state.snapshot, event)

    if (next.state !== state.snapshot) setEmbedState({ ...state, snapshot: next.state })
    next.effects.forEach(runSnapshot)
  }

  const runSnapshot = (effect: EmbedSnapshotEffect) => {
    if (effect.type === "capture")
      return void Promise.try(() => props.bridge.capture(effect.id))
        .catch(() => undefined)
        .then(decode)
        .then((image) => dispatchSnapshot({ type: "capture.settled", attempt: effect.attempt, url: image?.src }))

    if (effect.type === "capture-timer.start")
      return startSnapshotTimer(effect.delayMs, { type: "capture.timeout", attempt: effect.attempt })

    if (effect.type === "paint-timer.start")
      return startSnapshotTimer(effect.delayMs, { type: "paint.timeout", attempt: effect.attempt })

    if (effect.type === "thaw-timer.start")
      return startSnapshotTimer(effect.delayMs, { type: "thaw.settled", attempt: effect.attempt })

    if (effect.type === "url.revoke") return revoke(effect.url)

    if (effect.type === "layout.schedule") return schedule()
    // One phase at a time owns a timer, so every stop clears the one slot.
    clearTimeout(snapshotTimer)
    snapshotTimer = undefined
  }

  const startSnapshotTimer = (delay: number, event: EmbedSnapshotEvent) => {
    clearTimeout(snapshotTimer)
    snapshotTimer = setTimeout(() => dispatchSnapshot(event), delay)
  }

  const dispatchStill = (event: EmbedStillEvent) => {
    const state = current()
    const next = transitionEmbedStill(state.still, event)

    if (next.state !== state.still) setEmbedState({ ...state, still: next.state })
    next.effects.forEach(runStill)
  }

  const runStill = (effect: EmbedStillEffect) => {
    // Main captures before the view hides, so the capture goes out in the same task as the motion that starts it.
    if (effect.type === "capture")
      return void Promise.try(() => props.bridge.capture(effect.id))
        .catch(() => undefined)
        .then(async (data) => {
          if (!data?.length) return dispatchStill({ type: "capture.failed", attempt: effect.attempt })

          // The page has most likely not changed: keep the decoded still.
          if (selectStillUnchanged(current().still, effect.attempt, data.length))
            return dispatchStill({ type: "capture.unchanged", attempt: effect.attempt })
          const image = await decode(data)

          if (!image) return dispatchStill({ type: "capture.failed", attempt: effect.attempt })
          image.alt = ""
          image.draggable = false
          image.className = "absolute max-w-none pointer-events-none select-none"
          decodedStills.set(image.src, image)
          dispatchStill({ type: "capture.decoded", attempt: effect.attempt, url: image.src, bytes: data.length })
        })

    if (effect.type === "warm-timer.start") {
      clearTimeout(stillTimer)
      stillTimer = setTimeout(() => dispatchStill({ type: "warm.due", attempt: effect.attempt }), effect.delayMs)

      return
    }

    if (effect.type === "capture-timer.start") {
      clearTimeout(stillTimer)
      stillTimer = setTimeout(() => dispatchStill({ type: "capture.timeout", attempt: effect.attempt }), effect.delayMs)

      return
    }

    if (effect.type === "url.revoke") return revoke(effect.url)
    // One phase at a time owns a timer, so every stop clears the one slot.
    clearTimeout(stillTimer)
    stillTimer = undefined
  }

  const dispatchFlight = (event: EmbedFlightEvent) => {
    const state = current()
    const next = transitionEmbedFlight(state.flight, event)

    if (next.state !== state.flight) setEmbedState({ ...state, flight: next.state })
    next.effects.forEach(runFlight)
  }

  const runFlight = (effect: EmbedFlightEffect) => {
    clearTimeout(flightTimer)
    flightTimer =
      effect.type === "landing-timer.start"
        ? setTimeout(() => dispatchFlight({ type: "landing.settled", attempt: effect.attempt }), effect.delayMs)
        : undefined
  }

  const hide = () => {
    if (placed) props.bridge.embed(placed)
    placed = undefined

    if (selectStillOnscreen(current().still)) dispatchStill(OFFSCREEN_STILL_EVENT)
  }

  // The native embed always paints above the DOM, so hide it while a floating
  // menu, select, or popover overlaps it. Tooltips are excluded.
  const covered = (rect: DOMRect) => {
    const floating = document.querySelectorAll('[data-popper-positioner]:not(:has([role="tooltip"]))')

    // An index loop: this runs every frame of a transition or a drag.
    for (let index = 0; index < floating.length; index++) {
      const r = floating[index].getBoundingClientRect()

      if (r.width > 0 && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top)
        return true
    }

    return false
  }

  // Main hides the native view at once, but a still reaches the screen only a few frames after it
  // enters the DOM, so wait for Element Timing to report the frame that presents it.
  const presentation = new PerformanceObserver((list) => {
    const url = selectPaintingUrl(current().snapshot)

    if (!url) return

    if (list.getEntries().some((entry) => "url" in entry && entry.url === url))
      dispatchSnapshot({ type: "snapshot.painted", url })
  })

  presentation.observe({ type: "element" })
  onCleanup(() => presentation.disconnect())

  const syncSnapshot = (id: string | undefined, shown: boolean, cover: boolean) => {
    if (selectSnapshotNeedsSync(current().snapshot, id, props.visible, shown, cover))
      dispatchSnapshot({ type: "sync", id, visible: props.visible, shown, covered: cover })
  }

  const measure = () => {
    if (!element) return
    const id = props.id

    if (!id) return hide()
    const rect = element.getBoundingClientRect()
    const zoom = props.input.zoom()
    const left = Math.round(rect.left * zoom)
    const top = Math.round(rect.top * zoom)
    const right = Math.round(rect.right * zoom)
    const bottom = Math.round(rect.bottom * zoom)
    const shown = props.visible && current().documentVisible && !props.input.moving()
    // A dialog's scrim covers the box like floating content does, so it dims a still of the page
    // instead of a blank box, and the page does not blink out and back as the dialog opens and closes.
    const cover = !!props.frozen || props.input.dialog() || covered(rect)

    // Keep the embed on screen as a still under the floating content. The native view
    // stays visible until the still is on screen, so the box never flashes blank.
    syncSnapshot(id, shown, cover)
    const visible = shown && !selectSnapshotHidesNative(current().snapshot, id, cover)

    // The cutout exposes the app backdrop outside the rounded card, not the embed inside it.
    const color =
      props.background ??
      getComputedStyle(element.closest(".bg-v2-background-bg-deep") ?? document.documentElement).backgroundColor

    const ring = props.radius ? cardRing(element) : undefined
    const viewport = { width: Math.round(window.innerWidth * zoom), height: Math.round(window.innerHeight * zoom) }

    const next = `${id}:${visible}:${left}:${top}:${right}:${bottom}:${viewport.width}:${viewport.height}:${color}:${ring?.color}:${ring?.width}:${window.devicePixelRatio}`

    if (next === layout) return
    layout = next

    const background = resolve(color)
    const border = ring && resolve(ring.color)

    if (placed !== id) hide()
    placed = id

    // The still lines up with the view's device-pixel-rounded bounds, so swapping one for the other moves nothing.
    if (visible)
      dispatchStill({
        type: "placement.changed",
        page: props.page,
        placement: {
          id,
          x: left / zoom - rect.left,
          y: top / zoom - rect.top,
          width: Math.max(0, right - left) / zoom,
          height: Math.max(0, bottom - top) / zoom,
        },
      })

    if (!visible && selectStillOnscreen(current().still)) dispatchStill(OFFSCREEN_STILL_EVENT)

    const box = {
      visible,
      bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      viewport,
      radius: Math.round((props.radius ?? 0) * zoom),
    }

    const backed = background ? { ...box, background } : box

    props.bridge.embed(
      id,
      ring && border && border[3] > 0 ? { ...backed, border: { color: border, width: ring.width * zoom } } : backed,
    )
  }

  const tick = () => {
    frame = undefined
    measure()

    if (performance.now() < until) frame = requestAnimationFrame(tick)
  }

  const schedule = (duration = 0) => {
    until = Math.max(until, performance.now() + duration)

    if (frame === undefined) frame = requestAnimationFrame(tick)
  }

  // A navigation or reload makes the kept still another page's, as does another embed taking the box.
  createEffect(
    on([() => props.id, () => props.page], ([id, page]) => dispatchStill({ type: "target.changed", id, page }), {
      defer: true,
    }),
  )
  createEffect(
    on(
      [
        props.input.zoom,
        props.input.dialog,
        props.input.moving,
        documentVisible,
        () => props.visible,
        () => props.id,
        () => props.frozen,
      ],
      () => {
        layout = undefined
        const moving = props.input.moving()
        const onscreen = selectStillOnscreen(current().still)
        // A flight paints the still in the view's place. One that starts with the view on screen, like a close, first
        // asks for a fresh still, before the view hides below; one that opens the pane shows the last still.
        dispatchStill(moving ? MOVING_STILL_EVENT : SETTLED_STILL_EVENT)
        dispatchFlight({ type: "sync", moving, visible: props.visible, onscreen })

        // A box that hides or loses its embed never shows its still again.
        if (!props.visible || !props.id) syncSnapshot(props.id, false, false)

        // The native views are not clipped by the retained panel's DOM. Hide before the next
        // animation frame so closing the panel cannot leave the embed above the app.
        if (!props.visible || !documentVisible() || moving || !props.id) return hide()
        schedule(300)
      },
    ),
  )
  // ResizeObserver runs after layout in the same frame; measuring here instead of on the next
  // animation frame keeps the native view in step with a region drag.
  createResizeObserver(() => element, measure)
  createEventListener(window, "resize", () => schedule(300))
  // A layout transition elsewhere, such as the chat column's width while the side pane opens, can
  // move the box without resizing it. Track it from when it actually runs, and settle on its end.
  createEventListener(document, "transitionrun", (event) => {
    if (geometry.test(event.propertyName)) schedule(300)
  })
  createEventListener(document, ["transitionend", "transitioncancel"], (event) => {
    if (geometry.test(event.propertyName)) schedule()
  })
  // Floating content portals directly into <body>; keep measuring briefly so
  // the positioner has settled before the overlap check runs.
  const portals = new MutationObserver(() => schedule(300))
  portals.observe(document.body, { childList: true })
  onCleanup(() => portals.disconnect())
  const appearance = new MutationObserver(() => schedule(300))
  appearance.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] })
  onCleanup(() => appearance.disconnect())
  createEventListener(window.matchMedia("(prefers-color-scheme: dark)"), "change", () => schedule(300))
  createEventListener(document, "visibilitychange", () =>
    setEmbedState({ ...current(), documentVisible: document.visibilityState === "visible" }),
  )

  // Stills follow the window's focus as main reports it: focus inside an embed blurs this document but not the window.
  createEventListener(window, "focus", () => dispatchStill(FOCUSED_STILL_EVENT))
  onCleanup(
    props.bridge.on((message) => {
      if (message.type === "focus") dispatchStill(message.focused ? FOCUSED_STILL_EVENT : BLURRED_STILL_EVENT)
    }),
  )
  onCleanup(
    observeReducedMotion(() =>
      dispatchStill({ type: "reduced-motion.changed", reducedMotion: prefersReducedMotion() }),
    ),
  )
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    hide()
    // Stops every timer and gives up every still, including ones still decoding.
    dispatchSnapshot(DISPOSED_EVENT)
    dispatchStill(DISPOSED_EVENT)
    dispatchFlight(DISPOSED_EVENT)
    decodedStills.clear()
  })

  const snapshotUrl = createMemo(() => selectSnapshotUrl(embedState().snapshot, props.id, props.visible))

  const flightStill = createMemo(() => selectFlightStill(embedState().flight, embedState().still, props.id, props.page))

  return (
    <div ref={element} class={props.class}>
      <Show when={flightStill()} keyed>
        {(still) => {
          const image = decodedStills.get(still.url)

          if (image)
            Object.assign(image.style, {
              left: `${still.x}px`,
              top: `${still.y}px`,
              width: `${still.width}px`,
              height: `${still.height}px`,
            })

          return <div class="absolute inset-0 overflow-hidden pointer-events-none">{image}</div>
        }}
      </Show>
      <Show when={snapshotUrl()}>
        {(url) => (
          <img
            src={url()}
            alt=""
            elementtiming="embed-snapshot"
            draggable={false}
            class="absolute inset-0 size-full pointer-events-none select-none"
          />
        )}
      </Show>
      {props.children}
    </div>
  )
}

// Decodes a JPEG still, so it paints in the frame it enters the DOM. Undefined when there is none or it cannot decode.
async function decode(data: Uint8Array | undefined) {
  if (!data?.length) return undefined
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "image/jpeg" }))
  const image = new Image()
  image.src = url

  const decoded = await image.decode().then(
    () => true,
    () => false,
  )

  if (decoded) return image
  URL.revokeObjectURL(url)

  return undefined
}

// The hairline ring (a zero-offset, zero-blur, spread-only shadow) of the nearest card around the box.
// The corner masks sit where it curves, so they redraw it.
function cardRing(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const shadow = getComputedStyle(node).boxShadow

    if (shadow === "none") continue

    return shadow
      .split(/,(?![^(]*\))/)
      .map((layer) => layer.trim().match(/^(.+?)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+([\d.]+)px$/))
      .flatMap((match) =>
        match && +match[2] === 0 && +match[3] === 0 && +match[4] === 0 && +match[5] > 0
          ? [{ color: match[1], width: +match[5] }]
          : [],
      )
      .at(0)
  }
}
