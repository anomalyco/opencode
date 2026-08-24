import { Navigate, useSearchParams } from "@solidjs/router"
import { createMemo, Show, type ParentProps } from "solid-js"
import { CommentsProvider } from "@/composer/comments"
import { FileProvider } from "@/workspaces/files/model"
import { useGlobal } from "@/runtime/server/runtime"
import { LocationProvider } from "@/workspaces/location"
import { ModelsProvider } from "@/providers/models/models"
import { ComposerPersistenceProvider } from "@/composer/persistence"
import { ServerProvider, useServer } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { useTabs, type DraftTab } from "@/shell/tabs/tabs"
import { SessionUIProvider } from "@/shell/routes/session-ui-provider"
import NewSession from "@/new-session/screen"
import { IncompatibleServerPanel } from "@/session/incompatible-server-panel"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"

export function DraftRoute() {
  const [search] = useSearchParams<{ draftId?: string }>()
  const tabs = useTabs()
  return (
    <Show
      when={tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === search.draftId)}
      keyed
      fallback={tabs.ready() && <Navigate href="/" />}
    >
      {(draft) => <ResolvedDraftRoute draft={draft} />}
    </Show>
  )
}

function ResolvedDraftRoute(props: { draft: DraftTab }) {
  const global = useGlobal()
  const conn = createMemo(() => global.servers.list().find((item) => ServerConnection.key(item) === props.draft.server))

  return (
    <Show when={`${props.draft.server}\0${props.draft.directory}`} keyed>
      <Show when={conn()} keyed>
        {(conn) => (
          <ServerProvider conn={conn}>
            <ResolvedDraftContent draft={props.draft} />
          </ServerProvider>
        )}
      </Show>
    </Show>
  )
}

function ResolvedDraftContent(props: { draft: DraftTab }) {
  const server = useServer()
  const tabs = useTabs()

  return (
    <Show
      when={!server.health?.incompatible}
      fallback={
        <SessionRouteFrame padded>
          <SessionPanelFrame raised>
            <IncompatibleServerPanel
              onClose={() => {
                const index = tabs.store.findIndex((tab) => tab.type === "draft" && tab.draftID === props.draft.draftID)
                if (index !== -1) tabs.closeTab(index)
              }}
            />
          </SessionPanelFrame>
        </SessionRouteFrame>
      }
    >
      <ModelsProvider directory={props.draft.directory}>
        <LocationProvider directory={props.draft.directory}>
          <SessionUIProvider directory={props.draft.directory} server={props.draft.server}>
            <DraftProviders>
              <NewSession draftId={props.draft.draftID} />
            </DraftProviders>
          </SessionUIProvider>
        </LocationProvider>
      </ModelsProvider>
    </Show>
  )
}

// The draft page only renders the prompt composer, so it drops TerminalProvider.
// FileProvider and CommentsProvider stay because Composer uses file search and comment context.
function DraftProviders(props: ParentProps) {
  return (
    <FileProvider>
      <ComposerPersistenceProvider>
        <CommentsProvider>{props.children}</CommentsProvider>
      </ComposerPersistenceProvider>
    </FileProvider>
  )
}
