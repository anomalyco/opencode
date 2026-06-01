import { UserMessage } from "@opencode-ai/sdk/v2"
import { HoverCard } from "@kobalte/core/hover-card"
import { ComponentProps, For, Match, Show, createSignal, splitProps, Switch } from "solid-js"
import { DiffChanges } from "./diff-changes"
import { useI18n } from "../context/i18n"

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
                    <DiffChanges changes={message.summary?.diffs ?? []} variant="bars" />
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
