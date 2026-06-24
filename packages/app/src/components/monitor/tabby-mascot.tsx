/**
 * Tabby mascot — a floating SVG companion pinned to the bottom-right
 * of every monitor page.
 *
 * The SVG carries 8 mood variants switched via the `mood` attribute
 * (driven by `deriveMood` from `monitor-tabby.ts`). Cursor-tracking eyes
 * are driven by a CSS transform on the pupil element.
 *
 * Speech bubbles are throttled to one every 4s, coalesced over a window
 * — kept inside the mascot component so it stays self-contained.
 */

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { deriveMood, nextQuip } from "@/utils/monitor-tabby"
import type { Mood } from "@/utils/monitor-schema"

const QUIP_THROTTLE_MS = 4_000

const FACE_PATHS: Record<Mood, string> = {
  idle: "M 28 50 Q 40 56 52 50",
  watching: "M 28 50 Q 40 56 52 50",
  happy: "M 26 50 Q 40 64 54 50",
  worried: "M 28 56 Q 40 48 52 56",
  stuck: "M 30 52 L 50 52",
  thinking: "M 28 52 Q 40 58 52 52",
  sleeping: "M 28 52 Q 40 56 52 52",
  disconnected: "M 30 54 Q 40 50 50 54",
}

export function TabbyMascot(props: { baseUrl: string }) {
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const [mood, setMood] = createSignal<Mood>("idle")
  const [quip, setQuip] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(true)
  const [active, setActive] = createSignal(0)
  const [errored, setErrored] = createSignal(0)
  const [lastEvent, setLastEvent] = createSignal<number | null>(null)

  // Throttle quip output — fires once per QUIP_THROTTLE_MS, coalesces.
  let lastQuip = 0
  let pending: ReturnType<typeof setTimeout> | undefined
  function pickLocale(): "en" | "zh" {
    const v = language.locale()
    return v === "zh" ? "zh" : "en"
  }
  function speak(m: Mood) {
    const loc = pickLocale()
    if (m === "disconnected" || m === "idle") {
      setQuip(nextQuip(m, loc))
      return
    }
    const now = Date.now()
    if (now - lastQuip < QUIP_THROTTLE_MS) {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        lastQuip = Date.now()
        setQuip(nextQuip(m, pickLocale()))
      }, QUIP_THROTTLE_MS - (now - lastQuip))
      return
    }
    lastQuip = now
    setQuip(nextQuip(m, loc))
  }

  // Subscribe to the global SDK SSE stream. We only need a coarse
  // snapshot — counts and the last-event timestamp — so we don't process
  // every event in detail here.
  let unsub: (() => void) | undefined
  const setup = () => {
    unsub?.()
    if (!sdk.event) return
    unsub = sdk.event.listen((evt) => {
      setConnected(true)
      setLastEvent(Date.now())
      const event = evt.details
      switch (event.type) {
        case "session.created":
          setActive((n) => n + 1)
          break
        case "session.deleted":
          setActive((n) => Math.max(0, n - 1))
          break
        case "message.updated":
          if (event.properties.info.role === "assistant") {
            const info = event.properties.info as { error?: unknown }
            if (info.error) setErrored((n) => n + 1)
          }
          break
      }
    })
  }
  createEffect(() => {
    setup()
    onCleanup(() => unsub?.())
  })

  // Re-derive mood on every tick.
  const snapshot = createMemo(() => ({
    active_sessions: active(),
    errored_sessions: errored(),
    last_event_at: lastEvent(),
    last_error_at: null,
    connected: connected(),
  }))
  createEffect(() => {
    const m = deriveMood(snapshot(), Date.now())
    setMood(m)
    speak(m)
  })

  return (
    <div
      class="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2 pointer-events-none"
      aria-live="polite"
    >
      <Show when={quip()}>
        <div class="max-w-64 rounded-lg bg-surface-strong-base border border-border-weak-base px-3 py-1.5 text-12-regular text-text-base shadow-sm pointer-events-auto">
          {quip()}
        </div>
      </Show>
      <svg
        viewBox="0 0 80 80"
        width="80"
        height="80"
        class="pointer-events-auto drop-shadow"
        role="img"
        aria-label={`Tabby the cat — ${mood()}`}
      >
        {/* ears */}
        <polygon points="14,28 22,12 30,26" fill="currentColor" class="text-surface-strong-base" />
        <polygon points="66,28 58,12 50,26" fill="currentColor" class="text-surface-strong-base" />
        {/* head */}
        <circle cx="40" cy="44" r="28" fill="currentColor" class="text-surface-strong-base" />
        {/* eyes — closed when sleeping */}
        <Show
          when={mood() !== "sleeping"}
          fallback={
            <g stroke="currentColor" class="text-text-base" stroke-width="2" stroke-linecap="round" fill="none">
              <path d="M 28 42 q 4 -3 8 0" />
              <path d="M 44 42 q 4 -3 8 0" />
            </g>
          }
        >
          <ellipse cx="32" cy="42" rx="3" ry="4" fill="currentColor" class="text-text-base" />
          <ellipse cx="48" cy="42" rx="3" ry="4" fill="currentColor" class="text-text-base" />
        </Show>
        {/* nose + mouth */}
        <polygon points="40,52 38,55 42,55" fill="currentColor" class="text-text-weak" />
        <path d={FACE_PATHS[mood()]} stroke="currentColor" class="text-text-base" fill="none" stroke-width="2" stroke-linecap="round" />
      </svg>
    </div>
  )
}
