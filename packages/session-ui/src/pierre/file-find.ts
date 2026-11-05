import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import {
  createFindHostRegistryState,
  INITIAL_FILE_FIND_STATE,
  selectShortcutHost,
  transitionFileFind,
  transitionFindHostRegistry,
  viewFileFind,
  type FileFindEffect,
  type FileFindEvent,
  type FileFindState,
  type FindHostRegistryEffect,
  type FindHostRegistryEvent,
} from "./file-find-machine"

export type FindHost = {
  element: () => HTMLElement | undefined
  open: () => void
  close: () => void
  next: (dir: 1 | -1) => void
  isOpen: () => boolean
}

let registry = createFindHostRegistryState<FindHost>()

let installed = false

function dispatchRegistry(event: FindHostRegistryEvent<FindHost>) {
  const next = transitionFindHostRegistry(registry, event)
  registry = next.state
  next.effects.forEach(runRegistry)
}

function runRegistry(effect: FindHostRegistryEffect<FindHost>) {
  if (effect.type === "close-host") return effect.host.close()

  clearHighlightFind()
}

function isEditable(node: unknown): boolean {
  if (!(node instanceof HTMLElement)) return false

  if (node.closest("[data-prevent-autofocus]")) return true

  if (node.isContentEditable) return true

  return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(node.tagName)
}

function hostForNode(node: unknown) {
  if (!(node instanceof Node)) return

  for (const host of registry.hosts) {
    const el = host.element()

    if (el && el.isConnected && el.contains(node)) return host
  }
}

function installShortcuts() {
  if (installed) return

  if (typeof window === "undefined") return
  installed = true

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented) return

      if (isEditable(event.target)) return

      const mod = event.metaKey || event.ctrlKey

      if (!mod) return

      const key = event.key.toLowerCase()

      if (key !== "f" && key !== "g") return

      const host = selectShortcutHost(
        registry,
        key,
        () => hostForNode(document.activeElement) ?? hostForNode(event.target),
      )

      if (!host) return
      event.preventDefault()
      event.stopPropagation()

      if (key === "g") return host.next(event.shiftKey ? -1 : 1)
      host.open()
    },
    { capture: true },
  )
}

function clearHighlightFind() {
  const api = (globalThis as { CSS?: { highlights?: { delete: (name: string) => void } } }).CSS?.highlights

  if (!api) return
  api.delete("opencode-find")
  api.delete("opencode-find-current")
}

function supportsHighlights() {
  const g = globalThis as unknown as { CSS?: { highlights?: unknown }; Highlight?: unknown }

  return typeof g.Highlight === "function" && g.CSS?.highlights != null
}

function scrollParent(el: HTMLElement): HTMLElement | undefined {
  let parent = el.parentElement

  while (parent) {
    const style = getComputedStyle(parent)

    if (style.overflowY === "auto" || style.overflowY === "scroll") return parent
    parent = parent.parentElement
  }
}

type CreateFileFindOptions = {
  wrapper: () => HTMLElement | undefined
  overlay: () => HTMLDivElement | undefined
  getRoot: () => ShadowRoot | undefined
}

