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
import type { RegionMap, RegionName, Slot, SlotMap, SlotName } from "@opencode-ai/plugin/tui/context"
import { resolveStructure, type Entry, type Part } from "./structure"
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

type HostRender = () => JSX.Element

// One extensible area of the host UI: the host's parts plus every active
// plugin claim, resolved into one ordered child list. Placement policy —
// takeover suppression, last-enabled-wins, missing-anchor degradation —
// lives in resolveStructure; this component only renders the result.
export function Region<Name extends RegionName>(props: {
  readonly name: Name
  readonly input: RegionMap[Name]["input"]
  readonly parts?: ReadonlyArray<Part<HostRender, RegionMap[Name]["part"]>>
}) {
  const plugins = usePlugin()
  // resolveStructure builds fresh entry objects each run, but <For> diffs
  // rows by reference: cache entries so untouched rows (and the plugin
  // state inside them) survive unrelated claim changes. Part entries key on
  // their documented-stable id — render-function identity would break if
  // the compiled parts prop ever rebuilt its closures. Claim entries key on
  // the render function (weakly, so hot-reloaded generations collect).
  const partEntries = new Map<string, Entry<HostRender, Slot>>()
  const claimEntries = new WeakMap<Slot, Entry<HostRender, Slot>>()
  const entries = createMemo(
    () =>
      resolveStructure<HostRender, Slot>({
        region: props.name,
        parts: props.parts ?? [],
        claims: plugins.claims(props.name),
      }).entries.map((entry) => {
        if (entry.kind === "part") {
          const cached = partEntries.get(entry.id)
          if (cached) return cached
          partEntries.set(entry.id, entry)
          return entry
        }
        const cached = claimEntries.get(entry.claim.render)
        if (cached) return cached
        claimEntries.set(entry.claim.render, entry)
        return entry
      }),
    [] as ReadonlyArray<Entry<HostRender, Slot>>,
    // Rows are reference-stable, so an elementwise comparison makes a claim
    // change in some other region a complete no-op for this one.
    { equals: (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]) },
  )
  return (
    <For each={entries()}>
      {(entry) =>
        // A row's entry object is cached, so its kind never changes within
        // the row's lifetime — a plain branch is safe here.
        entry.kind === "part" ? (
          entry.render()
        ) : (
          <PluginBoundary id={entry.claim.plugin} where={`region ${props.name}`}>
            {
              // Component semantics: the render body runs once and untracked, so
              // signals and intervals created inside are stable, while props stay
              // reactive through the merged getter. A bare render(props.input)
              // call would run inside the host's tracked scope and re-execute the
              // whole body (resetting plugin state) on every tracked read.
              createComponent(entry.claim.render, mergeProps(() => props.input) as SlotMap[SlotName])
            }
          </PluginBoundary>
        )
      }
    </For>
  )
}
