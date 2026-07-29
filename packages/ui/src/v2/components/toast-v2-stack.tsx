// Stack behavior adapted from Sonner and solid-sonner. See LICENSE.sonner.
import type { JSX } from "solid-js"
import { For, createContext, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import { createStore, reconcile } from "solid-js/store"

const DEFAULT_DURATION = 4000
const REMOVE_DELAY = 180

export interface ToastV2StackItem {
  id: number
  revision: number
  variant?: string
  duration?: number
  persistent?: boolean
  render: () => JSX.Element
  onDismiss?: () => void
  onAutoClose?: () => void
}

interface RenderedToastV2StackItem extends ToastV2StackItem {
  removed: boolean
}

type StackEvent = { type: "upsert"; item: ToastV2StackItem } | { type: "dismiss"; id: number }

const listeners = new Set<(event: StackEvent) => void>()
let active: ToastV2StackItem[] = []

export const ToastV2StackRenderContext = createContext(false)

export const toastV2Stack = {
  show(item: ToastV2StackItem) {
    const index = active.findIndex((toast) => toast.id === item.id)
    active = index === -1 ? [item, ...active] : active.map((toast) => (toast.id === item.id ? item : toast))
    listeners.forEach((listener) => listener({ type: "upsert", item }))
    return item.id
  },
  dismiss(id?: number, auto = false) {
    const dismissed = id === undefined ? active : active.filter((toast) => toast.id === id)
    active = id === undefined ? [] : active.filter((toast) => toast.id !== id)
    dismissed.forEach((toast) => (auto ? toast.onAutoClose?.() : toast.onDismiss?.()))
    if (id === undefined)
      dismissed.forEach((toast) => listeners.forEach((listener) => listener({ type: "dismiss", id: toast.id })))
    else listeners.forEach((listener) => listener({ type: "dismiss", id }))
    return id
  },
  getToasts() {
    return active
  },
  subscribe(listener: (event: StackEvent) => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export interface ToastV2StackRegionProps {
  class?: string
  className?: string
  duration?: number
  gap?: number
  visibleToasts?: number
  offset?: { right?: number; bottom?: number }
  mobileOffset?: number
  containerAriaLabel?: string
}

export function ToastV2StackRegion(props: ToastV2StackRegionProps) {
  const [store, setStore] = createStore<{
    items: RenderedToastV2StackItem[]
    heights: Record<number, number>
    expanded: boolean
    interacting: boolean
  }>({
    items: toastV2Stack.getToasts().map((item) => ({ ...item, removed: false }) satisfies RenderedToastV2StackItem),
    heights: {} as Record<number, number>,
    expanded: false,
    interacting: false,
  })
  const removals = new Set<ReturnType<typeof setTimeout>>()
  let list: HTMLOListElement | undefined

  onMount(() => {
    const unsubscribe = toastV2Stack.subscribe((event) => {
      if (event.type === "dismiss") {
        const index = store.items.findIndex((item) => item.id === event.id)
        if (index === -1) return
        setStore("items", index, "removed", true)
        const timeout = setTimeout(() => {
          removals.delete(timeout)
          setStore("items", (items) => items.filter((item) => item.id !== event.id))
          setStore(
            "heights",
            reconcile(Object.fromEntries(Object.entries(store.heights).filter(([id]) => Number(id) !== event.id))),
          )
        }, REMOVE_DELAY)
        removals.add(timeout)
        return
      }

      const index = store.items.findIndex((item) => item.id === event.item.id)
      if (index === -1) {
        setStore("items", (items) => [{ ...event.item, removed: false }, ...items])
        return
      }
      setStore("items", index, reconcile({ ...event.item, removed: false }))
    })

    const keydown = (event: KeyboardEvent) => {
      if (event.altKey && event.code === "KeyT") {
        setStore("expanded", true)
        list?.focus()
      }
      if (event.code === "Escape" && list?.contains(document.activeElement)) setStore("expanded", false)
    }
    document.addEventListener("keydown", keydown)

    onCleanup(() => {
      unsubscribe()
      removals.forEach(clearTimeout)
      document.removeEventListener("keydown", keydown)
    })
  })

  createEffect(() => {
    if (store.items.length <= 1) setStore("expanded", false)
  })

  const visibleToasts = () => props.visibleToasts ?? 3
  const gap = () => props.gap ?? 12
  const frontHeight = () => store.heights[store.items[0]?.id] ?? 0

  return (
    <section
      aria-label={props.containerAriaLabel ?? "Notifications"}
      aria-live="polite"
      aria-relevant="additions text"
      aria-atomic="false"
    >
      <ol
        ref={list}
        tabindex={-1}
        class={["toast-v2-region", props.className, props.class].filter(Boolean).join(" ")}
        data-component="toast-v2-region"
        data-expanded={store.expanded}
        style={
          {
            "--toast-v2-gap": `${gap()}px`,
            "--toast-v2-stack-gap": `${Math.max(0, gap() - 3)}px`,
            "--toast-v2-front-height": `${frontHeight()}px`,
            "--toast-v2-offset-right": `${props.offset?.right ?? 32}px`,
            "--toast-v2-offset-bottom": `${props.offset?.bottom ?? 48}px`,
            "--toast-v2-mobile-offset": `${props.mobileOffset ?? 16}px`,
          } as JSX.CSSProperties
        }
        onMouseEnter={() => setStore("expanded", true)}
        onMouseMove={() => setStore("expanded", true)}
        onMouseLeave={() => {
          if (!store.interacting) setStore("expanded", false)
        }}
        onFocusIn={() => setStore("expanded", true)}
        onFocusOut={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setStore("expanded", false)
        }}
        onPointerDown={() => setStore("interacting", true)}
        onPointerUp={() => setStore("interacting", false)}
        onPointerCancel={() => setStore("interacting", false)}
      >
        <For each={store.items}>
          {(item, index) => {
            const offset = createMemo(() =>
              store.items
                .slice(0, index())
                .reduce((total, toast) => total + (store.heights[toast.id] ?? frontHeight()), index() * gap()),
            )
            return (
              <ToastV2StackToast
                item={item}
                index={index()}
                offset={offset()}
                frontHeight={frontHeight()}
                height={store.heights[item.id] ?? 0}
                expanded={store.expanded}
                interacting={store.interacting}
                visible={index() < visibleToasts()}
                duration={props.duration}
                onHeight={(height) => setStore("heights", item.id, height)}
              />
            )
          }}
        </For>
      </ol>
    </section>
  )
}

function ToastV2StackToast(props: {
  item: RenderedToastV2StackItem
  index: number
  offset: number
  frontHeight: number
  height: number
  expanded: boolean
  interacting: boolean
  visible: boolean
  duration?: number
  onHeight: (height: number) => void
}) {
  const [mounted, setMounted] = createSignal(false)
  const [swiping, setSwiping] = createSignal(false)
  const [swiped, setSwiped] = createSignal(false)
  const [swipeOut, setSwipeOut] = createSignal(false)
  const [swipeDirection, setSwipeDirection] = createSignal<"left" | "right" | "down" | undefined>()
  const [hidden, setHidden] = createSignal(typeof document !== "undefined" && document.hidden)
  let element: HTMLLIElement | undefined
  let body: HTMLDivElement | undefined
  let pointer: { x: number; y: number; time: number } | undefined
  let remaining = props.item.duration ?? props.duration ?? DEFAULT_DURATION
  let started = 0

  onMount(() => {
    setMounted(true)
    if (!body) return
    const measure = () =>
      props.onHeight(Math.min(Math.ceil(body!.getBoundingClientRect().height + 24), 420, window.innerHeight - 96))
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    measure()
    const visibility = () => setHidden(document.hidden)
    document.addEventListener("visibilitychange", visibility)
    onCleanup(() => {
      observer.disconnect()
      document.removeEventListener("visibilitychange", visibility)
    })
  })

  createEffect(
    on(
      () => props.item.revision,
      (revision, previous) => {
        remaining = props.item.duration ?? props.duration ?? DEFAULT_DURATION
        if (!previous || !element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
        element.animate([{ scale: 1 }, { scale: 1.025 }, { scale: 1 }], { duration: 160, easing: "ease-out" })
      },
    ),
  )

  createEffect(() => {
    props.item.revision
    const persistent = props.item.persistent || remaining === Number.POSITIVE_INFINITY
    if (persistent) return
    const paused = props.expanded || props.interacting || hidden()
    if (paused) {
      if (started) remaining -= Date.now() - started
      started = 0
      return
    }
    started = Date.now()
    const timeout = setTimeout(() => toastV2Stack.dismiss(props.item.id, true), remaining)
    onCleanup(() => clearTimeout(timeout))
  })

  const finishSwipe = () => {
    if (!element || !pointer) return
    const x = Number(element.style.getPropertyValue("--toast-v2-swipe-x").replace("px", "") || 0)
    const y = Number(element.style.getPropertyValue("--toast-v2-swipe-y").replace("px", "") || 0)
    const delta = Math.abs(x) > Math.abs(y) ? x : y
    const velocity = Math.abs(delta) / Math.max(1, Date.now() - pointer.time)
    pointer = undefined
    if (Math.abs(delta) >= 45 || velocity > 0.11) {
      setSwipeDirection(Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : "down")
      setSwipeOut(true)
      toastV2Stack.dismiss(props.item.id)
      return
    }
    element.style.setProperty("--toast-v2-swipe-x", "0px")
    element.style.setProperty("--toast-v2-swipe-y", "0px")
    setSwiping(false)
    setSwiped(false)
  }

  return (
    <li
      ref={element}
      tabindex={0}
      data-component="toast-v2"
      data-mounted={mounted()}
      data-removed={props.item.removed}
      data-visible={props.visible}
      data-front={props.index === 0}
      data-variant={props.item.variant ?? "default"}
      data-expanded={props.expanded}
      data-swiping={swiping()}
      data-swiped={swiped()}
      data-swipe-out={swipeOut()}
      data-swipe-direction={swipeDirection()}
      style={
        {
          "--toast-v2-index": props.index,
          "--toast-v2-offset": `${props.offset}px`,
          "--toast-v2-height": `${props.frontHeight}px`,
          "--toast-v2-initial-height": `${props.height}px`,
          "--toast-v2-z-index": 1000 - props.index,
        } as JSX.CSSProperties
      }
      onPointerDown={(event) => {
        if (event.button === 2 || (event.target as HTMLElement).closest("button")) return
        pointer = { x: event.clientX, y: event.clientY, time: Date.now() }
        event.currentTarget.setPointerCapture(event.pointerId)
        setSwiping(true)
      }}
      onPointerMove={(event) => {
        if (!pointer || !element) return
        const x = event.clientX - pointer.x
        const y = Math.max(0, event.clientY - pointer.y)
        element.style.setProperty("--toast-v2-swipe-x", `${x}px`)
        element.style.setProperty("--toast-v2-swipe-y", `${y}px`)
        setSwiped(Math.abs(x) > 1 || y > 1)
      }}
      onPointerUp={finishSwipe}
      onPointerCancel={finishSwipe}
    >
      <div ref={body} data-slot="toast-v2-body">
        <ToastV2StackRenderContext.Provider value>{props.item.render()}</ToastV2StackRenderContext.Provider>
      </div>
    </li>
  )
}
