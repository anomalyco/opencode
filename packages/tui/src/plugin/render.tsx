import {
  createComponent,
  createContext,
  createMemo,
  ErrorBoundary,
  For,
  mergeProps,
  onCleanup,
  onMount,
  Show,
  useContext,
  type JSX,
  type ParentProps,
} from "solid-js"
import { isShallowEqual } from "remeda"
import type { SlotMap, SlotPath } from "@opencode-ai/plugin/tui/context"
import type { SlotRender } from "./api"
import { contains, emptySlotted, type Claim } from "./structure"
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

// The nearest enclosing slot's path. Root slots mount outside any provider.
const SlotParent = createContext<string>()

// `input` is required exactly when the path publishes a non-empty input.
type SlotProps<Path extends SlotPath> = ParentProps<{ readonly path: Path }> &
  ({} extends SlotMap[Path] ? { readonly input?: SlotMap[Path] } : { readonly input: SlotMap[Path] })

// One named boundary of the host UI's slot tree. The host's own content are
// the children; every active plugin claim targeting this path resolves into
// siblings around it, contributions inside it, or one takeover of it.
// Placement policy lives in resolveSlots; this component only renders its
// own path's buckets.
export function Slot<Path extends SlotPath>(props: SlotProps<Path>) {
  const plugins = usePlugin()
  // A slot's path is its identity for the whole mount; instances are
  // reference-counted so the same path may be mounted several times (one
  // composer footer per session tab).
  const path = props.path
  // Paths are declared, not inferred: nesting under the wrong parent would
  // silently publish a mislocated public path, so containment fails loudly
  // at mount. Only host code can trip this — plugins cannot mount slots.
  const parent = useContext(SlotParent)
  if (parent !== undefined && !contains(parent, path)) {
    throw new Error(`Slot "${path}" is mounted inside "${parent}" but its path does not extend it`)
  }
  onCleanup(plugins.slots.register(path))
  const input = () => (props as { readonly input?: SlotMap[Path] }).input ?? ({} as SlotMap[Path])
  const slotted = createMemo(
    () => plugins.slots.resolved().slotted.get(path) ?? emptySlotted<SlotRender>(),
    emptySlotted<SlotRender>(),
    // Claim objects are reference-stable across resolutions, so a bucketwise
    // comparison makes a claim change elsewhere in the tree a no-op here.
    {
      equals: (a, b) =>
        isShallowEqual(a.before, b.before) &&
        isShallowEqual(a.prepend, b.prepend) &&
        isShallowEqual(a.append, b.append) &&
        isShallowEqual(a.after, b.after) &&
        a.replace === b.replace,
    },
  )
  // Component semantics: the render body runs once and untracked, so state
  // created inside is stable while the slot input stays reactive through the
  // merged getter.
  const contribution = (claim: Claim<SlotRender>) => (
    <PluginBoundary id={claim.plugin} where={`slot ${path}`}>
      {createComponent(claim.render, mergeProps(input))}
    </PluginBoundary>
  )
  return (
    <>
      <For each={slotted().before}>{contribution}</For>
      {/* before/after are siblings outside the boundary, so outside the provider. */}
      <SlotParent.Provider value={path}>
        <Show
          keyed
          when={slotted().replace}
          fallback={
            <>
              <For each={slotted().prepend}>{contribution}</For>
              {props.children}
              <For each={slotted().append}>{contribution}</For>
            </>
          }
        >
          {contribution}
        </Show>
      </SlotParent.Provider>
      <For each={slotted().after}>{contribution}</For>
    </>
  )
}
