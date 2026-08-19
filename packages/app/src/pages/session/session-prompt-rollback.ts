import { batch } from "solid-js"

type PromptTarget<T> = {
  current: () => T[]
  cursor: () => number | undefined
  set: (value: T[]) => void
  setCursor: (value: number | undefined) => void
  reset: () => void
}

export async function runPromptRollbackMutation<T, P, R>(input: {
  prompt: PromptTarget<T>
  prepare: () => P | Promise<P>
  optimistic: (prompt: PromptTarget<T>, prepared: P) => void
  request: (prepared: P) => Promise<R>
  complete: (result: R) => void
  rollback: () => void
  fail: (error: unknown) => void
}) {
  const prepared = await Promise.resolve()
    .then(input.prepare)
    .then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    )
  if (!prepared.ok) return input.fail(prepared.error)
  const previous = input.prompt.current().slice()
  const cursor = input.prompt.cursor()
  batch(() => input.optimistic(input.prompt, prepared.value))
  await input
    .request(prepared.value)
    .then(input.complete)
    .catch((error) => {
      batch(() => {
        input.rollback()
        input.prompt.set(previous)
        input.prompt.setCursor(cursor)
      })
      input.fail(error)
    })
}
