import { type ContextItem, type Prompt, type usePrompt } from "@/context/prompt"

type PromptTarget = ReturnType<ReturnType<typeof usePrompt>["capture"]>

export function createPromptSubmissionState(input: {
  target: PromptTarget
  prompt: Prompt
  context: (ContextItem & { key: string })[]
}) {
  let target = input.target
  let cleared: Prompt | undefined

  return {
    prompt: input.prompt,
    context: input.context,
    target: () => target,
    clear() {
      target.reset()
      cleared = target.current()
    },
    retarget(next: PromptTarget) {
      input.context.forEach(next.context.add)
      target = next
    },
    current: (value: PromptTarget) => target === value,
    restore() {
      if (cleared !== undefined && target.current() !== cleared) return
      return { target, prompt: input.prompt, context: input.context }
    },
  }
}
