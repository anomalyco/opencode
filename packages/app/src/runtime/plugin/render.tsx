import {
  createEffect,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  getOwner,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
  untrack,
  type Component,
  type JSX,
  type ParentProps,
} from "solid-js"
import { Portal, render } from "solid-js/web"
import {
  MarkdownProvider,
  useMarkdown,
  type MarkdownCodeAction,
  type MarkdownCodeBlock,
  type MarkdownCodeBlocks,
} from "@opencode/session-ui/context/markdown"
import { SourcesProvider } from "@opencode/session-ui/context/sources"
import { sourcesExperiment } from "@opencode/session-ui/sources/experiment"
import { ToolViewsProvider, type ToolCallView, type ToolView, type ToolViews } from "@opencode/session-ui/context/tools"
import { useTheme } from "@opencode/ui/theme/context"
import type { DesktopTheme } from "@opencode/ui/theme/types"
import {
  CodeBlock,
  CodeBlockAction,
  Style,
  Theme,
  ToolRenderer,
  type CodeBlockProps,
  type MountedSession,
  type SessionScreen,
  type ToolRenderProps,
} from "@opencode/plugin/gui"
import { BuiltinSlot, type BuiltinSlotMap } from "@opencode/plugin/gui/builtin"
import { PluginContext } from "@opencode/plugin/gui/host"
import { usePluginHost, type Item } from "./host"
import { createLinkCheck } from "./link-check"

/**
 * Renders one plugin contribution with its context and error isolation: a contribution that throws records the
 * error and renders nothing, then runs `failed`, and the rest of the window keeps working. Contributions render on
 * timeline rows only as code block content, for a block whose language a plugin claimed, once it is complete, and as
 * tool rows, for a tool without a built-in renderer that a plugin matched; the session header slot is per timeline.
 */
