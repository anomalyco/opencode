import { createComponent, createContext, useContext, type JSX, type ParentProps } from "solid-js"
import type { Context, PanelProps, SessionContext } from "./context.js"

const PluginContext = createContext<Context>()
const SurfaceContext = createContext<(props: { id: string }) => JSX.Element>()
const PanelContext = createContext<{
  session: SessionContext
  register(props: PanelProps): void
}>()

export function PluginProvider(props: ParentProps<{ value: Context }>) {
  return createComponent(PluginContext.Provider, {
    value: props.value,
    get children() {
      return props.children
    },
  })
}

export function PanelProvider(props: ParentProps<{ value: NonNullable<ReturnType<typeof usePanel>> }>) {
  return createComponent(PanelContext.Provider, {
    value: props.value,
    get children() {
      return props.children
    },
  })
}

function usePanel() {
  return useContext(PanelContext)
}

export function usePlugin() {
  const value = useContext(PluginContext)
  if (!value) throw new Error("Desktop plugin context is unavailable")
  return value
}

export function NativeSurfaceProvider(props: ParentProps<{ render: (props: { id: string }) => JSX.Element }>) {
  return createComponent(SurfaceContext.Provider, {
    value: props.render,
    get children() {
      return props.children
    },
  })
}

export function NativeSurface(props: { id: string }) {
  const render = useContext(SurfaceContext)
  if (!render) throw new Error("Native surfaces require a desktop extension host")
  return render(props)
}

/** Declare a host-owned panel instance in the session.panel slot. */
export function Panel(props: PanelProps): JSX.Element {
  const context = usePanel()
  if (!context) throw new Error("Panel must be contributed to session.panel")
  context.register(props)
  return null
}
