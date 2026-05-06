import { createContext, useContext, type ParentProps, type ValidComponent } from "solid-js"
import { createSimpleContext } from "./helper"

const ctx = createSimpleContext<ValidComponent, { component: ValidComponent }>({
  name: "FileComponent",
  init: (props) => props.component,
})

export const FileComponentProvider = ctx.provider
export const useFileComponent = ctx.use

export type OpenLocalFile = (path: string) => void

const noop: OpenLocalFile = () => {}
const openLocalFileCtx = createContext<OpenLocalFile>(noop)

export function OpenLocalFileProvider(props: ParentProps<{ value: OpenLocalFile }>) {
  return <openLocalFileCtx.Provider value={props.value}>{props.children}</openLocalFileCtx.Provider>
}

export function useOpenLocalFile(): OpenLocalFile {
  return useContext(openLocalFileCtx)
}
