/**
 * The driver loop of a machine: applies one event at a time and runs its effects. An effect may dispatch
 * synchronously; its event waits until the current one has applied. A transition or effect that throws never stalls
 * the queue: a throwing effect reports `failed(effect)` back to the machine, and an error without such an event, or
 * from the transition, surfaces as an unhandled rejection while later events keep applying.
 */
export function createDispatch<State, Event, Effect>(machine: {
  readonly read: () => State
  readonly write: (state: State) => void
  readonly transition: (state: State, event: Event) => { readonly state: State; readonly effects: readonly Effect[] }
  readonly run: (effect: Effect) => void
  readonly failed: (effect: Effect) => Event | undefined
}) {
  const queue: Event[] = []

  const apply = (event: Event) => {
    const next = machine.transition(machine.read(), event)

    machine.write(next.state)
    next.effects.forEach((effect) => {
      void Promise.try(() => machine.run(effect)).catch((cause: unknown) => {
        const failure = machine.failed(effect)

        if (!failure) throw cause
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
