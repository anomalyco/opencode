import { Component, createMemo, For, Match, Show, Switch } from "solid-js"
import { Dynamic } from "solid-js/web"
import {
  AssistantMessage,
  Message as MessageType,
  Part as PartType,
  TextPart,
  ToolPart,
  UserMessage,
} from "@opencode-ai/sdk"

export interface MessageProps {
  message: MessageType
  parts: PartType[]
}

export interface MessagePartProps {
  part: PartType
  message: MessageType
  hideDetails?: boolean
}

export type PartComponent = Component<MessagePartProps>

const PART_MAPPING: Record<string, PartComponent | undefined> = {}

export function registerPartComponent(type: string, component: PartComponent) {
  PART_MAPPING[type] = component
}

export function Message(props: MessageProps) {
  return (
    <Switch>
      <Match when={props.message.role === "user" && props.message}>
        {(userMessage) => (
          <UserMessageDisplay message={userMessage() as UserMessage} parts={props.parts} />
        )}
      </Match>
      <Match when={props.message.role === "assistant" && props.message}>
        {(assistantMessage) => (
          <AssistantMessageDisplay
            message={assistantMessage() as AssistantMessage}
            parts={props.parts}
          />
        )}
      </Match>
    </Switch>
  )
}

export function AssistantMessageDisplay(props: { message: AssistantMessage; parts: PartType[] }) {
  const filteredParts = createMemo(() => {
    return props.parts?.filter((x) => {
      if (x.type === "reasoning") return false
      return x.type !== "tool" || (x as ToolPart).tool !== "todoread"
    })
  })
  return (
    <div data-component="assistant-message">
      <For each={filteredParts()}>{(part) => <Part part={part} message={props.message} />}</For>
    </div>
  )
}

export function UserMessageDisplay(props: { message: UserMessage; parts: PartType[] }) {
  const text = createMemo(() =>
    props.parts
      ?.filter((p) => p.type === "text" && !(p as TextPart).synthetic)
      ?.map((p) => (p as TextPart).text)
      ?.join(""),
  )
  return <div data-component="user-message">{text()}</div>
}

export function Part(props: MessagePartProps) {
  const component = createMemo(() => PART_MAPPING[props.part.type])
  return (
    <Show when={component()}>
      <Dynamic
        component={component()}
        part={props.part}
        message={props.message}
        hideDetails={props.hideDetails}
      />
    </Show>
  )
}
