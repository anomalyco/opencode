/**
 * Tab Content Area
 *
 * Renders the content for the active tab.
 * Uses Portal pattern: renders a DOM host in app scope, actual content is Portaled from directory scope.
 *
 * Why Portal?
 * - App scope (this component) does NOT have SyncProvider, TerminalProvider, etc.
 * - Directory scope (inside DirectoryLayout) HAS these providers
 * - Solid context is tied to component owner (creation site), not DOM insertion
 * - So we create content in directory scope and Portal it into the host here
 *
 * @see /ARCHITECTURE.md for the directory-scope vs app-scope portal pattern
 */

import { Match, Show, Switch, createMemo, type JSX } from "solid-js"
import { useClaxedoLayout, type TabItem } from "../context/claxedo-layout"

export type TabContentAreaProps = {
  /**
   * Group ID for split workspace support. If provided, reads from group-specific tabs.
   */
  groupId?: string

  /**
   * Render function for empty state (no tabs)
   */
  renderEmpty?: () => JSX.Element

  /**
   * Additional class name
   */
  class?: string
}

/**
 * Generate a stable host ID for a tab.
 * This ID is used by Portal in directory scope to mount content here.
 */
export function getTabHostId(tabId: string) {
  return `claxedo-tab-host-${tabId}`
}

export function TabContentArea(props: TabContentAreaProps) {
  const claxedo = useClaxedoLayout()

  const activeTab = createMemo(() => {
    if (props.groupId) return claxedo.groupTabs(props.groupId).active()
    return claxedo.topTabs.active()
  })

  return (
    <div class={`relative flex-1 min-h-0 ${props.class ?? ""}`}>
      <Show
        when={activeTab()}
        fallback={
          <Show when={props.renderEmpty}>
            {(render) => (
              <div class="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-text-weak">
                {render()()}
              </div>
            )}
          </Show>
        }
      >
        {(tab) => (
          <Switch
            fallback={
              <div class="absolute inset-0 flex items-center justify-center text-text-weak">Unknown tab type</div>
            }
          >
            <Match when={tab().type === "session" && tab().id}>
              <div id={getTabHostId(tab().id)} data-claxedo-group-id={props.groupId} class="absolute inset-0 overflow-hidden" />
            </Match>

            <Match when={tab().type === "terminal" && tab().id}>
              <div id={getTabHostId(tab().id)} data-claxedo-group-id={props.groupId} class="absolute inset-0 overflow-hidden" />
            </Match>

            <Match when={tab().type === "review" && tab().id}>
              <div id={getTabHostId(tab().id)} data-claxedo-group-id={props.groupId} class="absolute inset-0 overflow-hidden" />
            </Match>

            <Match when={tab().type === "file" && tab().id}>
              <div id={getTabHostId(tab().id)} data-claxedo-group-id={props.groupId} class="absolute inset-0 overflow-hidden" />
            </Match>
          </Switch>
        )}
      </Show>
    </div>
  )
}

/**
 * Hook to get the current active tab and its content identifiers
 */
export function useActiveTab(groupId?: string) {
  const claxedo = useClaxedoLayout()

  const activeTab = createMemo(() => {
    if (groupId) return claxedo.groupTabs(groupId).active()
    return claxedo.topTabs.active()
  })
  const activeType = createMemo(() => activeTab()?.type)
  const activeSessionId = createMemo(() => activeTab()?.sessionId)
  const activeTerminalId = createMemo(() => activeTab()?.terminalId)
  const activeFilePath = createMemo(() => activeTab()?.filePath)

  return {
    tab: activeTab,
    type: activeType,
    sessionId: activeSessionId,
    terminalId: activeTerminalId,
    filePath: activeFilePath,

    isSession: createMemo(() => activeType() === "session"),
    isReview: createMemo(() => activeType() === "review"),
    isFile: createMemo(() => activeType() === "file"),
  }
}
