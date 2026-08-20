import type { UserMessage } from "../presentation"
import { HoverCard } from "@kobalte/core/hover-card"
import { ComponentProps, For, Match, Show, createMemo, createSignal, splitProps, Switch } from "solid-js"
import { useI18n } from "@opencode-ai/ui/context/i18n"

export function MessageNav(
  props: ComponentProps<"ul"> & {
    messages: UserMessage[]
    current?: UserMessage
    size: "normal" | "compact"
    onMessageSelect: (message: UserMessage) => void
    getLabel?: (message: UserMessage) => string | undefined
  },
) {
  const i18n = useI18n()
  const [local, others] = splitProps(props, ["messages", "current", "size", "onMessageSelect", "getLabel", "class"])
  const [hovercardOpen, setHovercardOpen] = createSignal(false)

  const selectMessage = (message: UserMessage) => {
    setHovercardOpen(false)
    local.onMessageSelect(message)
  }

  const content = (className?: string) => (
    <ul role="list" data-component="message-nav" data-size={local.size} class={className} {...others}>
      <For each={local.messages}>
        {(message) => {
          const handleClick = () => selectMessage(message)

          const handleKeyPress = (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            selectMessage(message)
          }

          return (
            <li data-slot="message-nav-item">
              <Switch>
                <Match when={local.size === "compact"}>
                  <div
                    data-slot="message-nav-tick-button"
                    data-active={message.id === local.current?.id || undefined}
                    role="button"
                    tabindex={0}
                    onClick={handleClick}
                    onKeyDown={handleKeyPress}
                  >
                    <div data-slot="message-nav-tick-line" />
                  </div>
                </Match>
                <Match when={local.size === "normal"}>
                  <button data-slot="message-nav-message-button" onClick={handleClick} onKeyDown={handleKeyPress}>
                    <MessageDiffBars changes={message.summary?.diffs ?? []} />
                    <div
                      data-slot="message-nav-title-preview"
                      data-active={message.id === local.current?.id || undefined}
                    >
                      <Show
                        when={local.getLabel?.(message) ?? message.summary?.title}
                        fallback={i18n.t("ui.messageNav.newMessage")}
                      >
                        {local.getLabel?.(message) ?? message.summary?.title}
                      </Show>
                    </div>
                  </button>
                </Match>
              </Switch>
            </li>
          )
        }}
      </For>
    </ul>
  )

  return (
    <Switch>
      <Match when={local.size === "compact"}>
        <HoverCard
          open={hovercardOpen()}
          onOpenChange={setHovercardOpen}
          openDelay={0}
          closeDelay={120}
          placement="right-start"
          gutter={8}
          overflowPadding={24}
          fitViewport
        >
          <HoverCard.Trigger as="div" data-component="message-nav-hovercard" class={local.class}>
            {content()}
          </HoverCard.Trigger>
          <HoverCard.Portal>
            <HoverCard.Content data-slot="message-nav-hovercard-content">
              <MessageNav {...props} size="normal" class="" onMessageSelect={selectMessage} />
            </HoverCard.Content>
          </HoverCard.Portal>
        </HoverCard>
      </Match>
      <Match when={local.size === "normal"}>{content(local.class)}</Match>
    </Switch>
  )
}

function MessageDiffBars(props: { changes: { additions: number; deletions: number }[] }) {
  const additions = createMemo(() => props.changes.reduce((total, diff) => total + diff.additions, 0))
  const deletions = createMemo(() => props.changes.reduce((total, diff) => total + diff.deletions, 0))
  const colors = createMemo(() => {
    const added = additions()
    const deleted = deletions()
    if (added === 0 && deleted === 0) return Array(5).fill("var(--icon-weak-base)")

    if (added + deleted < 5) {
      return [
        ...Array(added > 0 ? 1 : 0).fill("var(--icon-diff-add-base)"),
        ...Array(deleted > 0 ? 1 : 0).fill("var(--icon-diff-delete-base)"),
        ...Array(5 - (added > 0 ? 1 : 0) - (deleted > 0 ? 1 : 0)).fill("var(--icon-weak-base)"),
      ]
    }

    const total = added + deleted
    const ratio = added > deleted ? added / deleted : deleted / added
    const colored = total < 20 || ratio < 4 ? 4 : 5
    const addedRaw = (added / total) * colored
    const deletedRaw = (deleted / total) * colored
    const addedBars =
      added === 0 ? 0 : Math.min(added <= 5 ? 1 : added <= 10 ? 2 : colored, Math.max(1, Math.round(addedRaw)))
    const deletedBars =
      deleted === 0 ? 0 : Math.min(deleted <= 5 ? 1 : deleted <= 10 ? 2 : colored, Math.max(1, Math.round(deletedRaw)))
    const overflow = Math.max(0, addedBars + deletedBars - colored)
    const adjustedAdded = overflow > 0 && addedRaw > deletedRaw ? addedBars - overflow : addedBars
    const adjustedDeleted = overflow > 0 && addedRaw <= deletedRaw ? deletedBars - overflow : deletedBars
    return [
      ...Array(adjustedAdded).fill("var(--icon-diff-add-base)"),
      ...Array(adjustedDeleted).fill("var(--icon-diff-delete-base)"),
      ...Array(5 - adjustedAdded - adjustedDeleted).fill("var(--icon-weak-base)"),
    ]
  })

  return (
    <svg data-slot="message-nav-diff-bars" viewBox="0 0 18 14" aria-hidden="true">
      <For each={colors().slice(0, 5)}>
        {(color, index) => <rect x={index() * 4} width="2" height="14" rx="1" fill={color} />}
      </For>
    </svg>
  )
}
