import { createContext, useContext, type ParentProps } from "solid-js"

export function createSimpleContext<T, Props extends Record<string, any>>(input: {
  name: string
  init: ((input: Props) => T) | (() => T)
}) {
  const ctx = createContext<T | undefined>(undefined)

  return {
    provider: (props: ParentProps<Props>) => {
      const value = input.init(props)
      return <ctx.Provider value={value}>{props.children}</ctx.Provider>
    },
    use() {
      const value = useContext(ctx)
      if (value === undefined)
        throw new Error(`${input.name} context must be used within a context provider`)
      return value as T
    },
  }
}
