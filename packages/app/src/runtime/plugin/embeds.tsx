import { createEffect, createMemo, createSignal, on, onCleanup, Show, untrack } from "solid-js"
import { createEventListener } from "@solid-primitives/event-listener"
import { embedBounds, overlaps } from "./embed-geometry"
import { frameLoop, observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import type { EmbedProps, Embeds } from "@opencode/plugin/gui"
import type { Bridge, BridgeLayout } from "@opencode/plugin/gui/host"
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
  type KeptStill,
} from "./embed-flight-machine"
import {
  INITIAL_SNAPSHOT_STATE,
  selectPaintingUrl,
  selectSnapshotHidesNative,
  selectSnapshotNeedsSync,
  selectSnapshotUrl,
  selectSnapshotWantsStill,
  transitionEmbedSnapshot,
  type EmbedSnapshotEffect,
  type EmbedSnapshotEvent,
  type EmbedSnapshotState,
} from "./embed-snapshot-machine"

const geometry =
  /^(inset|left|right|top|bottom|translate|transform|scale|rotate|margin|padding|flex|grid|gap|row-?gap|column-?gap)|(?:width|height)$/i

const overlay = '[data-floating-overlay], [data-popper-positioner]:not(:has([role="tooltip"])), [aria-modal="true"], dialog[open], :popover-open'

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
  const [coverStill, setCoverStill] = createSignal<KeptStill>()

  let element: HTMLDivElement | undefined
  let frame: (() => void) | undefined
  let layout: string | undefined
  const motions = new Set<Animation>()
  let settlePosition: ((rect: DOMRectReadOnly) => void) | undefined
  // The embed the last layout went to; it hides when another one takes the box.
  let placed: string | undefined
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined
  let stillTimer: ReturnType<typeof setTimeout> | undefined
  let flightTimer: ReturnType<typeof setTimeout> | undefined
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })
  const colors = new Map<string, readonly [number, number, number, number]>()

  // Let the browser resolve colors, including custom themes using color formats
  // that Electron's color parser cannot read.
  const resolve = (color: string) => {
    if (!paint) return undefined
    const kept = colors.get(color)

    if (kept) return kept
    paint.clearRect(0, 0, 1, 1)
    paint.fillStyle = color
    paint.fillRect(0, 0, 1, 1)
    const data = paint.getImageData(0, 0, 1, 1).data

    const value = [data[0], data[1], data[2], data[3]] as const

    if (colors.size >= 4) colors.clear()
    colors.set(color, value)

    return value
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
    setCoverStill(undefined)
    frame?.()
    frame = undefined
    layout = undefined

    if (placed) props.bridge.embed(placed)
    placed = undefined

    if (selectStillOnscreen(current().still)) dispatchStill(OFFSCREEN_STILL_EVENT)
  }

  // The native embed always paints above the DOM, so hide it while a floating
  // menu, select, or popover overlaps it. Tooltips are excluded.
  const covered = (rect: DOMRect) => {
    if (!element) return false
    const floating = document.querySelectorAll(overlay)
    const layer = Number(element.closest<HTMLElement>("[data-dialog-layer]")?.dataset.dialogLayer ?? -1)

    // An index loop: this runs every frame of a transition or a drag.
    for (let index = 0; index < floating.length; index++) {
      if (floating[index].contains(element)) continue
      // A dialog's own backdrop, and those of the dialogs beneath it, are behind an embed inside it.
      const backdrop = floating[index].getAttribute("data-dialog-backdrop")

      if (backdrop !== null && Number(backdrop) <= layer) continue

      if (overlaps(rect, floating[index].getBoundingClientRect())) return true
    }

    // Surfaces portalled to the body after the embed's own root are above it even when nobody marked them, so an
    // unmarked menu or panel is covered rather than painted over.
    for (
      let portal = ancestorBelow(document.body, element)?.nextElementSibling;
      portal;
      portal = portal.nextElementSibling
    ) {
      if (!portal.querySelector('[role="tooltip"]') && floats(portal, rect, 3)) return true
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

  const scrollport = () => element?.parentElement?.closest<HTMLElement>("[data-embed-clip]")

  const measure = () => {
    if (!element) return
    const id = props.id

    if (!id) return
    const rect = element.getBoundingClientRect()
    const zoom = props.input.zoom()
    const bounds = embedBounds(rect, zoom)
    // A scaled preview scrolls the box inside an ancestor; only the part inside that scrollport is shown.
    const port = scrollport()
    const clip = port && scrollClip(port, rect, zoom)

    const shown =
      props.visible &&
      current().documentVisible &&
      !props.input.moving() &&
      (clip
        ? clip.width > 0 && clip.height > 0
        : bounds.width > 0 && bounds.height > 0 && overlaps(rect, { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }))

    // A dialog's scrim covers the box like floating content does, so it dims a still of the page
    // instead of a blank box, and the page does not blink out and back as the dialog opens and closes.
    const cover =
      !!props.frozen ||
      (props.input.dialog() && !element.closest('[role="dialog"], [role="alertdialog"], dialog[open]')) ||
      covered(clip ? new DOMRect(clip.x / zoom, clip.y / zoom, clip.width / zoom, clip.height / zoom) : rect)

    // The cutout exposes the app backdrop outside the rounded card, not the embed inside it.
    const color =
      props.background ??
      getComputedStyle(element.closest(".bg-v2-background-bg-deep") ?? document.documentElement).backgroundColor

    const ring = props.radius ? cardRing(element) : undefined
    const viewport = { width: Math.round(window.innerWidth * zoom), height: Math.round(window.innerHeight * zoom) }

    return { id, shown, cover, bounds, clip, color, ring, viewport, rect, zoom }
  }

  const place = (boxLayout: NonNullable<ReturnType<typeof measure>>) => {
    const { id, shown, cover, bounds, clip, color, ring, viewport, rect, zoom } = boxLayout
    syncSnapshot(id, shown, cover)
    const still = current().still
    const kept = still.status !== "disposed" && still.kept
    const snapshot = current().snapshot

    const warm =
      shown &&
      selectSnapshotWantsStill(snapshot, id, cover) &&
      kept &&
      kept.id === id &&
      kept.page === props.page &&
      kept.width === bounds.width / zoom &&
      kept.height === bounds.height / zoom
        ? kept
        : undefined

    setCoverStill(warm)
    const visible = shown && !selectSnapshotHidesNative(snapshot, id, cover, !!warm)

    const next = `${id}:${visible}:${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}:${clip?.x}:${clip?.y}:${clip?.width}:${clip?.height}:${viewport.width}:${viewport.height}:${color}:${ring?.color}:${ring?.width}:${window.devicePixelRatio}`

    if (next === layout) return
    layout = next

    const background = resolve(color)
    const border = ring && resolve(ring.color)

    placed = id

    // Electron takes integer DIPs. A DIP-rounded edge need not be an integer physical pixel on a scaled display.
    if (visible)
      dispatchStill({
        type: "placement.changed",
        page: props.page,
        placement: {
          id,
          x: bounds.x / zoom - rect.left,
          y: bounds.y / zoom - rect.top,
          width: bounds.width / zoom,
          height: bounds.height / zoom,
        },
      })

    if (!visible && selectStillOnscreen(current().still)) dispatchStill(OFFSCREEN_STILL_EVENT)

    const box: BridgeLayout = {
      visible,
      bounds,
      ...(clip && { clip }),
      viewport,
      radius: Math.round((props.radius ?? 0) * zoom),
    }

    const backed = background ? { ...box, background } : box

    props.bridge.embed(
      id,
      ring && border && border[3] > 0 ? { ...backed, border: { color: border, width: ring.width * zoom } } : backed,
    )
  }

  let measured: ReturnType<typeof measure>

  const tick = () => {
    frame = undefined

    if (measured) place(measured)

    motions.forEach((motion) => {
      if (motion.playState !== "running") motions.delete(motion)
    })

    if (motions.size) schedule()

    if (!motions.size && measured) settlePosition?.(measured.rect)

    return false
  }

  const schedule = () => {
    frame ??= frameLoop.addMeasured(() => { measured = measure() }, tick)
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

        if (placed && placed !== props.id) hide()
        schedule()
      },
    ),
  )
  createEffect(() => {
    if (!element || !props.visible || !props.id || !documentVisible() || props.input.moving()) return
    const box = element
    // Watch the layout spine, not the conversation subtree: a sibling changing width or a banner being inserted
    // can move a fixed-size pane. Only the portals outside the app root need subtree observation (menus and toasts).
    const sizes = new ResizeObserver(schedule)
    const nodes = new Set<Element>()
    const neighbors = new Set<Element>()
    const removeScroll = () => nodes.forEach(node => node.removeEventListener("scroll", schedule))

    const changes = new MutationObserver((records) => {
      if (!box.isConnected) {
        if (!nodes.size) return
        removeScroll()
        sizes.disconnect()
        changes.disconnect()
        changes.observe(document, { childList: true, subtree: true })
        hide()
        nodes.clear()

        return
      }

      if (
        !nodes.size ||
        records.some(
          (record) => record.type === "childList" && record.target instanceof Element && nodes.has(record.target),
        )
      )
        observe()
      schedule()
    })

    const observe = () => {
      removeScroll()
      nodes.clear()
      neighbors.clear()
      sizes.disconnect()
      changes.disconnect()

      if (!box.isConnected) {
        changes.observe(document, { childList: true, subtree: true })

        return
      }

      for (let node: Element | null = box; node; node = node.parentElement) {
        nodes.add(node)
        node.addEventListener("scroll", schedule, { passive: true })
        sizes.observe(node)
        changes.observe(node, { attributes: true, childList: node !== box })

        for (const sibling of node.parentElement?.children ?? []) {
          if (sibling === node) continue
          neighbors.add(sibling)
          sizes.observe(sibling)
          const portal = sibling.parentElement === document.body
          changes.observe(sibling, { attributes: true, childList: portal, characterData: portal, subtree: portal })
        }
      }
    }

    observe()

    const track = (target: Element) => {
      for (const motion of target.getAnimations()) {
        if (
          motion.effect instanceof KeyframeEffect &&
          motion.effect.target === target &&
          Number.isFinite(motion.effect.getComputedTiming().endTime) &&
          motion.effect.getKeyframes().some((key) => Object.keys(key).some((property) => geometry.test(property)))
        )
          motions.add(motion)
      }
    }

    // Web Animations do not send CSS animation events. A tight intersection root wakes on the first displaced
    // edge, then the animation itself drives the frames; no permanent frame job or patched Element.animate.
    let position: IntersectionObserver | undefined

    let previous: DOMRectReadOnly | undefined

    const anchor = (rect: DOMRectReadOnly, visible = rect, threshold = 1, calibrated = false) => {
      previous = rect
      position?.disconnect()
      const inset = [visible.top, window.innerWidth - visible.right, window.innerHeight - visible.bottom, visible.left]
      position = new IntersectionObserver(([entry]) => {
        if (!entry || !box.isConnected) return
        const next = entry.boundingClientRect

        if (next.x === rect.x && next.y === rect.y && next.width === rect.width && next.height === rect.height) {
          // With an ancestor scrollport the full box may never intersect. Pin the *visible* rectangle instead.
          if (!calibrated && entry.intersectionRatio > 0 && entry.intersectionRatio < 1)
            anchor(rect, entry.intersectionRect, entry.intersectionRatio * 0.999999, true)

          return
        }

        nodes.forEach(track)
        neighbors.forEach(track)
        schedule()

        if (motions.size) {
          position?.disconnect()
          previous = undefined

          return
        }

        anchor(next)
      }, { rootMargin: inset.map((n) => `${-Math.floor(n)}px`).join(" "), threshold })
      position.observe(box)
    }

    anchor(box.getBoundingClientRect())
    settlePosition = (rect) => {
      if (!previous || rect.x !== previous.x || rect.y !== previous.y || rect.width !== previous.width || rect.height !== previous.height) anchor(rect)
    }

    onCleanup(() => {
      position?.disconnect()
      settlePosition = undefined
    })
    createEventListener(document, ["transitionrun", "transitionstart", "animationstart"], (event) => {
      const target = event.target

      if (!(target instanceof Element) || (!nodes.has(target) && !neighbors.has(target) && !target.matches(overlay))) return
      track(target)

      schedule()
    })
    createEventListener(document, "scroll", schedule, { passive: true })
    const scale = () => window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    let density = scale()

    const changed = () => {
      density.removeEventListener("change", changed)
      density = scale()
      density.addEventListener("change", changed)
      schedule()
    }

    density.addEventListener("change", changed)
    onCleanup(() => density.removeEventListener("change", changed))
    createEventListener(window, "resize", schedule)
    createEventListener(document, "toggle", (event) => {
      if (event.target instanceof Element && event.target.matches("[popover], dialog")) schedule()
    }, true)
    createEventListener(window.matchMedia("(prefers-color-scheme: dark)"), "change", schedule)
    onCleanup(() => {
      removeScroll()
      motions.clear()
      changes.disconnect()
      sizes.disconnect()
    })
  })
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
    hide()
    // Stops every timer and gives up every still, including ones still decoding.
    dispatchSnapshot(DISPOSED_EVENT)
    dispatchStill(DISPOSED_EVENT)
    dispatchFlight(DISPOSED_EVENT)
    decodedStills.clear()
  })

  const snapshotUrl = createMemo(() => selectSnapshotUrl(embedState().snapshot, props.id, props.visible))

  // A warm still stays under a fresh capture until a frame has presented it.
  const flightStill = createMemo(
    () =>
      selectFlightStill(embedState().flight, embedState().still, props.id, props.page) ??
      (selectPaintingUrl(embedState().snapshot) || !snapshotUrl() ? coverStill() : undefined),
  )

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

