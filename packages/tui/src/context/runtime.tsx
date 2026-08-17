import { createComponent, createContext, type JSX, useContext } from "solid-js"

export type TuiApp = Readonly<{
  name: string
  version: string
  channel: string
}>

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
  variables?: Readonly<Record<string, string>>
}>

export type TuiStartup = Readonly<{
  initialRoute?: unknown
  skipInitialLoading: boolean
}>

export type TuiLifecycle = Readonly<{
  add(finalizer: () => Promise<void>): () => void
}>

const PathsContext = createContext<TuiPaths>()
const AppContext = createContext<TuiApp>()
const TerminalEnvironmentContext = createContext<TuiTerminalEnvironment>()
const StartupContext = createContext<TuiStartup>()
const LifecycleContext = createContext<TuiLifecycle>()

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

export function TuiAppProvider(props: { value: TuiApp; children: JSX.Element }) {
  return provider(AppContext, props.value, () => props.children)
}

export function TuiTerminalEnvironmentProvider(props: { value: TuiTerminalEnvironment; children: JSX.Element }) {
  return provider(TerminalEnvironmentContext, props.value, () => props.children)
}

export function TuiStartupProvider(props: { value: TuiStartup; children: JSX.Element }) {
  return provider(StartupContext, props.value, () => props.children)
}

export function TuiLifecycleProvider(props: { value: TuiLifecycle; children: JSX.Element }) {
  return provider(LifecycleContext, props.value, () => props.children)
}

function required<T>(context: ReturnType<typeof createContext<T>>, name: string) {
  const value = useContext(context)
  if (!value) throw new Error(`${name} is missing`)
  return value
}

export function useTuiPaths() {
  return required(PathsContext, "TuiPathsProvider")
}

export function useTuiApp() {
  return required(AppContext, "TuiAppProvider")
}

export function useTuiTerminalEnvironment() {
  return required(TerminalEnvironmentContext, "TuiTerminalEnvironmentProvider")
}

export function useTuiStartup() {
  return required(StartupContext, "TuiStartupProvider")
}

export function useTuiLifecycle() {
  return required(LifecycleContext, "TuiLifecycleProvider")
}
