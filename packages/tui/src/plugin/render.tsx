import {
  createComponent,
  createMemo,
  ErrorBoundary,
  For,
  mergeProps,
  onCleanup,
  onMount,
  Show,
  type JSX,
  type ParentProps,
} from "solid-js"
import type { SlotMap, SlotPath } from "@opencode-ai/plugin/tui/context"
import type { SlotRender } from "./api"
import { emptySlotted, type Claim } from "./structure"
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

// One named boundary of the host UI's slot tree. The host's own content are
// the children; every active plugin claim targeting this path resolves into
// siblings around it, contributions inside it, or one takeover of it.
// Placement policy — boundary suppression, last-enabled-wins, missing-target
// degradation — lives in resolveSlots; this component only renders its own
// path's buckets.
export function Slot<Path extends SlotPath>(
  props: ParentProps<{ readonly path: Path; readonly input?: SlotMap[Path] }>,
) {
  const plugins = usePlugin()
  // A slot's path is its identity for the whole mount; instances are
  // reference-counted so the same path may be mounted several times (one
  // composer footer per session tab).
  const path = props.path
  onCleanup(plugins.slots.register(path))
  const slotted = createMemo(
    () => plugins.slots.resolved().slotted.get(path) ?? emptySlotted<SlotRender>(),
    emptySlotted<SlotRender>(),
    // Claim objects are reference-stable across resolutions, so a bucketwise
    // comparison makes a claim change elsewhere in the tree a no-op here.
    {
      equals: (a, b) =>
        same(a.before, b.before) &&
        same(a.prepend, b.prepend) &&
        same(a.append, b.append) &&
        same(a.after, b.after) &&
        a.replace === b.replace,
    },
  )
  // Component semantics: the render body runs once and untracked, so signals
  // and intervals created inside are stable, while the slot input stays
  // reactive through the merged getter. A bare render(props.input) call
  // would run inside the host's tracked scope and re-execute the whole body
  // (resetting plugin state) on every tracked read.
  const contribution = (claim: Claim<SlotRender>) => (
    <PluginBoundary id={claim.plugin} where={`slot ${path}`}>
      {createComponent(
        claim.render,
        mergeProps(() => props.input ?? ({} as SlotMap[Path])),
      )}
    </PluginBoundary>
  )
  return (
    <>
      <For each={slotted().before}>{contribution}</For>
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
      <For each={slotted().after}>{contribution}</For>
    </>
  )
}

function same(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>) {
  return a.length === b.length && a.every((item, index) => item === b[index])
}
