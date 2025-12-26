import { UserMessage } from "@opencode-ai/sdk/v2"
import { ComponentProps, Show, splitProps } from "solid-js"
import { MessageNav } from "./message-nav"
import "./session-message-rail.css"

export interface SessionMessageRailProps extends ComponentProps<"div"> {
  messages: UserMessage[]
  current?: UserMessage
  wide?: boolean
  onMessageSelect: (message: UserMessage) => void
}

export function SessionMessageRail(props: SessionMessageRailProps) {
  const [local, others] = splitProps(props, ["messages", "current", "wide", "onMessageSelect", "class", "classList"])

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
          />
        </div>
        <div data-slot="session-message-rail-full">
          <MessageNav
            messages={local.messages}
            current={local.current}
            onMessageSelect={local.onMessageSelect}
            size={local.wide ? "normal" : "compact"}
          />
        </div>
      </div>
    </Show>
  )
}
