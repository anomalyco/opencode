import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import {
  animate,
  type AnimationPlaybackControls,
  clearFadeStyles,
  clearMaskStyles,
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

export function useContextToolPending(parts: () => ToolPart[], working?: () => boolean) {
  const anyRunning = createMemo(() => parts().some((part) => busy(part.state.status)))
  const [settled, setSettled] = createSignal(false)
  createEffect(() => {
    if (!anyRunning() && !working?.()) setSettled(true)
  })
  return createMemo(() => !settled() && (!!working?.() || anyRunning()))
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
