import { createComponent, createContext, createSignal, type JSX, useContext } from "solid-js"

export type TuiPaths = Readonly<{
  cwd: string
  home: string
  state: string
  worktree: string
}>

export type TuiTerminalEnvironment = Readonly<{
  platform: string
  multiplexer?: "tmux" | "screen"
  displayServer?: "wayland" | "x11"
}>

export type TuiStartup = Readonly<{
  initialRoute?: unknown
  skipInitialLoading: boolean
}>

const PathsContext = createContext<TuiPaths>()
const TerminalEnvironmentContext = createContext<TuiTerminalEnvironment>()
const StartupContext = createContext<TuiStartup>()
const TuiReadyContext = createContext<{ ready: () => boolean; setReady: (v: boolean) => void }>()

function provider<T>(context: ReturnType<typeof createContext<T>>, value: T, children: () => JSX.Element) {
  return createComponent(context.Provider, {
    value: Object.freeze({ ...value }),
    get children() {
      return children()
    },
  })
}

export function TuiPathsProvider(props: { value: TuiPaths; children: JSX.Element }) {
  return provider(PathsContext, props.value, () => props.children)
}

export function TuiTerminalEnvironmentProvider(props: { value: TuiTerminalEnvironment; children: JSX.Element }) {
  return provider(TerminalEnvironmentContext, props.value, () => props.children)
}

export function TuiStartupProvider(props: { value: TuiStartup; children: JSX.Element }) {
  return provider(StartupContext, props.value, () => props.children)
}

export function TuiReadyProvider(props: { children: JSX.Element }) {
  const [ready, setReady] = createSignal(false)
  const value = { ready, setReady }
  return provider(TuiReadyContext, value, () => props.children)
}

function required<T>(context: ReturnType<typeof createContext<T>>, name: string) {
  const value = useContext(context)
  if (!value) throw new Error(`${name} is missing`)
  return value
}

export function useTuiPaths() {
  return required(PathsContext, "TuiPathsProvider")
}

export function useTuiTerminalEnvironment() {
  return required(TerminalEnvironmentContext, "TuiTerminalEnvironmentProvider")
}

export function useTuiStartup() {
  return required(StartupContext, "TuiStartupProvider")
}

export function useTuiReady() {
  return required(TuiReadyContext, "TuiReadyProvider")
}
