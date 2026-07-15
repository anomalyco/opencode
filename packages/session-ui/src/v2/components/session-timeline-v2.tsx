import type { Message, SessionStatus, UserMessage } from "@opencode-ai/sdk/v2"
import type { UserActions } from "../../components/message-part"
import { SessionTurn } from "../../components/session-turn"
import { For, type ParentProps } from "solid-js"

export type SessionTimelineV2Props = ParentProps<{
  sessionID: string
  messages: Message[]
  userMessages?: UserMessage[]
  actions?: UserActions
  status?: SessionStatus
  showReasoningSummaries?: boolean
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  onUserInteracted?: () => void
  classes?: {
    root?: string
    turn?: string
    content?: string
    container?: string
  }
}>

export function SessionTimelineV2(props: SessionTimelineV2Props) {
  const userMessages = () =>
    props.userMessages ?? props.messages.filter((message): message is UserMessage => message.role === "user")

  return (
    <div role="log" data-slot="session-turn-list" class={props.classes?.root}>
      <For each={userMessages()}>
        {(message) => (
          <SessionTurn
            sessionID={props.sessionID}
            messageID={message.id}
            messages={props.messages}
            actions={props.actions}
            status={props.status}
            showReasoningSummaries={props.showReasoningSummaries}
            shellToolDefaultOpen={props.shellToolDefaultOpen}
            editToolDefaultOpen={props.editToolDefaultOpen}
            onUserInteracted={props.onUserInteracted}
            useV2Actions
            classes={{
              root: props.classes?.turn,
              content: props.classes?.content,
              container: props.classes?.container,
            }}
          />
        )}
      </For>
      {props.children}
    </div>
  )
}
