import { batch } from "solid-js"
import type { PromptModel } from "@/context/prompt-state"

export function createPromptAgentSelection(input: {
  agent: {
    current(): { model?: Omit<PromptModel, "variant">; variant?: string } | undefined
    set(name: string | undefined): void
    move(direction: 1 | -1): void
  }
  model: {
    current(): PromptModel | undefined
    set(model: PromptModel | undefined): void
  }
}) {
  const update = (select: () => void) =>
    batch(() => {
      select()
      const agent = input.agent.current()
      if (!agent) return
      const previous = input.model.current()
      const model = agent.model ?? previous
      if (!model) return
      input.model.set({ ...model, variant: agent.variant ?? previous?.variant })
    })

  return {
    set: (name: string | undefined) => update(() => input.agent.set(name)),
    move: (direction: 1 | -1) => update(() => input.agent.move(direction)),
  }
}
