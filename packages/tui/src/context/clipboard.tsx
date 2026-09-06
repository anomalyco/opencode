import { createContext, type JSX, useContext } from "solid-js"
import { read, write, type ClipboardSelection } from "../clipboard"

export type ClipboardContent = Readonly<{ data: string; mime: string }>
export type ClipboardService = Readonly<{
  read?(): Promise<ClipboardContent | undefined>
  write?(text: string): Promise<void>
}>
const clipboard = { read, write }
const ClipboardContext = createContext<ClipboardService>(clipboard)

export function ClipboardProvider(props: {
  value?: ClipboardService
  children: JSX.Element
  linuxClipboardSelection?: ClipboardSelection
}) {
  const clipboardWithSelection =
    props.value ??
    (props.linuxClipboardSelection
      ? {
          read: () => read(props.linuxClipboardSelection === "primary" ? "primary" : "clipboard"),
          write: (text: string) => write(text, props.linuxClipboardSelection),
        }
      : clipboard)
  return <ClipboardContext.Provider value={clipboardWithSelection}>{props.children}</ClipboardContext.Provider>
}

export function useClipboard() {
  return useContext(ClipboardContext)
}
