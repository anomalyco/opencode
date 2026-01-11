import { UserMessage } from "@opencode-ai/sdk/v2"
import { ComponentProps, For, Match, Show, splitProps, Switch } from "solid-js"
import { DiffChanges } from "./diff-changes"
import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { Tooltip } from "./tooltip"
import { Icon } from "./icon"

export function MessageNav(
  props: ComponentProps<"ul"> & {
    messages: UserMessage[]
    current?: UserMessage
    size: "normal" | "compact"
    onMessageSelect: (message: UserMessage) => void
    onFork?: (message: UserMessage) => void
  },
) {
  const [local, others] = splitProps(props, ["messages", "current", "size", "onMessageSelect", "onFork"])

  const content = () => (
    <ul role="list" data-component="message-nav" data-size={local.size} {...others}>
      <For each={local.messages}>
        {(message) => {
          const handleClick = () => local.onMessageSelect(message)

          return (
            <li data-slot="message-nav-item">
              <Switch>
                <Match when={local.size === "compact"}>
                  <div data-slot="message-nav-tick-button" data-active={message.id === local.current?.id || undefined}>
                    <div data-slot="message-nav-tick-line" />
                  </div>
                </Match>
                <Match when={local.size === "normal"}>
                  <button data-slot="message-nav-message-button" onClick={handleClick}>
                    <DiffChanges changes={message.summary?.diffs ?? []} variant="bars" />
                    <div
                      data-slot="message-nav-title-preview"
                      data-active={message.id === local.current?.id || undefined}
                    >
                      <Show when={message.summary?.title} fallback="New message">
                        {message.summary?.title}
                      </Show>
                    </div>
                  </button>
                  <Show when={local.onFork}>
                    <Tooltip value="Fork from here" placement="top">
                      <button
                        data-slot="message-nav-fork-button"
                        onClick={(e) => {
                          e.stopPropagation()
                          local.onFork?.(message)
                        }}
                      >
                        <Icon name="branch" size="small" />
                      </button>
                    </Tooltip>
                  </Show>
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
        <KobalteTooltip openDelay={0} closeDelay={300} placement="right-start" gutter={-40} shift={-10} overlap>
          <KobalteTooltip.Trigger as="div">{content()}</KobalteTooltip.Trigger>
          <KobalteTooltip.Portal>
            <KobalteTooltip.Content data-slot="message-nav-tooltip">
              <div data-slot="message-nav-tooltip-content">
                <MessageNav {...props} size="normal" class="" />
              </div>
            </KobalteTooltip.Content>
          </KobalteTooltip.Portal>
        </KobalteTooltip>
      </Match>
      <Match when={local.size === "normal"}>{content()}</Match>
    </Switch>
  )
}
