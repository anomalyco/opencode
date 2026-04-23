import { UserMessage } from "@opencode-ai/sdk/v2"
import { ComponentProps, For, Match, Show, createSignal, onCleanup, splitProps, Switch } from "solid-js"
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
  let closeTimer: number | undefined

  const clearCloseTimer = () => {
    if (!closeTimer) return
    clearTimeout(closeTimer)
    closeTimer = undefined
  }

  const [hovercardOpen, setHovercardOpen] = createSignal(false)

  onCleanup(clearCloseTimer)

  const showHovercard = () => {
    clearCloseTimer()
    setHovercardOpen(true)
  }

  const hideHovercard = () => {
    clearCloseTimer()
    closeTimer = window.setTimeout(() => {
      setHovercardOpen(false)
      closeTimer = undefined
    }, 120) as unknown as number
  }

  const selectMessage = (message: UserMessage) => {
    clearCloseTimer()
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
        <div
          data-component="message-nav-hovercard"
          class={local.class}
          onPointerEnter={showHovercard}
          onPointerLeave={hideHovercard}
          onFocusIn={showHovercard}
          onFocusOut={(event) => {
            const next = event.relatedTarget
            if (next instanceof Node && event.currentTarget.contains(next)) return
            hideHovercard()
          }}
        >
          {content()}
          <Show when={hovercardOpen()}>
            <div class="message-nav-tooltip" data-slot="message-nav-tooltip-content">
              <MessageNav {...props} size="normal" class="" onMessageSelect={selectMessage} />
            </div>
          </Show>
        </div>
      </Match>
      <Match when={local.size === "normal"}>{content(local.class)}</Match>
    </Switch>
  )
}
