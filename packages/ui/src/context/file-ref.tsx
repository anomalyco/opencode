import { createContext, useContext, type ParentProps } from "solid-js"

export type MessageFileRef = {
  path: string
  line?: number
  end?: number
}

type Value = {
  open: (ref: MessageFileRef) => void | Promise<void>
  match?: (path: string) => Promise<string[]>
}

const ctx = createContext<Value>()

export function FileRefProvider(props: ParentProps<{ value: Value }>) {
  return <ctx.Provider value={props.value}>{props.children}</ctx.Provider>
}

export function useFileRef() {
  return useContext(ctx)
}
