import { createMemo, For, Show, type JSX } from "solid-js"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useQuery } from "@tanstack/solid-query"
import { useGlobalSync, loadSessionsQuery } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useWorkspace } from "@/context/workspace"
import { NewSessionItem, SessionItem, SessionSkeleton } from "./sidebar-items"
import { sortedRootSessions } from "./helpers"
import type { Session } from "@opencode-ai/sdk/v2/client"

const FolderSessionList = (props: {
  directory: string
  sortNow: () => number
  clearHoverProjectSoon: () => void
  prefetchSession: (session: Session, priority?: "high" | "low") => void
}): JSX.Element => {
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const layout = useLayout()
  const [store, setStore] = globalSync.child(props.directory)
  const sessions = createMemo(() => sortedRootSessions(store, props.sortNow()))
  const count = createMemo(() => sessions()?.length ?? 0)
  const query = useQuery(() => ({ ...loadSessionsQuery(props.directory) }))
  const hasMore = createMemo(() => store.sessionTotal > count())
  const loading = () => query.isLoading && count() === 0
  const slug = () => base64Encode(props.directory)

  const loadMore = async () => {
    setStore("limit", (limit) => (limit ?? 0) + 5)
    await globalSync.project.loadSessions(props.directory)
  }

  const archiveSession = async (session: Session) => {
    await globalSDK.client.session.update({
      directory: props.directory,
      sessionID: session.id,
      time: { archived: Date.now() },
    })
  }

  return (
    <nav class="flex flex-col gap-1">
      <Show when={!loading() && count() === 0}>
        <NewSessionItem
          slug={slug()}
          sidebarExpanded={layout.sidebar.opened}
          clearHoverProjectSoon={props.clearHoverProjectSoon}
        />
      </Show>
      <Show when={loading()}>
        <SessionSkeleton />
      </Show>
      <For each={sessions()}>
        {(session) => (
          <SessionItem
            session={session}
            list={sessions()}
            slug={slug()}
            showChild
            sidebarExpanded={layout.sidebar.opened}
            clearHoverProjectSoon={props.clearHoverProjectSoon}
            prefetchSession={props.prefetchSession}
            archiveSession={archiveSession}
          />
        )}
      </For>
      <Show when={hasMore()}>
        <button
          class="flex w-full text-left justify-start text-14-regular text-text-weak pl-2 pr-10 py-2 hover:bg-surface-raised-base-hover rounded-md"
          onClick={() => void loadMore()}
        >
          {language.t("common.loadMore")}
        </button>
      </Show>
    </nav>
  )
}

export function SidebarWorkspaceGroup(props: {
  clearHoverProjectSoon?: () => void
  prefetchSession?: (session: Session, priority?: "high" | "low") => void
}): JSX.Element {
  const workspace = useWorkspace()
  const currentWorkspace = workspace.workspaces.current()

  if (!currentWorkspace) return null

  const clearHover = () => props.clearHoverProjectSoon?.()
  const prefetch = (session: Session, priority?: "high" | "low") => props.prefetchSession?.(session, priority)

  return (
    <div data-component="sidebar-workspace-group" class="size-full flex flex-col overflow-y-auto no-scrollbar py-2">
      <div class="workspace-header px-4 py-2 shrink-0">
        <span class="workspace-name text-14-medium text-text-strong">{currentWorkspace.name}</span>
      </div>

      <div class="flex flex-col gap-1 px-2">
        <For each={currentWorkspace.folders}>
          {(folder) => (
            <Collapsible variant="ghost" defaultOpen class="shrink-0">
              <Collapsible.Trigger class="flex items-center w-full pl-2 py-1.5 rounded-md hover:bg-surface-raised-base-hover transition-colors">
                  <div class="flex items-center gap-1 min-w-0 flex-1">
                    <div class="shrink-0 size-6 flex items-center justify-center">
                      <Icon name="folder" size="small" class="text-icon-base" />
                    </div>
                    <Tooltip value={folder.path}>
                      <span class="text-14-medium text-text-base min-w-0 truncate">{folder.path}</span>
                    </Tooltip>
                  </div>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <div class="py-1">
                  <FolderSessionList
                    directory={folder.path}
                    sortNow={() => Date.now()}
                    clearHoverProjectSoon={clearHover}
                    prefetchSession={prefetch}
                  />
                </div>
              </Collapsible.Content>
            </Collapsible>
          )}
        </For>
      </div>
    </div>
  )
}
