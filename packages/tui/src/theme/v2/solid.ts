import { createComponent, createContext, useContext, type Accessor, type ParentProps } from "solid-js"
import { createComponentTheme, type ComponentTheme } from "./component"
import type { ContextKey, Mode, ResolvedTheme } from "./index"

type ThemeRuntime = {
  readonly resolved: Accessor<ResolvedTheme>
  readonly mode: Accessor<Mode>
  readonly component: ComponentTheme
}

const ThemeContext = createContext<ThemeRuntime>()

export function ThemeProvider(props: ParentProps<{ theme: ResolvedTheme; mode?: Mode }>) {
  const resolved = () => props.theme
  const mode = () => props.mode ?? "light"
  return createComponent(ThemeContext.Provider, {
    value: { resolved, mode, component: createComponentTheme(resolved, mode) },
    get children() {
      return props.children
    },
  })
}

export function ContextProvider(props: ParentProps<{ context: ContextKey }>) {
  const parent = runtime()
  const context = () => {
    const value = parent.resolved().contexts[props.context]
    if (!value) throw new Error(`Theme context is not defined: ${props.context}`)
    return value
  }
  context()
  return createComponent(ThemeContext.Provider, {
    value: { resolved: parent.resolved, mode: parent.mode, component: createComponentTheme(context, parent.mode) },
    get children() {
      return props.children
    },
  })
}

export function useTheme() {
  return runtime().component
}

export function useResolvedTheme() {
  return runtime().resolved
}

function runtime() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("Theme context must be used within a ThemeProvider")
  return context
}
