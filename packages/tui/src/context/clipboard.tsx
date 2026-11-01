import { createContext, type JSX, useContext } from "solid-js"

export type ClipboardContent = Readonly<{ data: string; mime: string }>
export type ClipboardWriteOutcome = "copied" | "attempted"
export type ClipboardService = Readonly<{
  read(): Promise<ClipboardContent | undefined>
  write(text: string): Promise<ClipboardWriteOutcome>
}>

export function clipboardWriteToast(
  outcome: ClipboardWriteOutcome,
  message: string,
  variant: "info" | "success" = "info",
) {
  if (outcome === "copied") return { message, variant }
  return { message: "Copied — delivery not confirmed", variant: "warning" as const }
}

const ClipboardContext = createContext<ClipboardService>()

export function ClipboardProvider(props: { value: ClipboardService; children: JSX.Element }) {
  return <ClipboardContext.Provider value={props.value}>{props.children}</ClipboardContext.Provider>
}

export function useClipboard() {
  const value = useContext(ClipboardContext)
  if (!value) throw new Error("useClipboard must be used within a ClipboardProvider")
  return value
}
