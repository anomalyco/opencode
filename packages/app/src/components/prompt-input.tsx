import type { Component } from "solid-js"
import { PromptInputV2Composer, usePromptInputV2Controller } from "./prompt-input-v2"
import { createPromptInputHistory, type PromptInputHistory } from "./prompt-input/history-store"
import type {
  PromptInputControls,
  PromptInputProps,
  PromptInputState,
  PromptInputSubmission,
} from "./prompt-input/contracts"

export { createPromptInputHistory }
export type { PromptInputControls, PromptInputHistory, PromptInputProps, PromptInputState, PromptInputSubmission }

export const PromptInput: Component<PromptInputProps> = (props) => {
  const controller = usePromptInputV2Controller(props)
  return <PromptInputV2Composer class={props.class} controller={controller} />
}
