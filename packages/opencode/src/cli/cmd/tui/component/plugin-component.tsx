import { createSignal, Show, onMount, type Component } from "solid-js"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { TextAttributes } from "@opentui/core"
import { Plugin } from "@/plugin"

export interface PluginComponentProps {
  componentId: string
  context?: Record<string, any>
  fallback?: string
}

export function PluginComponent(props: PluginComponentProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const [ComponentFn, setComponentFn] = createSignal<Component<any> | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)

  async function loadComponent() {
    setLoading(true)
    setError(null)
    try {
      console.log("[PluginComponent] Loading component:", props.componentId)
      const plugins = await Plugin.list()
      console.log("[PluginComponent] Found", plugins.length, "plugins")

      for (const plugin of plugins) {
        const uiRender = (plugin as any)["ui.render"]
        if (!uiRender) continue

        const output: any = {}
        const renderInput = {
          componentId: props.componentId,
          context: {
            ...props.context,
            client: sdk.client,
          },
        }
        console.log("[PluginComponent] Calling ui.render with:", {
          componentId: renderInput.componentId,
          contextKeys: Object.keys(renderInput.context),
        })
        await uiRender(renderInput, output)

        if (output.component) {
          // Store the component as a function that returns JSX
          // This way it will be called within the render tree
          console.log("[PluginComponent] ✓ Loaded component for:", props.componentId)
          setComponentFn(() => output.component)
          setLoading(false)
          return
        }
      }

      console.error("[PluginComponent] ✗ No plugin found for:", props.componentId)
      setError(`No plugin can render component: ${props.componentId}`)
    } catch (err) {
      console.error("[PluginComponent] Error loading plugin:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    loadComponent()
  })

  return (
    <Show
      when={!loading()}
      fallback={
        <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
          {props.fallback || "Loading..."}
        </text>
      }
    >
      <Show when={!error()} fallback={<text fg={theme.error}>{error()}</text>}>
        <Show when={ComponentFn()} fallback={<text fg={theme.textMuted}>No component</text>}>
          {(() => {
            try {
              console.log("[PluginComponent] Rendering component for:", props.componentId)
              const Component = ComponentFn()!
              return <Component />
            } catch (err) {
              console.error("[PluginComponent] Render error:", err)
              return <text fg={theme.error}>Render error: {String(err)}</text>
            }
          })()}
        </Show>
      </Show>
    </Show>
  )
}
