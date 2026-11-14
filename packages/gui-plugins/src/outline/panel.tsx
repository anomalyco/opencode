import type { SessionMessageUser } from "@opencode/client/promise"
import type { MountedSession, SessionScreen } from "@opencode/plugin/gui"
import { usePlugin } from "@opencode/plugin/gui"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { showToast } from "@opencode/ui/toast"
import { useI18n } from "@opencode/ui/context/i18n"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"

type OutlinePrompt = {
  id: string
  text: string
  created: number
}

const MAX_PAGE = 200

function promptText(message: SessionMessageUser) {
  return String(message.text ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

export default function SessionOutlinePanel(props: { session: MountedSession; screen: SessionScreen }) {
  const ctx = usePlugin()
  const i18n = useI18n()
  const [items, setItems] = createSignal<OutlinePrompt[]>([])
  const [query, setQuery] = createSignal("")
  const [status, setStatus] = createSignal<"loading" | "ready" | "error">("loading")
  const [error, setError] = createSignal("")

  const client = () => props.session.server.client
  const sessionID = () => props.session.id

  const clock = createMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale(), {
        hour: "2-digit",
        minute: "2-digit",
      }),
  )

  const load = async (id: string, silent: boolean) => {
    if (!silent) setStatus("loading")
    try {
      const rows: OutlinePrompt[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const response = await client().message.list({
          sessionID: id,
          type: "user",
          limit: MAX_PAGE,
          ...(cursor ? { cursor } : { order: "asc" }),
        })
        for (const message of response.data) {
          if (message.type !== "user") continue
          const text = promptText(message)
          rows.push({ id: message.id, text: text || message.id, created: message.time?.created ?? 0 })
        }
        cursor = response.cursor?.next ?? undefined
        if (!cursor) break
      }
      if (sessionID() !== id) return
      setItems(rows)
      setStatus("ready")
      setError("")
    } catch (cause) {
      if (sessionID() !== id) return
      setStatus("error")
      setError(String((cause as Error)?.message ?? cause))
    }
  }

  createEffect(
    on(
      () => props.session.id,
      (id) => {
        setItems([])
        setQuery("")
        void load(id, false)
      },
      { defer: true },
    ),
  )

  const timer = setInterval(() => {
    if (document.visibilityState !== "visible") return
    const id = sessionID()
    if (id) void load(id, true)
  }, 5000)
  onCleanup(() => clearInterval(timer))

  const rows = createMemo(() => {
    const needle = query().trim().toLowerCase()
    if (!needle) return items()
    return items().filter((item) => item.text.toLowerCase().includes(needle))
  })

  const count = () => ctx.t("outline.count", { count: items().length })

  const quote = (item: OutlinePrompt) => {
    const composer = props.screen.composer
    if (!composer.quotable()) {
      showToast({ title: ctx.t("outline.title"), description: ctx.t("outline.quote.unavailable") })
      return
    }
    const commentID =
      typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `outline-${Date.now()}-${item.id}`
    composer.attach({
      type: "quote",
      commentID,
      text: item.text,
      source: {
        label: ctx.t("outline.quote.source"),
        icon: "outline-quote",
        subject: ctx.t("outline.quote.subject"),
      },
    })
    composer.focus(commentID)
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-outline-panel">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-v2-border-border-base px-3">
        <Icon name="bullet-list" size="small" />
        <span class="min-w-0 truncate text-12-medium">{ctx.t("outline.title")}</span>
        <span class="ml-auto shrink-0 text-11-regular text-text-weak">
          {status() === "loading" && !items().length ? ctx.t("outline.loading") : count()}
        </span>
        <IconButton
          size="small"
          variant="ghost-muted"
          icon={<Icon name="refresh" size="small" />}
          aria-label={ctx.t("outline.refresh")}
          onClick={() => void load(sessionID(), false)}
        />
        <IconButton
          size="small"
          variant="ghost-muted"
          icon={<Icon name="arrow-down-to-line" size="small" />}
          aria-label={ctx.t("outline.latest")}
          onClick={() => props.screen.timeline.jumpToLatest()}
        />
      </div>

      <div class="shrink-0 px-3 py-2">
        <input
          type="search"
          class="w-full rounded-md border border-v2-border-border-base bg-v2-background-bg-base px-2 py-1 text-12-regular text-v2-text-text-base outline-none placeholder:text-text-weak"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder={ctx.t("outline.search.placeholder")}
          aria-label={ctx.t("outline.title")}
          spellcheck={false}
          autocorrect="off"
          autocomplete="off"
          autocapitalize="off"
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4" data-scrollable>
        <Show when={status() === "error" && !items().length}>
          <div class="flex flex-col gap-2 px-2 py-4 text-12-regular text-text-weak">
            <span>{ctx.t("outline.error")}</span>
            <Show when={error()}>
              <span class="break-words">{error()}</span>
            </Show>
            <button
              type="button"
              class="self-start rounded-md px-2 py-1 text-12-regular hover:bg-v2-background-bg-layer-01"
              onClick={() => void load(sessionID(), false)}
            >
              {ctx.t("outline.retry")}
            </button>
          </div>
        </Show>

        <Show when={status() !== "error" || items().length > 0}>
          <Show when={status() !== "loading" || items().length > 0} fallback={<div class="px-2 py-4 text-12-regular text-text-weak">{ctx.t("outline.loading")}</div>}>
            <Show when={items().length > 0} fallback={<div class="px-2 py-4 text-12-regular text-text-weak">{ctx.t("outline.empty")}</div>}>
              <Show when={rows().length > 0} fallback={<div class="px-2 py-4 text-12-regular text-text-weak">{ctx.t("outline.noResults")}</div>}>
                <For each={rows()}>
                  {(item, index) => (
                    <div class="group flex items-start gap-1">
                      <button
                        type="button"
                        class="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-v2-background-bg-layer-01"
                        title={item.text}
                        onClick={() => props.screen.timeline.revealMessage(item.id)}
                      >
                        <span class="w-5 shrink-0 text-right text-11-regular leading-5 text-text-weak">
                          {index() + 1}
                        </span>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-12-regular">{item.text}</span>
                          <Show when={item.created}>
                            <span class="block text-11-regular text-text-weak">
                              {clock().format(item.created)}
                            </span>
                          </Show>
                        </span>
                      </button>
                      <button
                        type="button"
                        class="mt-1 shrink-0 rounded-md p-1 text-text-weak opacity-50 hover:bg-v2-background-bg-layer-01 group-hover:opacity-100"
                        aria-label={ctx.t("outline.quote")}
                        onClick={() => quote(item)}
                      >
                        <Icon name="outline-quote" size="small" />
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  )
}
