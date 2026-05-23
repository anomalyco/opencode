type AssistantLoopState = {
  readonly id?: string
  readonly finish?: string
  readonly parentID?: string
}

export function shouldExitPromptLoop(input: {
  readonly lastAssistant?: AssistantLoopState
  readonly lastUserID: string
  readonly hasToolCalls: boolean
}) {
  return (
    input.lastAssistant?.finish !== undefined &&
    !["tool-calls"].includes(input.lastAssistant.finish) &&
    !input.hasToolCalls &&
    input.lastAssistant.parentID === input.lastUserID
  )
}
