import type { ComposerState, ContextItem, Prompt } from "./state"
import { appendPrompt, clonePrompt, isAttachment } from "./prompt-parts"

export type ComposerStateTarget = ReturnType<ComposerState["capture"]>

export function createComposerSubmission(input: {
  target: ComposerStateTarget
  prompt: Prompt
  context: (ContextItem & { key: string })[]
}) {
  const initial = input.target

  const sources = input.context.flatMap((item) => {
    const source = initial.quoteSource.state.sources[item.key]

    return source ? [{ key: item.key, source }] : []
  })

  let target = input.target
  let cleared: Prompt | undefined
  let following: Prompt | undefined
  let preserveDraft = false

  return {
    prompt: input.prompt,
    context: input.context,
    sources,
    target: () => target,
    clear() {
      if (initial !== target) {
        initial.reset()

        // A preparing session may already have an unsent follow-up in its promoted composer.
        if (preserveDraft && target.current().some((part) => isAttachment(part) || part.content.length > 0))
          following = clonePrompt(target.current())
      }

      if (!following) target.reset()
      cleared = target.current()
    },
    retarget(next: ComposerStateTarget, options?: { preserveDraft?: boolean }) {
      input.context.forEach((item) => next.context.add(item))
      sources.forEach((item) => next.quoteSource.add(item.key, item.source))
      target = next
      preserveDraft = options?.preserveDraft ?? false
    },
    current: (value: ComposerStateTarget) => target === value,
    restore() {
      if (cleared !== undefined && target.current() !== cleared) return

      return {
        target,
        prompt: following ? appendPrompt(input.prompt, following) : input.prompt,
        context: input.context,
      }
    },
  }
}
