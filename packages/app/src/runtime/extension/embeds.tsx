import { createEffect, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { prefersReducedMotion } from "@opencode/ui/motion"
import type { EmbedProps, Embeds } from "@opencode/gui-extensions/sdk"
import type { Bridge } from "@opencode/gui-extensions/sdk/bridge"

const geometry =
  /^(inset|left|right|top|bottom|translate|transform|scale|rotate|margin|padding|flex|grid|gap|row-gap|column-gap)|(^|-)(width|height)$/

type Input = {
  readonly bridge: Bridge | undefined
  readonly zoom: () => number
  readonly dialog: () => boolean
  /** A panel is moving; native views would float unclipped over the app until it lands. */
  readonly moving: () => boolean
}

// A decoded still of the page the embed showed, and where it sits in the box, in CSS pixels.
type Still = {
  id: string
  page: string | undefined
  x: number
  y: number
  width: number
  height: number
  url: string
  image: HTMLImageElement
}

/** Main-process embeds laid out over the DOM box an extension renders for them. */
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
  const [store, setStore] = createStore<{
    visible: boolean
    snapshot: { id: string; url: string; presented: boolean } | undefined
    still: Still | undefined
    flying: boolean
  }>({
    visible: typeof document === "undefined" || document.visibilityState === "visible",
    // A still of the embed shown in the DOM while floating content covers the hidden native view.
    snapshot: undefined,
    // The latest still of the shown page, which stands in for it while a panel flight hides the native view.
    still: undefined,
    flying: false,
  })

  let element: HTMLDivElement | undefined
  let frame: number | undefined
  let layout: string | undefined
  let until = 0
  let capturing: string | undefined
  let release: ReturnType<typeof setTimeout> | undefined
  // The embed the last layout went to; it hides when another one takes the box.
  let placed: string | undefined
  // Where the shown native view sits in the box, in CSS pixels; undefined while it is off screen.
  let onscreen: Omit<Still, "page" | "url" | "image"> | undefined
  let warming: ReturnType<typeof setTimeout> | undefined
  let landing: ReturnType<typeof setTimeout> | undefined
  let stilling: string | undefined
  // The kept still's JPEG length, and how long to wait before the next still.
  let bytes = 0
  let pause = 3000
  // Whether the window has focus, as main reports it: focus inside an embed blurs this document but not the window.
  let focused = document.hasFocus()
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

  const hide = () => {
    if (placed) props.bridge.embed(placed)
    placed = undefined
    onscreen = undefined
    clearTimeout(warming)
  }

  // A panel flight hides the native view, which no DOM box clips. Keep a recent still for it: one once the shown
  // view's layout settles, then more while it stays on screen and the window has focus, never one per frame. A page
  // that stops changing is captured less and less often.
  const warm = (delay: number) => {
    clearTimeout(warming)
    // Reduced motion lands panels at once, so no flight needs a still.
    warming = setTimeout(() => {
      if (onscreen && !props.input.moving() && !prefersReducedMotion() && focused) take()
    }, delay)
  }

  const take = () => {
    const placement = onscreen && { ...onscreen, page: props.page }

    if (!placement || stilling === placement.id) return
    stilling = placement.id
    void props.bridge
      .capture(placement.id)
      .catch(() => undefined)
      .then(async (data) => {
        // The same JPEG length as the still already kept: the page has most likely not changed.
        const unchanged = !!data && store.still?.id === placement.id && data.length === bytes
        bytes = data?.length ?? 0
        pause = unchanged ? Math.min(pause * 2, 60_000) : 3000

        if (unchanged) {
          if (stilling === placement.id) stilling = undefined

          if (onscreen?.id === placement.id) warm(pause)

          return
        }

        const url = data ? URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "image/jpeg" })) : undefined
        const image = new Image()

        if (url) image.src = url

        const ready =
          !!url &&
          (await image
            .decode()
            .then(() => true)
            .catch(() => false))

        // Another embed took the box, or the view was disposed, while this one captured.
        const current = stilling === placement.id

        if (current) stilling = undefined

        if (!url || !ready || !current || props.id !== placement.id || props.page !== placement.page) {
          if (url) URL.revokeObjectURL(url)

          if (current && onscreen?.id === placement.id) warm(pause)

          return
        }

        const previous = store.still?.url
        image.alt = ""
        image.draggable = false
        image.className = "absolute max-w-none pointer-events-none select-none"
        Object.assign(image.style, {
          left: `${placement.x}px`,
          top: `${placement.y}px`,
          width: `${placement.width}px`,
          height: `${placement.height}px`,
        })
        setStore("still", { ...placement, url, image })

        if (previous) URL.revokeObjectURL(previous)

        if (onscreen?.id === placement.id) warm(pause)
      })
  }

  const fly = (moving: boolean) => {
    clearTimeout(landing)

    if (moving) return setStore("flying", true)

    // A panel that landed closed is gone; one that landed open keeps the still under its view until the view paints.
    if (!props.visible) return setStore("flying", false)
    landing = setTimeout(() => setStore("flying", false), 150)
  }

  // The native embed always paints above the DOM, so hide it while a floating
  // menu, select, or popover overlaps it. Tooltips are excluded.
  const covered = (rect: DOMRect) =>
    Array.from(document.querySelectorAll('[data-popper-positioner]:not(:has([role="tooltip"]))')).some((el) => {
      const r = el.getBoundingClientRect()

      return r.width > 0 && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top
    })

  const replaceSnapshot = (next?: { id: string; url: string; presented: boolean }) => {
    if (store.snapshot?.url) URL.revokeObjectURL(store.snapshot.url)
    setStore("snapshot", next)
  }

  // Keep the embed on screen as a still under the floating content. The native view
  // stays visible until the still is on screen, so the box never flashes blank.
  const freeze = (id: string) => {
    clearTimeout(release)
    release = undefined

    if (store.snapshot?.id === id || capturing === id) return
    capturing = id
    void props.bridge
      .capture(id)
      .catch(() => undefined)
      .then(async (data) => {
        const url = data ? URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "image/jpeg" })) : ""
        const image = new Image()

        if (url) image.src = url

        const decoded =
          !!url &&
          (await image
            .decode()
            .then(() => true)
            .catch(() => false))

        if (capturing !== id) {
          if (url) URL.revokeObjectURL(url)

          return
        }

        capturing = undefined
        // A failed capture still hides the embed; the box shows its background as before. A still that
        // cannot decode never paints, so Element Timing would never report it.
        replaceSnapshot({ id, url, presented: !decoded })
        schedule()
      })
  }

  // Main hides the native view at once, but a still reaches the screen only a few frames after it
  // enters the DOM, so wait for Element Timing to report the frame that presents it.
  const presentation = new PerformanceObserver((list) => {
    const snapshot = store.snapshot

    if (!snapshot || snapshot.presented) return

    if (!list.getEntries().some((entry) => "url" in entry && entry.url === snapshot.url)) return
    setStore("snapshot", "presented", true)
    schedule()
  })

  presentation.observe({ type: "element" })
  onCleanup(() => presentation.disconnect())

  const thaw = () => {
    capturing = undefined

    if (!store.snapshot || release !== undefined) return
    // Keep the still under the native view until the view has painted again.
    release = setTimeout(() => {
      release = undefined
      replaceSnapshot()
    }, 150)
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
    const shown = props.visible && store.visible && !props.input.moving()
    // A dialog's scrim covers the box like floating content does, so it dims a still of the page
    // instead of a blank box, and the page does not blink out and back as the dialog opens and closes.
    const cover = !!props.frozen || props.input.dialog() || covered(rect)

    if (shown && cover) freeze(id)

    if (!cover) thaw()
    const visible = shown && !(cover && store.snapshot?.id === id && store.snapshot.presented)

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
    onscreen = visible
      ? {
          id,
          x: left / zoom - rect.left,
          y: top / zoom - rect.top,
          width: Math.max(0, right - left) / zoom,
          height: Math.max(0, bottom - top) / zoom,
        }
      : undefined

    if (onscreen) warm(600)
    else clearTimeout(warming)

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

  // A flight paints the still in the view's place. One that starts with the view on screen, like a close, first asks
  // for a fresh still, before the effect below hides the view; one that opens the pane shows the last still.
  createEffect(
    on([props.input.moving, () => props.visible], ([moving]) => {
      if (!moving) return fly(false)

      if (store.flying || (!onscreen && !props.visible)) return
      take()
      fly(true)
    }),
  )
  // A navigation or reload makes the kept still another page's.
  createEffect(
    on(
      () => props.page,
      () => {
        if (store.still) URL.revokeObjectURL(store.still.url)
        setStore("still", undefined)
        bytes = 0
        pause = 3000

        if (onscreen) warm(600)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      [
        props.input.zoom,
        props.input.dialog,
        props.input.moving,
        () => store.visible,
        () => props.visible,
        () => props.id,
        () => props.frozen,
      ],
      () => {
        layout = undefined

        // The native views are not clipped by the retained panel's DOM. Hide before the next
        // animation frame so closing the panel cannot leave the embed above the app.
        if (!props.visible || !store.visible || props.input.moving() || !props.id) return hide()
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
  createEventListener(document, "visibilitychange", () => setStore("visible", document.visibilityState === "visible"))

  // Stills pause while the window is in the background; the page may have moved on since the last one.
  const refocus = (next: boolean) => {
    focused = next

    if (focused) warm(0)
  }

  createEventListener(window, "focus", () => refocus(true))
  onCleanup(
    props.bridge.on((message) => {
      if (message.type === "focus") refocus(message.focused)
    }),
  )
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    clearTimeout(release)
    clearTimeout(landing)
    capturing = undefined
    stilling = undefined
    replaceSnapshot()

    if (store.still) URL.revokeObjectURL(store.still.url)
    hide()
  })

  return (
    <div ref={element} class={props.class}>
      <Show when={store.flying && store.still?.id === props.id && store.still?.page === props.page && store.still}>
        {(still) => <div class="absolute inset-0 overflow-hidden pointer-events-none">{still().image}</div>}
      </Show>
      <Show when={store.snapshot?.id === props.id && props.visible && store.snapshot?.url}>
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
