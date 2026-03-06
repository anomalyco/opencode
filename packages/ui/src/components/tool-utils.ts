import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js"
import {
  animate,
  type AnimationPlaybackControls,
  clearFadeStyles,
  clearMaskStyles,
  COLLAPSIBLE_SPRING,
  GROW_SPRING,
  WIPE_MASK,
} from "./motion"
import { prefersReducedMotion } from "../hooks/use-reduced-motion"
import type { ToolPart } from "@opencode-ai/sdk/v2"

export const TEXT_RENDER_THROTTLE_MS = 100

export function createThrottledValue(getValue: () => string) {
  const [value, setValue] = createSignal(getValue())
  let timeout: ReturnType<typeof setTimeout> | undefined
  let last = 0

  createEffect(() => {
    const next = getValue()
    const now = Date.now()

    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last)
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      last = now
      setValue(next)
      return
    }
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      last = Date.now()
      setValue(next)
      timeout = undefined
    }, remaining)
  })

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
  })

  return value
}

export function busy(status: string | undefined) {
  return status === "pending" || status === "running"
}

export function hold(state: () => boolean, wait = 2000) {
  const [live, setLive] = createSignal(state())
  let timer: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    if (state()) {
      if (timer) clearTimeout(timer)
      timer = undefined
      setLive(true)
      return
    }

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      setLive(false)
    }, wait)
  })

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  return live
}

export function updateScrollMask(el: HTMLElement, fade = 12) {
  const { scrollTop, scrollHeight, clientHeight } = el
  const overflow = scrollHeight - clientHeight
  if (overflow <= 1) {
    el.style.maskImage = ""
    el.style.webkitMaskImage = ""
    return
  }
  const top = scrollTop > 1
  const bottom = scrollTop < overflow - 1
  const mask =
    top && bottom
      ? `linear-gradient(to bottom, transparent 0, black ${fade}px, black calc(100% - ${fade}px), transparent 100%)`
      : top
        ? `linear-gradient(to bottom, transparent 0, black ${fade}px)`
        : bottom
          ? `linear-gradient(to bottom, black calc(100% - ${fade}px), transparent 100%)`
          : ""
  el.style.maskImage = mask
  el.style.webkitMaskImage = mask
}

