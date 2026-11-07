import { createMemo, ErrorBoundary, For, onMount, Show, untrack, type JSX, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { SourcesProvider } from "@opencode/session-ui/context/sources"
import { sourcesExperiment } from "@opencode/session-ui/sources/experiment"
import { Style, type MountedSession } from "@opencode/plugin/gui"
import { BuiltinSlot, type BuiltinSlotMap } from "@opencode/plugin/gui/builtin"
import { PluginContext } from "@opencode/plugin/gui/host"
import { usePluginHost } from "./host"
import { createLinkCheck } from "./link-check"

/**
 * Renders one plugin contribution with its context and error isolation: a contribution that throws records the
 * error and renders nothing, and the rest of the window keeps working. Contributions never render on timeline rows;
 * the session header slot is per timeline.
 */
export function Contribution(props: { plugin: string; children: () => JSX.Element }) {
  const host = usePluginHost()

  return (
    <Show when={host.context(props.plugin)} keyed>
      {(context) => (
        <ErrorBoundary
          fallback={(error) => {
            onMount(() => host.fail(props.plugin, error, "render"))

            return null
          }}
        >
          {/* Untracked: a contribution renders once; its own reactivity updates it in place. */}
          <PluginContext.Provider value={context}>{untrack(props.children)}</PluginContext.Provider>
        </ErrorBoundary>
      )}
    </Show>
  )
}

export function PluginSlot<At extends keyof BuiltinSlotMap>(props: {
  at: At
  input: BuiltinSlotMap[At]
  fallback?: JSX.Element
}) {
  const host = usePluginHost()

  const items = createMemo(() =>
    host
      .items(BuiltinSlot)
      .filter((item) => item.value.at === props.at)
      .toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0)),
  )

  return (
    <For each={items()} fallback={props.fallback}>
      {(item) => (
        <Contribution plugin={item.plugin}>
          {() =>
            // SAFETY: items are filtered to `at === props.at`, and a slot's render takes that slot's input.
            (item.value.render as (input: BuiltinSlotMap[At]) => JSX.Element)(props.input)
          }
        </Contribution>
      )}
    </For>
  )
}

export function PluginStyles() {
  const host = usePluginHost()

  return (
    <Portal mount={document.head}>
      <For each={host.items(Style)}>{(item) => <style data-plugin={item.plugin}>{item.value}</style>}</For>
    </Portal>
  )
}

/**
 * Routes local markdown links in the session to plugin LinkHandler contributions, keeping image loading. A turn's
 * sources chip opens its turn through the Sources plugin's handler.
 */
export function PluginLinks(props: ParentProps<{ session: MountedSession; active?: boolean }>) {
  const host = usePluginHost()
  const markdown = useMarkdown()

  // Checks untracked: markdown calls this inside its render effect, which must not follow the routed session.
  const localFileExists = createLinkCheck(
    () => props.active !== false,
    (href) => host.links.exists({ href, session: props.session }),
  )

  return (
    <MarkdownProvider
      readImage={markdown?.readImage}
      openLocalFile={(href) => void host.links.open({ href, session: props.session })}
      localFileExists={localFileExists}
    >
      <SourcesProvider
        enabled={sourcesExperiment.enabled}
        icons={sourcesExperiment.icons}
        onOpen={(from) => void host.links.open({ href: from, origin: "sources", session: props.session })}
      >
        {props.children}
      </SourcesProvider>
    </MarkdownProvider>
  )
}
