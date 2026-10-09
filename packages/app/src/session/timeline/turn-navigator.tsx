import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { createEffect, createMemo, createSelector, For, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { readPromptPresentation } from "@/composer/comment-note"
import { useServerSDK } from "@/runtime/server/client"

const turnPageLimit = 200

// Previews clamp to a few lines; keep only enough text to fill them.
const previewLength = 400

// How long after the timeline mounts the rail loads, clear of session entry and tab switch rendering.
const railDelay = 1000

// A pointer resting this long on an unloaded turn fetches its reply; sweeping across the rail fetches nothing.
const replyHoverDelay = 150

type TurnNavigatorProps = {
  sessionID: string
  messages: Accessor<SessionMessageInfo[]>
  /** Whether the loaded messages reach the start of the session, making the index redundant. */
  complete: Accessor<boolean>
  assistantMessagesByParent: Accessor<Map<string, SessionMessageAssistant[]>>
  revertMessageID: Accessor<string | undefined>
  activeUserMessageID: Accessor<string | undefined>
  onSelect: (id: string) => void
}

/**
 * A mouse rail of the session's user turns beside the timeline. While older history is unloaded, turns come from the
 * server's user-message index, and hovering an unloaded turn fetches only its latest reply. Keyboard users move
 * between turns with the previous and next message commands.
 *
 * Nothing loads or renders until shortly after the timeline mounts, which keeps the rail off session entry and tab
 * switches. The rail then appears once it lists every turn, so it never grows under the pointer.
 */
export function TurnNavigator(props: TurnNavigatorProps) {
  const sdk = useServerSDK()
  const [state, setState] = createStore<{ engaged: boolean; index?: Map<string, string> }>({ engaged: false })
  let root: HTMLDivElement | undefined

  const loadIndex = async (cursor?: string): Promise<[string, string][]> => {
    const page = await sdk.api.message.list({
      sessionID: props.sessionID,
      type: "user",
      limit: turnPageLimit,
      ...(cursor ? { cursor } : { order: "asc" as const }),
    })
    const turns = page.data.flatMap((message) =>
      message.type === "user" ? [[message.id, promptPreview(message)] as [string, string]] : [],
    )

    if (page.data.length < turnPageLimit || !page.cursor.next) return turns

    return [...turns, ...(await loadIndex(page.cursor.next))]
  }

  onMount(() => {
    const timer = setTimeout(() => {
      // The rail is a mouse affordance; touch-only devices never load it.
      if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return
      setState("engaged", true)

      if (props.complete()) return
      // Plain state rather than a resource: a pending resource would suspend the timeline it decorates.
      // On failure the rail lists the loaded turns.
      void loadIndex()
        .catch(() => [])
        .then((turns) => setState("index", new Map(turns)))
    }, railDelay)
    onCleanup(() => clearTimeout(timer))
  })

  return (
    <div
      ref={root}
      data-component="session-turn-navigator"
      aria-hidden="true"
      class="absolute start-0 top-14 bottom-20 z-[50] flex w-5 flex-col justify-center pointer-events-none"
    >
      <Show when={state.engaged && (props.complete() || state.index)}>
        <TurnRail {...props} index={state.index} root={root!} />
      </Show>
    </div>
  )
}

function TurnRail(props: TurnNavigatorProps & { index?: Map<string, string>; root: HTMLDivElement }) {
  const sdk = useServerSDK()
  // Fetched replies by user message ID; null while loading or when the turn has no reply text.
  const [state, setState] = createStore<{
    hover?: { id: string; top: number }
    replies: Record<string, string | null>
  }>({ replies: {} })

  const loaded = createMemo(
    () =>
      new Map(props.messages().flatMap((message) => (message.type === "user" ? [[message.id, message] as const] : []))),
  )

  const turns = createMemo(() => {
    const revert = props.revertMessageID()

    return [...new Set([...(props.index?.keys() ?? []), ...loaded().keys()])]
      .filter((id) => !revert || id < revert)
      .toSorted()
  })

  // The turn's latest reply is the newest assistant message before the next turn.
  const loadReply = async (id: string) => {
    setState("replies", id, null)
    const list = turns()
    const next = list[list.indexOf(id) + 1] ?? props.revertMessageID()
    const page = await sdk.api.message.list({
      sessionID: props.sessionID,
      type: "assistant",
      limit: 1,
      ...(next ? { before: next } : {}),
    })
    const message = page.data[0]

    if (message?.type !== "assistant" || message.id < id) return
    setState("replies", id, replyText([message]) ?? null)
  }

  createEffect(() => {
    const id = state.hover?.id

    if (!id || loaded().has(id) || state.replies[id] !== undefined) return
    const timer = setTimeout(() => void loadReply(id).catch(() => undefined), replyHoverDelay)
    onCleanup(() => clearTimeout(timer))
  })

  const active = createSelector(props.activeUserMessageID)
  const hovered = createSelector(() => state.hover?.id)

  const preview = createMemo(() => {
    const hover = state.hover

    if (!hover) return
    const message = loaded().get(hover.id)

    return {
      top: hover.top,
      prompt: message ? promptPreview(message) : props.index?.get(hover.id),
      response: message
        ? replyText(props.assistantMessagesByParent().get(hover.id) ?? [])
        : (state.replies[hover.id] ?? undefined),
    }
  })

  const turnAt = (event: MouseEvent) =>
    event.target instanceof Element ? event.target.closest<HTMLElement>("[data-turn]") : null

  const hover = (event: PointerEvent) => {
    const tick = turnAt(event)
    const id = tick?.dataset.turn

    if (!tick || !id || state.hover?.id === id) return
    const box = tick.getBoundingClientRect()
    setState("hover", { id, top: box.top + box.height / 2 - props.root.getBoundingClientRect().top })
  }

  return (
    <Show when={turns().length > 1}>
      <div
        // Hovering the rail widens it and doubles every tick; ticks size from per-state widths times the rail scale.
        class="flex max-h-full min-h-0 w-5 cursor-pointer flex-col py-1 pointer-events-auto transition-[width] duration-150 [--rail-faint:var(--v2-icon-icon-faint)] [--rail-scale:1] hover:w-9 hover:[--rail-faint:var(--v2-icon-icon-muted)] hover:[--rail-scale:2] motion-reduce:transition-none"
        onPointerMove={hover}
        onPointerLeave={() => setState("hover", undefined)}
        onClick={(event) => {
          const id = turnAt(event)?.dataset.turn

          if (id) props.onSelect(id)
        }}
      >
        <For each={turns()}>
          {(id) => (
            <div
              data-turn={id}
              data-state={hovered(id) ? "hovered" : active(id) ? "active" : undefined}
              class="flex h-2 min-h-0 w-full shrink items-center ps-1 [--tick-color:var(--rail-faint)] [--tick-width:8px] data-[state=active]:[--tick-color:var(--v2-icon-icon-base)] data-[state=active]:[--tick-width:12px] data-[state=hovered]:[--tick-color:var(--v2-text-text-base)] data-[state=hovered]:[--tick-width:14px]"
            >
              <span class="block h-0.5 w-[calc(var(--tick-width)*var(--rail-scale))] rounded-full bg-(--tick-color) transition-[width,background-color] duration-150 motion-reduce:transition-none" />
            </div>
          )}
        </For>
      </div>
      <Show when={preview()}>
        {(item) => (
          <div
            data-slot="session-turn-navigator-preview"
            class="absolute start-11 w-[320px] max-w-[calc(100vw-4rem)] -translate-y-1/2 rounded-lg bg-v2-background-bg-base px-3 py-2"
            style={{ top: `${item().top}px`, "box-shadow": "var(--v2-elevation-raised)" }}
          >
            <p class="line-clamp-2 text-[13px] font-[530] leading-text-compact text-v2-text-text-base">
              {item().prompt}
            </p>
            <Show when={item().response}>
              {(text) => (
                <p class="mt-1 line-clamp-3 text-[13px] leading-text-compact text-v2-text-text-muted">{text()}</p>
              )}
            </Show>
          </div>
        )}
      </Show>
    </Show>
  )
}

function promptPreview(message: SessionMessageUser) {
  return previewText(readPromptPresentation(message.metadata)?.displayText ?? message.text)
}

function replyText(messages: SessionMessageAssistant[]) {
  const text = messages
    .flatMap((message) => message.content)
    .findLast((content) => content.type === "text" && content.text.trim())

  return text?.type === "text" ? previewText(text.text) : undefined
}

function previewText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, previewLength)
}
