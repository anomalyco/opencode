import {
  createComponent,
  createComputed,
  createMemo,
  createRoot,
  getOwner,
  on,
  onCleanup,
  untrack,
  type Accessor,
  type Context,
  type JSX,
} from "solid-js"
import { DataContext, useData } from "@opencode/session-ui/context"
import { MarkdownContext, useMarkdown } from "@opencode/session-ui/context/markdown"
import { createScopedCache } from "@/runtime/server/scoped-cache"
import { useWorkspaceLocation, WorkspaceLocationContext } from "@/workspaces/location"
import type { TimelineSessionSource } from "./controller"

export function createTimelineCache(
  session: TimelineSessionSource,
  render: (source: TimelineSessionSource, active: Accessor<boolean>) => JSX.Element,
  visible: Accessor<boolean>,
  transcript: (sessionID: string) => readonly unknown[],
) {
  const owner = getOwner()
  // These providers follow the selected Location. Each view reads its own copies, which hold while it is detached,
  // so a view kept while another Location is selected never reads that Location's providers.
  const location = useWorkspaceLocation()
  const data = useData()
  const markdown = useMarkdown()

  // The key and directory of each session's view. A session moved to another directory gets a new key; its old view
  // goes first, so the old view saves its scroll and disclosures before the new one reads them.
  const keys = new Map<string, { key: string; directory?: string }>()

  const cache = createScopedCache(
    (key) =>
      createRoot((dispose) => {
        const id = untrack(session.identity.sessionID)
        const sessionKey = untrack(session.identity.sessionKey)
        const active = createMemo(() => visible() && session.identity.sessionKey() === key)

        // A detached view retains its own inputs until it is selected again, and reads each once on creation.
        const select = <T>(read: Accessor<T>) => {
          const held = createMemo<{ value: T } | undefined>(
            (previous) => (active() || !previous ? { value: read() } : previous),
            undefined,
            { equals: (previous, next) => previous?.value === next?.value },
          )

          return () => held()!.value
        }

        // Session retention evicts the transcripts of closed sessions. A detached view would still hold the old
        // transcript and its DOM, so it goes too; reopening the session renders a new view. It goes in the same flush,
        // before its effects run, so none of them reloads what was just evicted, such as a subagent's parent.
        createComputed(
          on(
            () => !!id && transcript(id).length === 0,
            (evicted, previous) => {
              if (!evicted || previous !== false || untrack(active)) return

              if (cache.peek(key)?.dispose === dispose) cache.delete(key)
            },
          ),
        )

        const store = select(() => data.store)
        const directory = select(() => data.directory)
        const sessionID = select(() => data.sessionID)
        const agents = select(() => data.agents)
        // Local file links are not held: each view provides its own link handling for its session.
        const readImage = select(() => markdown?.readImage)
        const openSession = select(() => markdown?.openSession)
        const sessionTitle = select(() => markdown?.sessionTitle)
        const turnDiff = select(() => data.turnDiff)

        // The Location's config is a query: read it in the reader and only while selected, so a pending config
        // suspends that reader as the live provider would rather than this view's owner, the whole screen.
        let compaction = false

        const backgroundCompaction = () => {
          if (!active()) return compaction

          compaction = data.backgroundCompaction

          return compaction
        }

        const view = () =>
          render(
            {
              identity: {
                params: session.identity.params,
                sessionID: () => id,
                sessionKey: () => sessionKey,
              },
              data: {
                info: select(session.data.info),
                parent: select(session.data.parent),
                parentID: select(session.data.parentID),
                status: select(session.data.status),
              },
              history: { messages: select(session.history.messages) },
            },
            active,
          )

        return {
          value: provide(WorkspaceLocationContext, select(location), () =>
            provide(
              DataContext,
              {
                get store() {
                  return store()
                },
                get directory() {
                  return directory()
                },
                get sessionID() {
                  return sessionID()
                },
                get agents() {
                  return agents()
                },
                get backgroundCompaction() {
                  return backgroundCompaction()
                },
                navigateToSession: data.navigateToSession,
                sessionHref: data.sessionHref,
                readMedia: data.readMedia,
                peekMedia: data.peekMedia,
                shellRunning: data.shellRunning,
                // A hidden running shell stops polling its output and resumes from its cursor once selected.
                get shellOutput() {
                  return active() ? data.shellOutput : undefined
                },
                get turnDiff() {
                  return turnDiff()
                },
              },
              () =>
                provide(
                  MarkdownContext,
                  {
                    get readImage() {
                      return readImage()
                    },
                    get openSession() {
                      return openSession()
                    },
                    get sessionTitle() {
                      return sessionTitle()
                    },
                  },
                  view,
                ),
            ),
          ),
          dispose,
        }
      }, owner),
    {
      maxEntries: 16,
      dispose: (entry, key) => {
        entry.dispose()

        for (const [id, value] of keys) if (value.key === key) keys.delete(id)
      },
    },
  )

  onCleanup(cache.clear)

  return () => {
    const key = session.identity.sessionKey()
    const id = untrack(session.identity.sessionID)

    if (id) {
      const previous = keys.get(id)
      const directory = untrack(session.data.info)?.location.directory

      if (previous && previous.key !== key && previous.directory !== directory) cache.delete(previous.key)
      keys.set(id, { key, directory })
    }

    return cache.get(key).value
  }
}

// Untracked like a component: the provider keeps one view rather than rendering another when a read changes.
function provide<T>(context: Context<T>, value: T, children: () => JSX.Element) {
  return createComponent(context.Provider, {
    value,
    get children() {
      return untrack(children)
    },
  })
}
