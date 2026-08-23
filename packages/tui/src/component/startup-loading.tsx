import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useTuiReady } from "../context/runtime"
import { AnimatedSpinner } from "./spinner"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

const MIN_VISIBLE_MS = 250
const FALLBACK_HIDE_TIMEOUT_MS = 15000

type Stage = "boot" | "syncing" | "completing" | "finishing"

export function StartupLoading() {
  const theme = useTheme().theme
  const sync = useSync()
  const tuiReady = useTuiReady()
  const [show, setShow] = createSignal(true)
  let stamp = Date.now()
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let mounted = true
  let lastForceHide = 0

  const stage = createMemo<Stage>(() => {
    if (tuiReady.ready()) return "finishing"
    if (sync.status === "complete") return "completing"
    if (sync.status === "partial") return "syncing"
    return "boot"
  })

  const message = createMemo(() => {
    switch (stage()) {
      case "boot":
        return "Booting OpenCode..."
      case "syncing":
        return "Loading workspace and sessions..."
      case "completing":
        return "Loading plugins..."
      case "finishing":
        return "Finishing startup..."
      default:
        return "Starting up..."
    }
  })

  onMount(() => {
    globalThis.__opencodeStopInTuiSplash?.()
  })

  const forceHide = (reason: string) => {
    if (!mounted) return
    lastForceHide = Date.now()
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = undefined
    }
    setShow(false)
    if (process.env.OPENCODE_DEBUG_STARTUP) {
      process.stderr.write(`[startup-loading] force hide: ${reason}\n`)
    }
  }

  globalThis.__opencodeForceHideStartupLoading = forceHide

  fallbackTimer = setTimeout(() => {
    if (mounted && show()) {
      forceHide("fallback timeout")
    }
  }, FALLBACK_HIDE_TIMEOUT_MS)

  createEffect(() => {
    if (tuiReady.ready()) {
      const elapsed = Date.now() - stamp
      const remaining = MIN_VISIBLE_MS - elapsed
      if (remaining <= 0) {
        if (hideTimer) {
          clearTimeout(hideTimer)
          hideTimer = undefined
        }
        setShow(false)
        return
      }
      if (hideTimer) return
      hideTimer = setTimeout(() => {
        if (!mounted) return
        hideTimer = undefined
        setShow(false)
      }, remaining)
      return
    }

    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
    if (show()) return
    stamp = Date.now()
    setShow(true)
  })

  onCleanup(() => {
    mounted = false
    if (hideTimer) clearTimeout(hideTimer)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    if (globalThis.__opencodeForceHideStartupLoading === forceHide) {
      globalThis.__opencodeForceHideStartupLoading = undefined
    }
  })

  return (
    <Show when={show()}>
      <box
        position="absolute"
        zIndex={5000}
        left={0}
        top={0}
        right={0}
        bottom={0}
        justifyContent="center"
        alignItems="center"
      >
        <box flexDirection="column" alignItems="center" gap={1}>
          <AnimatedSpinner color={theme.text ?? "#eeeeee"}>{message()}</AnimatedSpinner>
          <text fg={theme.textMuted ?? "#808080"}>v{InstallationVersion}</text>
        </box>
      </box>
    </Show>
  )
}

declare global {
  var __opencodeForceHideStartupLoading: ((reason: string) => void) | undefined
}