export function useCollapsible(options: {
  content: () => HTMLElement | undefined
  body: () => HTMLElement | undefined
  open: () => boolean
  measure?: () => number
  onOpen?: () => void
}) {
  let heightAnim: AnimationPlaybackControls | undefined
  let fadeAnim: AnimationPlaybackControls | undefined
  let gen = 0

  createEffect(
    on(
      options.open,
      (isOpen) => {
        const content = options.content()
        const body = options.body()
        if (!content || !body) return
        heightAnim?.stop()
        fadeAnim?.stop()
        const id = ++gen
        if (isOpen) {
          content.style.display = ""
          content.style.height = "0px"
          body.style.opacity = "0"
          body.style.filter = "blur(2px)"
          fadeAnim = animate(body, { opacity: [0, 1], filter: ["blur(2px)", "blur(0px)"] }, COLLAPSIBLE_SPRING)
          queueMicrotask(() => {
            if (gen !== id) return
            const c = options.content()
            if (!c) return
            const h = options.measure?.() ?? Math.ceil(body.getBoundingClientRect().height)
            heightAnim = animate(c, { height: ["0px", `${h}px`] }, COLLAPSIBLE_SPRING)
            heightAnim.finished.then(
              () => {
                if (gen !== id) return
                c.style.height = "auto"
                options.onOpen?.()
              },
              () => {},
            )
          })
          return
        }

        const h = content.getBoundingClientRect().height
        heightAnim = animate(content, { height: [`${h}px`, "0px"] }, COLLAPSIBLE_SPRING)
        fadeAnim = animate(body, { opacity: [1, 0], filter: ["blur(0px)", "blur(2px)"] }, COLLAPSIBLE_SPRING)
        heightAnim.finished.then(
          () => {
            if (gen !== id) return
            content.style.display = "none"
          },
          () => {},
        )
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    ++gen
    heightAnim?.stop()
    fadeAnim?.stop()
  })
}

export function useContextToolPending(parts: () => ToolPart[], working?: () => boolean) {
  const anyRunning = createMemo(() => parts().some((part) => busy(part.state.status)))
  const [settled, setSettled] = createSignal(false)
  createEffect(() => {
    if (!anyRunning() && !working?.()) setSettled(true)
  })
  return createMemo(() => !settled() && (!!working?.() || anyRunning()))
}

export function useRowWipe(opts: {
  id: () => string
  text: () => string | undefined
  ref: () => HTMLElement | undefined
  seen: Set<string>
}) {
  const reduce = prefersReducedMotion

  createEffect(() => {
    const id = opts.id()
    const txt = opts.text()
    const el = opts.ref()
    if (!el) return
    if (!txt) {
      clearFadeStyles(el)
      clearMaskStyles(el)
      return
    }
    if (reduce() || typeof window === "undefined") {
      clearFadeStyles(el)
      clearMaskStyles(el)
      return
    }
    if (opts.seen.has(id)) {
      clearFadeStyles(el)
      clearMaskStyles(el)
      return
    }
    opts.seen.add(id)

    el.style.maskImage = WIPE_MASK
    el.style.webkitMaskImage = WIPE_MASK
    el.style.maskSize = "240% 100%"
    el.style.webkitMaskSize = "240% 100%"
    el.style.maskRepeat = "no-repeat"
    el.style.webkitMaskRepeat = "no-repeat"
    el.style.maskPosition = "100% 0%"
    el.style.webkitMaskPosition = "100% 0%"
    el.style.opacity = "0"
    el.style.filter = "blur(2px)"
    el.style.transform = "translateX(-0.06em)"

    let done = false
    const clear = () => {
      if (done) return
      done = true
      clearFadeStyles(el)
      clearMaskStyles(el)
    }
    if (typeof requestAnimationFrame !== "function") {
      clear()
      return
    }
    let anim: AnimationPlaybackControls | undefined
    let frame: number | undefined = requestAnimationFrame(() => {
      frame = undefined
      const node = opts.ref()
      if (!node) return
      anim = animate(
        node,
        {
          opacity: [0, 1],
          filter: ["blur(2px)", "blur(0px)"],
          transform: ["translateX(-0.06em)", "translateX(0)"],
          maskPosition: "0% 0%",
        },
        GROW_SPRING,
      )

      anim.finished.catch(() => {}).finally(clear)
    })

    onCleanup(() => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
        clear()
      }
    })
  })
}

export function useToolFade(
  ref: () => HTMLElement | undefined,
  options?: { delay?: number; wipe?: boolean; animate?: boolean },
) {
  let anim: AnimationPlaybackControls | undefined
  let frame: number | undefined
  const delay = options?.delay ?? 0
  const wipe = options?.wipe ?? false
  const active = options?.animate !== false

  onMount(() => {
    if (!active) return

    const el = ref()
    if (!el || typeof window === "undefined") return
    if (prefersReducedMotion()) return

    const mask =
      wipe &&
      typeof CSS !== "undefined" &&
      (CSS.supports("mask-image", "linear-gradient(to right, black, transparent)") ||
        CSS.supports("-webkit-mask-image", "linear-gradient(to right, black, transparent)"))

    el.style.opacity = "0"
    el.style.filter = wipe ? "blur(3px)" : "blur(2px)"
    el.style.transform = wipe ? "translateX(-0.06em)" : "translateY(0.04em)"

    if (mask) {
      el.style.maskImage = WIPE_MASK
      el.style.webkitMaskImage = WIPE_MASK
      el.style.maskSize = "240% 100%"
      el.style.webkitMaskSize = "240% 100%"
      el.style.maskRepeat = "no-repeat"
      el.style.webkitMaskRepeat = "no-repeat"
      el.style.maskPosition = "100% 0%"
      el.style.webkitMaskPosition = "100% 0%"
    }

    frame = requestAnimationFrame(() => {
      frame = undefined
      const node = ref()
      if (!node) return

      anim = wipe
        ? mask
          ? animate(
              node,
              { opacity: 1, filter: "blur(0px)", transform: "translateX(0)", maskPosition: "0% 0%" },
              { ...GROW_SPRING, delay },
            )
          : animate(node, { opacity: 1, filter: "blur(0px)", transform: "translateX(0)" }, { ...GROW_SPRING, delay })
        : animate(node, { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" }, { ...GROW_SPRING, delay })

      anim?.finished.then(() => {
        const value = ref()
        if (!value) return
        clearFadeStyles(value)
        if (mask) clearMaskStyles(value)
      })
    })
  })

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    anim?.stop()
  })
}
