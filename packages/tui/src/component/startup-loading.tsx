import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useTuiReady } from "../context/runtime"
import { AnimatedSpinner } from "./spinner"
import { STARTUP_STAGE_MESSAGES, buildProgressBar, type StartupStage } from "../startup-shared"

const MIN_VISIBLE_MS = 250
const FALLBACK_HIDE_TIMEOUT_MS = 15000
const PROGRESS_INTERVAL_MS = 80

export function StartupLoading() {
  const theme = useTheme().theme
  const sync = useSync()
  const tuiReady = useTuiReady()
  const [show, setShow] = createSignal(true)
  const [elapsed, setElapsed] = createSignal(0)
  const [phase, setPhase] = createSignal(0)
  let stamp = Date.now()
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let progressTimer: ReturnType<typeof setInterval> | undefined
  let mounted = true

  const startTime = globalThis.__opencodeStartupStartTime ?? Date.now()

  const stage = createMemo<StartupStage>(() => {
    if (tuiReady.ready()) return "finishing"
    if (sync.status === "complete") return "completing"
    if (sync.status === "partial") return "syncing"
    return "boot"
  })

  const message = createMemo(() => STARTUP_STAGE_MESSAGES[stage()])
  const progressBar = createMemo(() => buildProgressBar(elapsed(), phase()))

  onMount(() => {
    globalThis.__opencodeStopInTuiSplash?.()
    setElapsed(Date.now() - startTime)
    progressTimer = setInterval(() => {
      if (!mounted) return
      setElapsed(Date.now() - startTime)
      setPhase((p) => p + 1)
    }, PROGRESS_INTERVAL_MS)
  })

  const forceHide = (reason: string) => {
    if (!mounted) return
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = undefined
    }
    if (fallbackTimer) {
      clearTimeout(fallbackTimer)
      fallbackTimer = undefined
    }
    if (progressTimer) {
      clearInterval(progressTimer)
      progressTimer = undefined
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
    if (!tuiReady.ready()) {
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = undefined
      }
      if (show()) return
      stamp = Date.now()
      setShow(true)
      return
    }

    const elapsedMs = Date.now() - stamp
    const remaining = MIN_VISIBLE_MS - elapsedMs
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
  })

  onCleanup(() => {
    mounted = false
    if (hideTimer) clearTimeout(hideTimer)
    if (fallbackTimer) clearTimeout(fallbackTimer)
    if (progressTimer) clearInterval(progressTimer)
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
          <box flexDirection="row" gap={0}>
            <text fg={elapsed() >= 8000 ? (theme.text ?? "#eeeeee") : (theme.textMuted ?? "#888888")}>
              {progressBar().bar}
            </text>
            <text fg={theme.text ?? "#eeeeee"}> {progressBar().pct}</text>
          </box>
        </box>
      </box>
    </Show>
  )
}

declare global {
  var __opencodeForceHideStartupLoading: ((reason: string) => void) | undefined
}
