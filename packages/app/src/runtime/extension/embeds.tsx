import { createEffect, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import type { EmbedProps, Embeds } from "@opencode/gui-extensions/sdk"
import type { Bridge } from "@opencode/gui-extensions/sdk/bridge"

const geometry =
  /^(inset|left|right|top|bottom|translate|transform|scale|rotate|margin|padding|flex|grid|gap|row-gap|column-gap)|(^|-)(width|height)$/

type Input = {
  readonly bridge: Bridge | undefined
  readonly zoom: () => number
  readonly dialog: () => boolean
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
  const [store, setStore] = createStore<{ visible: boolean; snapshot: { id: string; url: string } | undefined }>({
    visible: typeof document === "undefined" || document.visibilityState === "visible",
    // A still of the embed shown in the DOM while floating content covers the hidden native view.
    snapshot: undefined,
  })

  let element: HTMLDivElement | undefined
  let frame: number | undefined
  let layout: string | undefined
  let until = 0
  let capturing: string | undefined
  let release: ReturnType<typeof setTimeout> | undefined
  // The embed the last layout went to; it hides when another one takes the box.
  let placed: string | undefined
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })

  const hide = () => {
    if (placed) props.bridge.embed(placed)
    placed = undefined
  }

  // The native embed always paints above the DOM, so hide it while a floating
  // menu, select, or popover overlaps it. Tooltips are excluded.
  const covered = (rect: DOMRect) =>
    Array.from(document.querySelectorAll('[data-popper-positioner]:not(:has([role="tooltip"]))')).some((el) => {
      const r = el.getBoundingClientRect()

      return r.width > 0 && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top
    })

  const replaceSnapshot = (next?: { id: string; url: string }) => {
    if (store.snapshot?.url) URL.revokeObjectURL(store.snapshot.url)
    setStore("snapshot", next)
  }

  // Keep the embed on screen as a still under the floating content. The native view
  // stays visible until the still has decoded, so the box never flashes blank.
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

        if (url) {
          const image = new Image()
          image.src = url
          await image.decode().catch(() => undefined)
        }

        if (capturing !== id) {
          if (url) URL.revokeObjectURL(url)

          return
        }

        capturing = undefined
        // A failed capture still hides the embed; the box shows its background as before.
        replaceSnapshot({ id, url })
        schedule()
      })
  }

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
    const shown = props.visible && store.visible && !props.input.dialog()
    const cover = !!props.frozen || covered(rect)

    if (shown && cover) freeze(id)

    if (!cover) thaw()
    const visible = shown && !(cover && store.snapshot?.id === id)

    // The cutout exposes the app backdrop outside the rounded card, not the embed inside it.
    const color =
      props.background ??
      getComputedStyle(element.closest(".bg-v2-background-bg-deep") ?? document.documentElement).backgroundColor

    const next = `${id}:${visible}:${left}:${top}:${right}:${bottom}:${color}:${window.devicePixelRatio}`

    if (next === layout) return
    layout = next

    // Let the browser resolve the color, including custom themes using color formats
    // that Electron's color parser cannot read.
    if (paint) {
      paint.clearRect(0, 0, 1, 1)
      paint.fillStyle = color
      paint.fillRect(0, 0, 1, 1)
    }

    const rgba = paint?.getImageData(0, 0, 1, 1).data

    if (placed !== id) hide()
    placed = id

    const box = {
      visible,
      bounds: { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
      radius: Math.round((props.radius ?? 0) * zoom),
    }

    props.bridge.embed(id, rgba ? { ...box, background: [rgba[0], rgba[1], rgba[2], rgba[3]] as const } : box)
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

  createEffect(
    on(
      [
        props.input.zoom,
        props.input.dialog,
        () => store.visible,
        () => props.visible,
        () => props.id,
        () => props.frozen,
      ],
      () => {
        layout = undefined

        // The native views are not clipped by the retained panel's DOM. Hide before the next
        // animation frame so closing the panel cannot leave the embed above the app.
        if (!props.visible || !store.visible || props.input.dialog() || !props.id) return hide()
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
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    clearTimeout(release)
    capturing = undefined
    replaceSnapshot()
    hide()
  })

  return (
    <div ref={element} class={props.class}>
      <Show when={store.snapshot?.id === props.id && props.visible && store.snapshot?.url}>
        {(url) => (
          <img
            src={url()}
            alt=""
            draggable={false}
            class="absolute inset-0 size-full pointer-events-none select-none"
          />
        )}
      </Show>
      {props.children}
    </div>
  )
}
