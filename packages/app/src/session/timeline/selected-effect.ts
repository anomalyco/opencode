import { createEffect, createMemo, untrack, type Accessor } from "solid-js"

/**
 * Runs `run` with `source` when the view is created and whenever `source` changes, as an effect would. A detached
 * view runs nothing; once selected again it runs once if `source` changed meanwhile.
 */
export function createSelectedEffect<T>(source: Accessor<T>, active: Accessor<boolean>, run: (value: T) => void) {
  const changes = createMemo((count: number) => (source(), count + 1), 0)
  let ran: number | undefined

  createEffect(() => {
    if (!active()) return
    const change = changes()

    if (change === ran) return
    ran = change
    untrack(() => run(source()))
  })
}
