import { UserMessage } from "@opencode-ai/sdk"
import { ComponentProps, Show, splitProps } from "solid-js"
import { MessageNav } from "./message-nav"
import "./session-message-rail.css"

export interface SessionMessageRailProps extends ComponentProps<"div"> {
  messages: UserMessage[]
  current?: UserMessage
  working?: boolean
  wide?: boolean
  onMessageSelect: (message: UserMessage) => void
}

export function SessionMessageRail(props: SessionMessageRailProps) {
  const [local, others] = splitProps(props, [
    "messages",
    "current",
    "working",
    "wide",
    "onMessageSelect",
    "class",
    "classList",
  ])

  return (
    <Show when={(local.messages?.length ?? 0) > 1}>
      <div
        {...others}
        data-component="session-message-rail"
        data-wide={local.wide ? "" : undefined}
        classList={{
          ...(local.classList ?? {}),
          [local.class ?? ""]: !!local.class,
        }}
      >
        <div data-slot="session-message-rail-compact">
          <MessageNav
            messages={local.messages}
            current={local.current}
            onMessageSelect={local.onMessageSelect}
            size="compact"
            working={local.working}
          />
        </div>
        <div data-slot="session-message-rail-full">
          <MessageNav
            messages={local.messages}
            current={local.current}
            onMessageSelect={local.onMessageSelect}
            size={local.wide ? "normal" : "compact"}
            working={local.working}
          />
        </div>
      </div>
    </Show>
  )
}
