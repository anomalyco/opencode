import { createComponent, createContext, useContext, type Accessor, type ParentProps } from "solid-js"
import { createComponentTheme, type ComponentTheme } from "./component"
import type { ContextKey, ResolvedTheme } from "./index"

type ThemeRuntime = {
  readonly resolved: Accessor<ResolvedTheme>
  readonly component: ComponentTheme
}

const ThemeContext = createContext<ThemeRuntime>()

export function ThemeProvider(props: ParentProps<{ theme: ResolvedTheme }>) {
  const resolved = () => props.theme
  return createComponent(ThemeContext.Provider, {
    value: { resolved, component: createComponentTheme(resolved) },
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
    value: { resolved: parent.resolved, component: createComponentTheme(context) },
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