// The child of `root` that contains `node`.
function ancestorBelow(root: Element, node: Element) {
  for (let current: Element | null = node; current; current = current.parentElement) {
    if (current.parentElement === root) return current
  }
}

// Whether a visible, positioned surface that takes input, `depth` levels into a portal at most, overlaps the box. A
// wrapper that lets input through is transparent: a full-window portal container never counts, only what it holds.
function floats(node: Element, rect: DOMRect, depth: number): boolean {
  // Marked surfaces were measured with their dialog layer.
  if (node.matches(overlay)) return false
  const style = getComputedStyle(node)

  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false

  if ((style.position === "fixed" || style.position === "absolute") && style.pointerEvents !== "none") {
    const box = node.getBoundingClientRect()

    if (box.width > 1 && box.height > 1 && overlaps(rect, box)) return true
  }

  return depth > 0 && Array.from(node.children).some((child) => floats(child, rect, depth - 1))
}

// The client box excludes the scrollbar track, including a left-side RTL scrollbar.
function scrollClip(port: HTMLElement, rect: DOMRect, zoom: number) {
  const area = port.getBoundingClientRect()
  const left = area.left + port.clientLeft
  const top = area.top + port.clientTop
  const x = Math.max(0, Math.round(rect.left * zoom), Math.ceil(left * zoom))
  const y = Math.max(0, Math.round(rect.top * zoom), Math.ceil(top * zoom))
  const right = Math.min(window.innerWidth, left + port.clientWidth)
  const bottom = Math.min(window.innerHeight, top + port.clientHeight)

  return {
    x,
    y,
    width: Math.max(0, Math.min(Math.round(rect.right * zoom), Math.floor(right * zoom)) - x),
    height: Math.max(0, Math.min(Math.round(rect.bottom * zoom), Math.floor(bottom * zoom)) - y),
  }
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