export function createFileFind(opts: CreateFileFindOptions) {
  let input: HTMLInputElement | undefined
  let focusFrame: number | undefined
  let overlayFrame: number | undefined
  let posFrame: number | undefined
  let current: FileFindState = INITIAL_FILE_FIND_STATE
  const queue: FileFindEvent[] = []
  const [state, setState] = createSignal(current)
  const [overlayScroll, setOverlayScroll] = createSignal<HTMLElement[]>([])

  const view = createMemo(() => viewFileFind(state()))
  const open = createMemo(() => view().open)
  const query = createMemo(() => view().query)
  const index = createMemo(() => view().index)
  const count = createMemo(() => view().count)
  const pos = createMemo(() => view().pos)

  const dispatch = (event: FileFindEvent) => {
    queue.push(event)

    // Effects dispatch scan results and highlight fallbacks while they run; the outer loop drains them next.
    if (queue.length > 1) return

    while (queue.length > 0) {
      try {
        const next = transitionFileFind(current, queue[0]!)

        if (next.state !== current) {
          current = next.state
          setState(current)
        }

        next.effects.forEach(run)
      } catch (error) {
        console.error("File find transition failed", error)
      } finally {
        queue.shift()
      }
    }
  }

  const run = (effect: FileFindEffect) => {
    try {
      perform(effect)
    } catch (error) {
      console.error("File find effect failed", error)
    }
  }

  const perform = (effect: FileFindEffect) => {
    if (effect.type === "activate-host") return dispatchRegistry({ type: "host.activated", host })

    if (effect.type === "deactivate-host") return dispatchRegistry({ type: "host.deactivated", host })

    if (effect.type === "unregister-host") return dispatchRegistry({ type: "host.unregistered", host })

    if (effect.type === "schedule-focus") {
      focusFrame = requestAnimationFrame(() => {
        focusFrame = undefined
        dispatch({ type: "focus.frame", attempt: effect.attempt })
      })

      return
    }

    if (effect.type === "cancel-focus") return cancelFocus()

    if (effect.type === "cancel-frames") {
      cancelFocus()
      cancelOverlay()

      if (posFrame !== undefined) cancelAnimationFrame(posFrame)
      posFrame = undefined

      return
    }

    if (effect.type === "focus-input") {
      input?.focus()
      input?.select()

      return
    }

    if (effect.type === "scan") {
      const root = opts.getRoot()

      // Without drawn rows there is nothing to search; the viewer refreshes find once its rows mount.
      if (!root) return

      dispatch({
        type: "matches.measured",
        attempt: effect.attempt,
        matches: scan(root, effect.query),
        cursor: effect.cursor,
        scroll: effect.scroll,
        preferredRenderer: supportsHighlights() ? "highlights" : "overlay",
      })

      return
    }

    if (effect.type === "render-marks") {
      if (effect.renderer === "highlights") {
        clearOverlay()
        setOverlayScroll([])

        if (!setHighlights(effect.matches, effect.index))
          dispatch({ type: "highlights.failed", attempt: effect.attempt })

        return
      }

      clearHighlightFind()
      syncOverlayScroll()
      scheduleOverlay()

      return
    }

    if (effect.type === "clear-marks") {
      clearHighlightFind()
      clearOverlay()
      setOverlayScroll([])

      return
    }

    scrollToRange(effect.match)
  }

  const cancelFocus = () => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = undefined
  }

  const cancelOverlay = () => {
    if (overlayFrame !== undefined) cancelAnimationFrame(overlayFrame)
    overlayFrame = undefined
  }

  const clearOverlay = () => {
    // Cancel first: the overlay element is gone once the viewer unmounts, but its frame is not.
    cancelOverlay()
    const el = opts.overlay()

    if (!el) return
    el.innerHTML = ""
  }

  const renderOverlay = () => {
    const wrapper = opts.wrapper()
    const overlay = opts.overlay()

    if (!wrapper || !overlay) return

    clearOverlay()

    if (current.status !== "open" || current.renderer !== "overlay" || current.matches.length === 0) return

    const base = wrapper.getBoundingClientRect()
    const frag = document.createDocumentFragment()

    for (let i = 0; i < current.matches.length; i++) {
      const range = current.matches[i]
      const active = i === current.index

      for (const rect of Array.from(range.getClientRects())) {
        if (!rect.width || !rect.height) continue

        const mark = document.createElement("div")
        mark.style.position = "absolute"
        mark.style.left = `${Math.round(rect.left - base.left)}px`
        mark.style.top = `${Math.round(rect.top - base.top)}px`
        mark.style.width = `${Math.round(rect.width)}px`
        mark.style.height = `${Math.round(rect.height)}px`
        mark.style.borderRadius = "2px"
        mark.style.backgroundColor = active ? "var(--surface-warning-strong)" : "var(--surface-warning-base)"
        mark.style.opacity = active ? "0.55" : "0.35"

        if (active) mark.style.boxShadow = "inset 0 0 0 1px var(--v2-state-border-warning)"
        frag.appendChild(mark)
      }
    }

    overlay.appendChild(frag)
  }

  function scheduleOverlay() {
    if (current.status !== "open" || current.renderer !== "overlay") return

    if (overlayFrame !== undefined) return

    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = undefined
      renderOverlay()
    })
  }

  const syncOverlayScroll = () => {
    const root = opts.getRoot()

    const next = root
      ? Array.from(root.querySelectorAll("[data-code]")).filter(
          (node): node is HTMLElement => node instanceof HTMLElement,
        )
      : []

    const previous = overlayScroll()

    if (next.length === previous.length && next.every((el, i) => el === previous[i])) return

    setOverlayScroll(next)
  }

  const positionBar = () => {
    if (typeof window === "undefined") return
    const wrapper = opts.wrapper()

    if (!wrapper) return

    const root = scrollParent(wrapper) ?? wrapper
    const rect = root.getBoundingClientRect()
    const title = parseFloat(getComputedStyle(root).getPropertyValue("--session-title-height"))
    const header = Number.isNaN(title) ? 0 : title

    dispatch({
      type: "position.updated",
      pos: {
        top: Math.round(rect.top) + header - 4,
        right: Math.round(window.innerWidth - rect.right) + 8,
      },
    })
  }

  const scan = (root: ShadowRoot, value: string) => {
    const needle = value.toLowerCase()
    const ranges: Range[] = []

    const cols = Array.from(root.querySelectorAll("[data-content] [data-line], [data-column-content]")).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )

    for (const col of cols) {
      const text = col.textContent

      if (!text) continue

      const hay = text.toLowerCase()
      let at = hay.indexOf(needle)

      if (at === -1) continue

      const nodes: Text[] = []
      const ends: number[] = []
      const walker = document.createTreeWalker(col, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      let pos = 0

      while (node) {
        if (node instanceof Text) {
          pos += node.data.length
          nodes.push(node)
          ends.push(pos)
        }

        node = walker.nextNode()
      }

      if (nodes.length === 0) continue

      const locate = (offset: number) => {
        let lo = 0
        let hi = ends.length - 1

        while (lo < hi) {
          const mid = (lo + hi) >> 1

          if (ends[mid] >= offset) hi = mid
          else lo = mid + 1
        }

        const prev = lo === 0 ? 0 : ends[lo - 1]

        return { node: nodes[lo], offset: offset - prev }
      }

      while (at !== -1) {
        const start = locate(at)
        const end = locate(at + value.length)
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        ranges.push(range)
        at = hay.indexOf(needle, at + value.length)
      }
    }

    return ranges
  }

  const scrollToRange = (range: Range) => {
    const start = range.startContainer
    const el = start instanceof Element ? start : start.parentElement
    el?.scrollIntoView({ block: "center", inline: "center" })
  }

  const setHighlights = (ranges: readonly Range[], currentIndex: number) => {
    const root = globalThis as unknown as {
      CSS?: { highlights?: { delete: (name: string) => void; set: (name: string, value: unknown) => void } }
      Highlight?: new (...ranges: Range[]) => unknown
    }

    const api = root.CSS?.highlights
    const Highlight = root.Highlight

    if (!api || typeof Highlight !== "function") return false

    api.delete("opencode-find")
    api.delete("opencode-find-current")

    const active = ranges[currentIndex]

    if (active) api.set("opencode-find-current", new Highlight(active))

    const rest = ranges.filter((_, i) => i !== currentIndex)

    if (rest.length > 0) api.set("opencode-find", new Highlight(...rest))

    return true
  }

  const focus = () => dispatch({ type: "open.requested", preferredRenderer: supportsHighlights() ? "highlights" : "overlay" })

  const close = () => dispatch({ type: "close.requested" })

  const next = (dir: 1 | -1) =>
    dispatch({
      type: "next.requested",
      dir,
      stale: current.status === "open" && current.matches.some((range) => !range.startContainer.isConnected),
    })

  const host: FindHost = {
    element: opts.wrapper,
    isOpen: () => current.status === "open",
    next,
    open: focus,
    close,
  }

  createEffect(() => {
    for (const el of overlayScroll()) makeEventListener(el, "scroll", scheduleOverlay, { passive: true })
  })

  onMount(() => {
    installShortcuts()
    dispatchRegistry({ type: "host.registered", host })
  })

  createEffect(() => {
    if (!open()) return

    const update = () => {
      posFrame = undefined
      positionBar()
    }

    posFrame = requestAnimationFrame(update)
    makeEventListener(window, "resize", positionBar, { passive: true })

    const wrapper = opts.wrapper()

    if (!wrapper) return
    const root = scrollParent(wrapper) ?? wrapper
    createResizeObserver(root, positionBar)
  })

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    open,
    query,
    count,
    index,
    pos,
    setInput: (el: HTMLInputElement) => {
      input = el
    },
    setQuery: (value: string) => dispatch({ type: "query.changed", query: value }),
    focus,
    close,
    next,
    refresh: (args?: { reset?: boolean; scroll?: boolean }) =>
      dispatch({ type: "refresh.requested", reset: !!args?.reset, scroll: !!args?.scroll }),
    onPointerDown: () => {
      dispatchRegistry({ type: "host.preferred", host })
      opts.wrapper()?.focus({ preventScroll: true })
    },
    onFocus: () => dispatchRegistry({ type: "host.preferred", host }),
    onInputKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()

        return
      }

      if (event.key !== "Enter") return
      event.preventDefault()
      next(event.shiftKey ? -1 : 1)
    },
  }
}
