import { createContext, createMemo, Show, useContext, type ParentProps, type Accessor } from "solid-js"

export function createSimpleContext<T, Props extends Record<string, any>>(
  input: {
    name: string
    init: ((input: Props) => T) | (() => T)
  } & (T extends { ready: unknown } ? { gate: boolean } : { gate?: boolean }),
) {
  const ctx = createContext<T>()

  return {
    context: ctx,
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      const gate = input.gate ?? true

      if (!gate) {
        return <ctx.Provider value={init}>{props.children}</ctx.Provider>
      }

      // Access init.ready inside the memo to make it reactive for getter properties
      const isReady = createMemo(() => {
        // SAFETY: contexts whose value has `ready` must pass `gate`, and their `ready` is a boolean or its accessor.
        const ready = (init as { ready?: Accessor<boolean> | boolean }).ready

        return ready === undefined || (ready instanceof Function ? ready() : ready)
      })

      return (
        <Show when={isReady()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use() {
      const value = useContext(ctx)

      if (!value) throw new Error(`${input.name} context must be used within a context provider`)

      return value
    },
  }
}
