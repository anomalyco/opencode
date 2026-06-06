import { createContext, type JSX, useContext } from "solid-js"

export type PlatformFiles = Readonly<{
  readText(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  mime(path: string): Promise<string>
}>

export type PlatformClipboardContent = Readonly<{
  data: string
  mime: string
}>

export type TuiPlatform = Readonly<{
  files: PlatformFiles
  clipboard?: Readonly<{
    read?(): Promise<PlatformClipboardContent | undefined>
    write?(text: string): Promise<void>
  }>
  editor?: Readonly<{
    open(input: Readonly<{ value: string; cwd?: string }>): Promise<string | undefined>
  }>
  export?: Readonly<{
    write(path: string, content: string): Promise<void>
  }>
}>

const PlatformContext = createContext<TuiPlatform>()

export function TuiPlatformProvider(props: { value: TuiPlatform; children: JSX.Element }) {
  return <PlatformContext.Provider value={props.value}>{props.children}</PlatformContext.Provider>
}

export function useTuiPlatform() {
  const value = useContext(PlatformContext)
  if (!value) throw new Error("TuiPlatformProvider is missing")
  return value
}
