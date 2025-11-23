import { UserMessage } from "@opencode-ai/sdk"
import { ComponentProps, createMemo, For, Match, Show, splitProps, Switch } from "solid-js"
import { DiffChanges } from "./diff-changes"
import { Spinner } from "./spinner"

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

  return (
    <ul role="list" data-component="message-nav" data-size={local.size} {...others}>
      <For each={local.messages}>
        {(message) => {
          const messageWorking = createMemo(() => message.id === lastUserMessage()?.id && local.working)
          const handleClick = () => local.onMessageSelect(message)

          return (
            <li data-slot="message-nav-item">
              <Switch>
                <Match when={local.size === "compact"}>
                  <button
                    data-slot="message-nav-tick-button"
                    data-active={message.id === local.current?.id || undefined}
                    onClick={handleClick}
                  >
                    <div data-slot="message-nav-tick-line" />
                  </button>
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
}
