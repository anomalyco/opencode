import { createContext, useContext, type ParentProps } from "solid-js"

export type OpenFileFn = (path: string) => void

const ctx = createContext<OpenFileFn>()

export function OpenFileProvider(props: ParentProps<{ onOpenFile?: OpenFileFn }>) {
  return <ctx.Provider value={props.onOpenFile}>{props.children}</ctx.Provider>
}

export function useOpenFile() {
  return useContext(ctx)
}
