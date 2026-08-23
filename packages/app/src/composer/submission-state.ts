import type { ComposerState, ContextItem, Prompt } from "./state"

export type ComposerStateTarget = ReturnType<ComposerState["capture"]>

export function createComposerSubmission(input: {
  target: ComposerStateTarget
  prompt: Prompt
  context: (ContextItem & { key: string })[]
}) {
  const initial = input.target
  let target = input.target
  let cleared: Prompt | undefined

  return {
    prompt: input.prompt,
    context: input.context,
    target: () => target,
    clear() {
      if (initial !== target) initial.reset()
      target.reset()
      cleared = target.current()
    },
    retarget(next: ComposerStateTarget) {
      input.context.forEach((item) => next.context.add(item))
      target = next
    },
    current: (value: ComposerStateTarget) => target === value,
    restore() {
      if (cleared !== undefined && target.current() !== cleared) return
      return { target, prompt: input.prompt, context: input.context }
    },
  }
}
