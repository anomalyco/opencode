import { createMemo, ErrorBoundary, For, onMount, Show, untrack, type JSX, type ParentProps } from "solid-js"
import { Portal } from "solid-js/web"
import { MarkdownProvider, useMarkdown } from "@opencode/session-ui/context/markdown"
import { ExtensionContext, Slot, Style, type MountedSession, type SlotMap } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "./host"

/**
 * Renders one extension contribution with its context and error isolation: a contribution that throws records the
 * error and renders nothing, and the rest of the window keeps working. Contributions never render on timeline rows;
 * the session header slot is per timeline.
 */
export function Contribution(props: { extension: string; children: () => JSX.Element }) {
  const host = useExtensionHost()

  return (
    <Show when={host.context(props.extension)} keyed>
      {(context) => (
        <ErrorBoundary
          fallback={(error) => {
            onMount(() => host.fail(props.extension, error, "render"))

            return null
          }}
        >
          {/* Untracked: a contribution renders once; its own reactivity updates it in place. */}
          <ExtensionContext.Provider value={context}>{untrack(props.children)}</ExtensionContext.Provider>
        </ErrorBoundary>
      )}
    </Show>
  )
}

export function ExtensionSlot<At extends keyof SlotMap>(props: { at: At; input: SlotMap[At] }) {
  const host = useExtensionHost()

  const items = createMemo(() =>
    host
      .items(Slot)
      .filter((item) => item.value.at === props.at)
      .toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0)),
  )

  return (
    <For each={items()}>
      {(item) => (
        <Contribution extension={item.extension}>
          {() =>
            // SAFETY: items are filtered to `at === props.at`, and a slot's render takes that slot's input.
            (item.value.render as (input: SlotMap[At]) => JSX.Element)(props.input)
          }
        </Contribution>
      )}
    </For>
  )
}

export function ExtensionStyles() {
  const host = useExtensionHost()

  return (
    <Portal mount={document.head}>
      <For each={host.items(Style)}>{(item) => <style data-extension={item.extension}>{item.value}</style>}</For>
    </Portal>
  )
}

/** Routes local markdown links in the session to extension LinkHandler contributions, keeping image loading. */
export function ExtensionLinks(props: ParentProps<{ session: MountedSession }>) {
  const host = useExtensionHost()
  const markdown = useMarkdown()

  return (
    <MarkdownProvider
      readImage={markdown?.readImage}
      openLocalFile={(href) => void host.links.open({ href, session: props.session })}
    >
      {props.children}
    </MarkdownProvider>
  )
}
