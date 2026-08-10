import {
  createComponent,
  createMemo,
  ErrorBoundary,
  For,
  mergeProps,
  onMount,
  Show,
  type JSX,
  type ParentProps,
} from "solid-js"
import type { SlotMap, SlotName } from "@opencode-ai/plugin/tui/context"
import { useRoute } from "../context/route"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { usePlugin } from "./context"

// Contain render-time plugin crashes: a throwing slot or route must not take
// down the app or the other plugins. The crash surfaces as one error toast.
function PluginBoundary(props: ParentProps<{ id: string; where: string }>) {
  const toast = useToast()
  return (
    <ErrorBoundary
      fallback={(error) => {
        // One toast per crash: onMount is untracked, so prop updates while
        // the boundary is latched cannot re-toast.
        onMount(() =>
          toast.show({
            variant: "error",
            title: "Plugin",
            message: `${props.id} crashed in ${props.where}: ${errorMessage(error)}`,
          }),
        )
        return null
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}

export function PluginRoute(props: { readonly fallback: (id: string, name: string) => JSX.Element }) {
  const plugins = usePlugin()
  const route = useRoute()
  const current = createMemo(() => {
    if (route.data.type !== "plugin") return
    return {
      id: route.data.id,
      name: route.data.name,
      render: plugins.route(route.data.id, route.data.name),
      data: route.data.data,
    }
  })
  return (
    // Keyed so navigation or a hot reload recreates the boundary; otherwise
    // one crash would latch every future plugin route into the fallback.
    <Show keyed when={current()}>
      {(item) => (
        <PluginBoundary id={item.id} where="route">
          {item.render ? createComponent(item.render, { data: item.data }) : props.fallback(item.id, item.name)}
        </PluginBoundary>
      )}
    </Show>
  )
}

export function PluginSlot<Name extends SlotName>(props: {
  readonly name: Name
  readonly input: SlotMap[Name]
  readonly mode: "all" | "replace"
}) {
  const plugins = usePlugin()
  const renderers = createMemo(() => {
    const items = plugins.slot(props.name)
    if (props.mode === "replace") return items.slice(-1)
    return items
  })
  return (
    <For each={renderers()}>
      {(item) => (
        <PluginBoundary id={item.id} where={`slot ${props.name}`}>
          {
            // Component semantics: the render body runs once and untracked, so
            // signals and intervals created inside are stable, while props stay
            // reactive through the merged getter. A bare item.render(props.input)
            // call would run inside the host's tracked scope and re-execute the
            // whole body (resetting plugin state) on every tracked read.
            createComponent(item.render, mergeProps(() => props.input) as SlotMap[Name])
          }
        </PluginBoundary>
      )}
    </For>
  )
}
