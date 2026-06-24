/**
 * Tabby side panel — keyboard-toggleable drawer (Cmd/Ctrl+B) that
 * surfaces the live status line, quick actions, and an Ask box.
 *
 * Implementation is intentionally minimal in this milestone: the panel
 * reads the SSE snapshot, renders a status line, and the Ask box
 * currently shows a static answer. A future milestone hands off to the
 * Run Claude page via `opencode://session` deep links.
 */

import { createMemo, createSignal, For, Show } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { deriveMood } from "@/utils/monitor-tabby"

export function TabbyPanel(props: { baseUrl: string }) {
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const [open, setOpen] = createSignal(false)
  const [ask, setAsk] = createSignal("")
  const [answer, setAnswer] = createSignal<string | null>(null)
  const [active, setActive] = createSignal(0)
  const [errored, setErrored] = createSignal(0)
  const [connected, setConnected] = createSignal(true)

  if (typeof window !== "undefined") {
    makeEventListener(window, "keydown", (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === "Escape") setOpen(false)
    })
  }

  let unsub: (() => void) | undefined
  const setup = () => {
    unsub?.()
    if (!sdk.event) return
    unsub = sdk.event.listen((evt) => {
      setConnected(true)
      const event = evt.details
      if (event.type === "session.created") setActive((n) => n + 1)
      if (event.type === "session.deleted") setActive((n) => Math.max(0, n - 1))
    })
  }
  setup()

  const mood = createMemo(() =>
    deriveMood(
      {
        active_sessions: active(),
        errored_sessions: errored(),
        last_event_at: null,
        last_error_at: null,
        connected: connected(),
      },
      Date.now(),
    ),
  )

  function submitAsk() {
    const q = ask().trim().toLowerCase()
    if (!q) return
    if (q.includes("running") || q.includes("live")) {
      setAnswer(`${active()} active`)
    } else if (q.includes("error")) {
      setAnswer(`${errored()} errored`)
    } else {
      setAnswer("Hand off to Run Claude: opencode://session")
    }
  }

  return (
    <Show when={open()}>
      <aside
        class="fixed bottom-20 right-4 z-50 w-72 rounded-lg bg-surface-strong-base border border-border-weak-base shadow-md p-3 flex flex-col gap-2 text-12-regular"
        aria-label={language.t("monitor.tabby.panel_title")}
      >
        <header class="flex items-center justify-between">
          <span class="text-13-medium text-text-base">
            {language.t("monitor.tabby.panel_title")}
          </span>
          <span
            classList={{
              "size-2 rounded-full": true,
              "bg-status-working-base": mood() === "watching" || mood() === "happy",
              "bg-status-error-base": mood() === "worried",
              "bg-border-weak-base":
                mood() === "idle" || mood() === "sleeping" || mood() === "disconnected",
            }}
            aria-label={`mood: ${mood()}`}
          />
        </header>
        <p class="text-12-regular text-text-weak">
          {language.t("monitor.tabby.live", { n: active() })} ·{" "}
          {language.t("monitor.tabby.errored", { n: errored() })} ·{" "}
          {connected() ? "online" : "offline"}
        </p>

        <div class="flex gap-2">
          <input
            type="text"
            value={ask()}
            onInput={(e) => setAsk(e.currentTarget.value)}
            placeholder={language.t("monitor.tabby.ask_placeholder")}
            class="flex-1 px-2 py-1 rounded border border-border-weak-base bg-surface-base text-12-regular"
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAsk()
            }}
          />
          <button
            type="button"
            onClick={submitAsk}
            class="px-2 py-1 rounded bg-surface-base text-text-base border border-border-weak-base"
          >
            {language.t("monitor.tabby.ask")}
          </button>
        </div>
        <Show when={answer()}>
          <p class="text-12-regular text-text-base italic">→ {answer()}</p>
        </Show>
      </aside>
    </Show>
  )
}
