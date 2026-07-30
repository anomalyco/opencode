import { createMemo, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { sessionTitle } from "@/utils/session-title"
import { sessionHref, legacySessionHref, requireServerKey } from "@/utils/session-route"

export function SessionListPanel(props: { currentSessionID?: string }) {
  const sync = useSync()
  const sdk = useSDK()
  const params = useParams()
  const navigate = useNavigate()

  const sessions = createMemo(() => {
    return (sync().data.session ?? [])
      .filter((s) => !s.parentID && !s.time?.archived)
      .toSorted((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
  })

  return (
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]">
      <div class="shrink-0 px-3 pt-3 pb-2">
        <span class="text-13-regular text-v2-text-text-muted [font-weight:440]">
          Sessions ({sessions().length})
        </span>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div class="flex flex-col gap-px">
          <For each={sessions()}>
            {(session) => {
              const isCurrent = session.id === props.currentSessionID
              const status = session.id ? sync().data.session_status[session.id] : undefined
              const working = status?.type === "busy" || status?.type === "retry"
              return (
                <button
                  type="button"
                  class="flex h-10 min-w-0 items-center gap-2 rounded-[6px] border-0 bg-transparent py-3 pl-3 pr-3 text-left text-v2-text-text-muted [font-weight:530] transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
                  classList={{
                    "bg-v2-overlay-simple-overlay-hover": isCurrent,
                  }}
                  onClick={() => {
                    if (session.id === props.currentSessionID) return
                    const href = params.serverKey
                      ? sessionHref(requireServerKey(params.serverKey), session.id)
                      : legacySessionHref(sdk().directory, session.id)
                    navigate(href)
                  }}
                >
                  <span class="shrink-0 w-2 text-center text-11-regular">
                    <Show when={working} fallback={<span class="text-v2-text-text-faint">•</span>}>
                      <span class="inline-block size-2 rounded-full bg-v2-icon-icon-accent" />
                    </Show>
                  </span>
                  <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base">
                    {sessionTitle(session.title) || session.id}
                  </span>
                </button>
              )
            }}
          </For>
        </div>
      </div>
      <div class="shrink-0 border-t border-border-weaker-base px-3 py-2">
        <button
          type="button"
          class="flex h-8 w-full cursor-default items-center gap-2 rounded-[6px] border-0 bg-transparent px-3 text-left text-v2-text-text-muted [font-weight:530] transition-[background-color] duration-[120ms] ease-in-out hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
          onClick={() => navigate("/")}
        >
          <span class="text-v2-text-text-accent">+ New Session</span>
        </button>
      </div>
    </div>
  )
}
