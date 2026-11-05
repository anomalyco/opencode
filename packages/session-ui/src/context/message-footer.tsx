import type { SessionMessageAssistant, SessionMessageUser } from "@opencode/client/promise"
import { createContext, useContext, type JSX, type ParentProps } from "solid-js"

/** A message the timeline shows a footer under. Fields are getters over the live projection. */
export type MessageFooterTarget =
  | {
      readonly role: "user"
      readonly info: SessionMessageUser
    }
  | {
      readonly role: "assistant"
      /** The user message the response answers. */
      readonly promptID: string
      /** The response's steps, oldest first. */
      readonly messages: readonly SessionMessageAssistant[]
      /** The model stopped working on the response. */
      readonly completed: boolean
    }

/** What the host renders under messages. */
export type MessageFooters = {
  /** Whether anything renders under messages. Rows mount again when it changes, so read it only there. */
  readonly enabled: () => boolean
  /** Renders the footer content for one message. */
  readonly render: (target: MessageFooterTarget) => JSX.Element
}

const context = createContext<MessageFooters>()

/** Lets the host render content under each user message and assistant response. Without it, rows render no footer. */
export function MessageFootersProvider(props: ParentProps<{ value: MessageFooters }>) {
  return <context.Provider value={props.value}>{props.children}</context.Provider>
}

export const useMessageFooters = () => useContext(context)
