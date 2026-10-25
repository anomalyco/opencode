import { createComponent, createContext, useContext, type JSX } from "solid-js"
import type { Context } from "./context.js"

const PluginContext = createContext<Context>()

export function PluginContextProvider(props: { readonly value: Context; readonly children: JSX.Element }) {
  return createComponent(PluginContext.Provider, {
    value: props.value,
    get children() {
      return props.children
    },
  })
}

export function usePlugin() {
  const context = useContext(PluginContext)
  if (!context) throw new Error("PluginContextProvider is missing")
  return context
}
