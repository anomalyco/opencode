import { createComponent, createContext, type JSX, useContext } from "solid-js"
import path from "path"

export type TuiEnvironment = Readonly<{
  cwd: string
  platform: string
  initialRoute?: unknown
  paths: Readonly<{
    home: string
    state: string
    worktree: string
  }>
  capabilities: Readonly<{
    mouse: boolean
    copyOnSelect: boolean
    terminalTitle: boolean
    terminalSuspend: boolean
    workspaces: boolean
    showTimeToFirstDraw: boolean
  }>
  terminal: Readonly<{
    multiplexer?: "tmux" | "screen"
    displayServer?: "wayland" | "x11"
  }>
  editor: Readonly<{
    command?: string
    port?: number
    zedTerminal: boolean
    zedDatabase?: string
  }>
  skipInitialLoading: boolean
}>

export type TuiBuildInfo = Readonly<{
  version: string
  channel: string
}>

const EnvironmentContext = createContext<TuiEnvironment>()
const BuildInfoContext = createContext<TuiBuildInfo>()

export function TuiEnvironmentProvider(props: { value: TuiEnvironment; children: JSX.Element }) {
  return createComponent(EnvironmentContext.Provider, {
    value: props.value,
    get children() {
      return props.children
    },
  })
}

export function TuiBuildInfoProvider(props: { value: TuiBuildInfo; children: JSX.Element }) {
  return createComponent(BuildInfoContext.Provider, {
    value: props.value,
    get children() {
      return props.children
    },
  })
}

export function useTuiEnvironment() {
  const value = useContext(EnvironmentContext)
  if (!value) throw new Error("TuiEnvironmentProvider is missing")
  return value
}

export function useTuiBuildInfo() {
  const value = useContext(BuildInfoContext)
  if (!value) throw new Error("TuiBuildInfoProvider is missing")
  return value
}

export function createTuiEnvironment(input: TuiEnvironment): TuiEnvironment {
  return Object.freeze({
    ...input,
    paths: Object.freeze({ ...input.paths }),
    capabilities: Object.freeze({ ...input.capabilities }),
    terminal: Object.freeze({ ...input.terminal }),
    editor: Object.freeze({ ...input.editor }),
  })
}

export function createTuiBuildInfo(input: TuiBuildInfo): TuiBuildInfo {
  return Object.freeze({ ...input })
}

export function abbreviateHome(input: string, home: string) {
  if (!home) return input
  const relative = path.relative(home, input)
  if (relative === "") return "~"
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return input
  return "~" + path.sep + relative
}
