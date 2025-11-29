import { UserMessage } from "@opencode-ai/sdk"
import { ComponentProps, createMemo, For, Match, Show, splitProps, Switch } from "solid-js"
import { DiffChanges } from "./diff-changes"
import { Spinner } from "./spinner"
import { Tooltip } from "@kobalte/core/tooltip"

export function MessageNav(
  props: ComponentProps<"ul"> & {
    messages: UserMessage[]
    current?: UserMessage
    size: "normal" | "compact"
    working?: boolean
    onMessageSelect: (message: UserMessage) => void
  },
) {
  const [local, others] = splitProps(props, ["messages", "current", "size", "working", "onMessageSelect"])
  const lastUserMessage = createMemo(() => {
    return local.messages?.at(0)
  })

  const content = () => (
    <ul role="list" data-component="message-nav" data-size={local.size} {...others}>
      <For each={local.messages}>
        {(message) => {
          const messageWorking = createMemo(() => message.id === lastUserMessage()?.id && local.working)
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
                    <Switch>
                      <Match when={messageWorking()}>
                        <Spinner />
                      </Match>
                      <Match when={true}>
                        <DiffChanges changes={message.summary?.diffs ?? []} variant="bars" />
                      </Match>
                    </Switch>
                    <div
                      data-slot="message-nav-title-preview"
                      data-active={message.id === local.current?.id || undefined}
                    >
                      <Show when={message.summary?.title} fallback="New message">
                        {message.summary?.title}
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
        <Tooltip openDelay={0} closeDelay={300} placement="left-start" gutter={-65} shift={-16} overlap>
          <Tooltip.Trigger as="div">{content()}</Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content data-slot="message-nav-tooltip">
              <div data-slot="message-nav-tooltip-content">
                <MessageNav {...props} size="normal" class="" />
              </div>
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip>
      </Match>
      <Match when={local.size === "normal"}>{content()}</Match>
    </Switch>
  )
}