export function Contribution(props: { plugin: string; failed?: () => void; children: () => JSX.Element }) {
  const host = usePluginHost()

  return (
    <Show when={host.context(props.plugin)} keyed>
      {(context) => (
        <ErrorBoundary
          fallback={(error) => {
            onMount(() => {
              host.fail(props.plugin, error, "render")
              props.failed?.()
            })

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
 * Lists each contributed theme in the theme picker, keyed by plugin, while it is contributed. Once every plugin the
 * window runs has settled (`loaded`: the plugin list has arrived), a selected theme no plugin contributed is not
 * coming, and the theme provider shows the default theme.
 */
export function PluginThemes(props: { loaded: () => boolean }) {
  const host = usePluginHost()
  const theme = useTheme()

  const settled = createMemo(
    () =>
      props.loaded() &&
      host.ready() &&
      host.definitions().every((definition) => {
        if (!definition.windowEntry) return true

        const status = host.state.status[definition.id]

        return status === "active" || status === "failed" || status === "disabled"
      }),
  )

  // Hands the settled plugin set to the theme provider, outside the plugin host.
  createEffect(() => {
    if (settled()) theme.settle()
  })

  return (
    <For each={host.items(Theme)}>
      {(item) => {
        // SAFETY: an SDK theme has the bundled themes' shape with colors typed as plain strings; the resolver parses
        // any string without throwing (a malformed color resolves to black), so the narrower color types add nothing.
        onCleanup(theme.registerTheme({ ...item.value, id: `${item.plugin}:${item.value.id}` } as DesktopTheme))

        return null
      }}
    </For>
  )
}

/**
 * Routes local markdown links in the session to plugin LinkHandler contributions, keeping image loading, hands
 * fenced code blocks to plugin CodeBlock and CodeBlockAction contributions, and the rows of tools without a built-in
 * renderer to plugin ToolRenderer contributions. A turn's sources chip opens its turn through the Sources plugin's
 * handler.
 */
export function PluginLinks(props: ParentProps<{ session: MountedSession; screen: SessionScreen; active?: boolean }>) {
  const host = usePluginHost()
  const markdown = useMarkdown()

  // Checks untracked: markdown calls this inside its render effect, which must not follow the routed session.
  const localFileExists = createLinkCheck(
    () => props.active !== false,
    (href) => host.links.exists({ href, session: props.session }),
  )

  const Links = (inner: ParentProps<{ codeBlocks: MarkdownCodeBlocks | false }>) => (
    <MarkdownProvider
      readImage={markdown?.readImage}
      openLocalFile={(href) => void host.links.open({ href, session: props.session })}
      localFileExists={localFileExists}
      codeBlocks={inner.codeBlocks}
    >
      {inner.children}
    </MarkdownProvider>
  )

  const codeBlocks = createCodeBlocks(() => props.session, Links)

  const tools = createToolViews(
    () => props.session,
    () => props.screen,
  )

  return (
    <Links codeBlocks={codeBlocks}>
      <ToolViewsProvider value={tools}>
        <SourcesProvider
          enabled={sourcesExperiment.enabled}
          icons={sourcesExperiment.icons}
          onOpen={(from) => void host.links.open({ href: from, origin: "sources", session: props.session })}
        >
          {props.children}
        </SourcesProvider>
      </ToolViewsProvider>
    </Links>
  )
}

/**
 * The `CodeBlock` renderers and `CodeBlockAction` buttons for the session's Markdown, by language. Markdown asks only
 * for complete blocks of a listed language. Content renders inside `Provider` with code block content off, under the
 * plugin's error isolation: a render that throws or declines shows the code again.
 */
function createCodeBlocks(
  session: () => MountedSession,
  Provider: Component<ParentProps<{ codeBlocks: false }>>,
): MarkdownCodeBlocks {
  const host = usePluginHost()
  const owner = getOwner()
  const wrapped = new WeakMap<Item<CodeBlockAction>, MarkdownCodeAction>()

  // The renderer each language goes to and the action buttons; a new value only when one of them changes, so markdown
  // decorates its blocks again only then.
  const current = createMemo(
    () => {
      const renderers = new Map<string, Item<CodeBlock>>()
      host.items(CodeBlock).forEach((item) =>
        item.value.languages.forEach((language) => {
          const key = language.toLowerCase()

          if (!renderers.has(key)) renderers.set(key, item)
        }),
      )
      const actions = host.items(CodeBlockAction).toSorted((a, b) => (a.value.order ?? 0) - (b.value.order ?? 0))

      return {
        renderers,
        items: actions,
        render: new Set(renderers.keys()),
        actions: new Set(actions.flatMap((item) => item.value.languages.map((language) => language.toLowerCase()))),
      }
    },
    undefined,
    {
      equals: (a, b) =>
        a.items.length === b.items.length &&
        a.items.every((item, index) => item === b.items[index]) &&
        a.renderers.size === b.renderers.size &&
        [...a.renderers].every(([language, item]) => b.renderers.get(language) === item),
    },
  )

  const input = (block: MarkdownCodeBlock): CodeBlockProps => ({
    code: block.code,
    language: block.language,
    get session() {
      return session()
    },
  })

  const action = (item: Item<CodeBlockAction>) => {
    const known = wrapped.get(item)

    if (known) return known

    // Getters, so a title read from the locale follows it.
    const next: MarkdownCodeAction = {
      get icon() {
        return item.value.icon
      },
      get title() {
        return item.value.title
      },
      run: (block) =>
        void Promise.try(() => item.value.run(input(block))).catch((cause: unknown) =>
          console.error(`[plugin] ${item.plugin}`, cause),
        ),
    }

    wrapped.set(item, next)

    return next
  }

  return {
    current,
    render(target, block, fallback) {
      const item = untrack(current).renderers.get(block.language)

      if (!item) return

      return runWithOwner(owner, () =>
        render(
          () => (
            <Provider codeBlocks={false}>
              <Contribution plugin={item.plugin} failed={fallback}>
                {() => {
                  const view = item.value.render(input(block))

                  // Declined: markdown shows the code again once this render returns.
                  if (view === undefined || view === null) queueMicrotask(fallback)

                  return view
                }}
              </Contribution>
            </Provider>
          ),
          target,
        ),
      )
    },
    actions: (language) =>
      current()
        .items.filter((item) => item.value.languages.some((name) => name.toLowerCase() === language))
        .map(action),
  }
}

/**
 * The `ToolRenderer` views for the session's tool rows, by tool name. Every row of a tool without a built-in renderer
 * shares one index of the contributions and looks its tool up once. Content renders under the plugin's error
 * isolation: a row whose renderer throws records the failure and shows the default row.
 */
function createToolViews(session: () => MountedSession, screen: () => SessionScreen): ToolViews {
  const host = usePluginHost()

  const index = createMemo(() => {
    const items = host.items(ToolRenderer)
    const exact = new Map<string, Item<ToolRenderer>>()

    items.forEach((item) => {
      if (!item.value.tool.endsWith("*") && !exact.has(item.value.tool)) exact.set(item.value.tool, item)
    })

    // A stable sort, so equally long patterns keep contribution order.
    const patterns = items
      .filter((item) => item.value.tool.endsWith("*"))
      .toSorted((a, b) => b.value.tool.length - a.value.tool.length)

    return { exact, patterns }
  })

  // One view per contribution, so a row keeps its renderer while other contributions change.
  const views = new WeakMap<Item<ToolRenderer>, ToolView>()

  const view = (item: Item<ToolRenderer>) => {
    const cached = views.get(item)

    if (cached) return cached

    const input = (tool: ToolCallView): ToolRenderProps => ({
      tool,
      get session() {
        return session()
      },
      get screen() {
        return screen()
      },
    })

    const created: ToolView = {
      trigger: (tool) => item.value.trigger?.(input(tool)),
      render: item.value.render ? (tool) => item.value.render?.(input(tool)) : undefined,
      isolate: (children, fallback) => {
        const [failed, setFailed] = createSignal(false)

        return (
          <Show when={!failed()} fallback={fallback()}>
            <Contribution plugin={item.plugin} failed={() => setFailed(true)}>
              {children}
            </Contribution>
          </Show>
        )
      },
    }

    views.set(item, created)

    return created
  }

  const match = (name: string) => {
    const current = index()

    const item =
      current.exact.get(name) ?? current.patterns.find((pattern) => name.startsWith(pattern.value.tool.slice(0, -1)))

    return item ? view(item) : undefined
  }

  return { match }
}
