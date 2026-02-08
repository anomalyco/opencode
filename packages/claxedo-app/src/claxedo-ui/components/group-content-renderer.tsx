/**
 * GroupContentRenderer
 *
 * Renders content for a specific group panel based on its active tab.
 * Each group gets its own DirectoryScope + SessionParamsProvider,
 * allowing multiple sessions to render simultaneously in split mode.
 *
 * Uses CSS visibility caching: previously-rendered tabs stay mounted in
 * the DOM and are hidden with `display: none` instead of being destroyed.
 * This avoids re-creating the expensive provider chain (DirectoryScope
 * with 8 nested providers + SessionPage) on every tab switch.
 */

import { Show, For, Switch, Match, Suspense, createMemo, createSignal, createEffect, on, lazy, type JSX } from "solid-js"
import { useClaxedoLayout } from "../context/claxedo-layout"
import { DirectoryScope } from "./directory-scope"
import { SessionParamsProvider } from "../context/session-params"
import { GroupIdProvider } from "../context/group-id"
import { GroupLayoutProvider } from "./group-layout-provider"
import { TabReview } from "./tab-review"
import { TabFile } from "./tab-file"

const SessionPage = lazy(() => import("../../overrides/pages/session"))

function Loading() {
  return (
    <div class="flex items-center justify-center h-full text-text-weak">
      <div class="size-6 rounded-full border-2 border-text-weak border-t-transparent animate-spin" />
    </div>
  )
}

export function GroupContentRenderer(props: { groupId: string; renderEmpty?: () => JSX.Element }) {
  const claxedo = useClaxedoLayout()
  const tabs = createMemo(() => claxedo.groupTabs(props.groupId))
  const wt = claxedo.groupWorktree(props.groupId)

  // Active tab, filtered by pinned workspace — returns undefined when the
  // active tab's directory doesn't match the pinned workspace filter.
  const activeTab = createMemo(() => {
    const tab = tabs().active()
    if (!tab) return undefined
    const pinned = wt.pinned()
    if (pinned && tab.directory !== pinned) return undefined
    return tab
  })

  // Track which tab IDs have been mounted (activated at least once).
  // These tabs stay in the DOM even when inactive, hidden via CSS.
  const [mounted, setMounted] = createSignal<string[]>([])

  // When the active tab changes, add it to the mounted list if not already there.
  createEffect(
    on(
      () => activeTab()?.id,
      (id) => {
        if (!id) return
        setMounted((prev) => (prev.includes(id) ? prev : [...prev, id]))
      },
    ),
  )

  // When tabs are closed (removed from items list), remove them from mounted list.
  createEffect(
    on(
      () => tabs().items(),
      (items) => {
        const liveIds = new Set(items.map((t) => t.id))
        setMounted((prev) => {
          const next = prev.filter((id) => liveIds.has(id))
          return next.length === prev.length ? prev : next
        })
      },
    ),
  )

  return (
    <GroupLayoutProvider groupId={props.groupId}>
      <div class="relative flex-1 min-h-0">
        <Show when={!activeTab() && props.renderEmpty}>
          {(render) => (
            <div class="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-text-weak">
              {render()()}
            </div>
          )}
        </Show>
        <For each={mounted()}>
          {(tabId) => {
            const tab = createMemo(() => tabs().items().find((t) => t.id === tabId))
            const isActive = createMemo(() => activeTab()?.id === tabId)

            return (
              <Show when={tab()}>
                {(t) => (
                  <div
                    class="absolute inset-0 overflow-hidden"
                    classList={{ hidden: !isActive() }}
                  >
                    <Switch
                      fallback={
                        <div class="absolute inset-0 flex items-center justify-center text-text-weak">
                          Unknown tab type
                        </div>
                      }
                    >
                      <Match when={t().type === "session" && t().directory}>
                        <GroupIdProvider groupId={props.groupId}>
                          <DirectoryScope
                            directory={t().directory}
                            onNavigateToSession={(sessionId) => {
                              const ta = tabs()
                              const newTabId = ta.addSession(t().directory, sessionId, "Session")
                              if (newTabId) ta.setActive(newTabId)
                            }}
                          >
                            <SessionParamsProvider
                              sessionId={() => t().sessionId}
                              directory={() => t().directory}
                              groupId={() => props.groupId}
                            >
                              <Suspense fallback={<Loading />}>
                                <SessionPage />
                              </Suspense>
                            </SessionParamsProvider>
                          </DirectoryScope>
                        </GroupIdProvider>
                      </Match>

                      <Match when={t().type === "terminal" && t().directory}>
                        <div id={`claxedo-tab-host-${t().id}`} class="absolute inset-0 overflow-hidden" />
                      </Match>

                      <Match when={t().type === "review" && t().sessionId && t().directory}>
                        <GroupIdProvider groupId={props.groupId}>
                          <DirectoryScope
                            directory={t().directory!}
                            onNavigateToSession={(sessionId) => {
                              const ta = tabs()
                              const newTabId = ta.addSession(t().directory!, sessionId, "Session")
                              if (newTabId) ta.setActive(newTabId)
                            }}
                          >
                            <TabReview
                              sessionId={t().sessionId!}
                              onViewFile={(path) => {
                                const title = path.split("/").at(-1) ?? path
                                tabs().addFile(t().directory!, path, title)
                              }}
                            />
                          </DirectoryScope>
                        </GroupIdProvider>
                      </Match>

                      <Match when={t().type === "file" && t().filePath}>
                        <TabFile path={t().filePath!} />
                      </Match>
                    </Switch>
                  </div>
                )}
              </Show>
            )
          }}
        </For>
      </div>
    </GroupLayoutProvider>
  )
}
