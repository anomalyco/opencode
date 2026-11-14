/**
 * The driver loop of a terminal machine: applies one event at a time and runs its effects. An effect may dispatch
 * synchronously; its event waits until the current one has applied. An event the machine ignores (the same state)
 * writes nothing. Nothing that throws stalls the queue: each effect runs on its own, a throwing effect reports
 * `failed(effect)` back to the machine, and an error without such an event surfaces as an unhandled rejection while
 * later effects and events keep applying.
 */
export function createDispatch<State, Event, Effect>(machine: {
  readonly read: () => State
  readonly write: (state: State) => void
  readonly transition: (state: State, event: Event) => { readonly state: State; readonly effects: readonly Effect[] }
  readonly run: (effect: Effect) => void
  readonly failed?: (effect: Effect) => Event | undefined
}) {
  const queue: Event[] = []

  const apply = (event: Event) => {
    const current = machine.read()
    const next = machine.transition(current, event)

    if (next.state !== current) machine.write(next.state)
    next.effects.forEach((effect) => {
      void Promise.try(() => machine.run(effect)).catch((cause: unknown) => {
        const failure = machine.failed?.(effect)

        if (failure === undefined) throw cause
        dispatch(failure)
      })
    })
  }

  const dispatch = (event: Event) => {
    queue.push(event)

    if (queue.length > 1) return

    while (queue.length > 0) {
      void Promise.try(apply, queue[0])
      queue.shift()
    }
  }

  return dispatch
}
