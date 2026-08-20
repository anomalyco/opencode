import { Navigate, useSearchParams } from "@solidjs/router"
import { createMemo, Show, type ParentProps } from "solid-js"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { useGlobal } from "@/context/global"
import { LocationProvider } from "@/context/location"
import { ModelsProvider } from "@/context/models"
import { PromptProvider } from "@/context/prompt"
import { ServerProvider } from "@/context/server"
import { ServerConnection } from "@/context/servers"
import { useTabs, type DraftTab } from "@/context/tabs"
import { SessionUIProvider } from "@/pages/directory-layout"
import NewSession from "@/pages/new-session"

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
            <ModelsProvider directory={props.draft.directory}>
              <LocationProvider directory={props.draft.directory}>
                <SessionUIProvider directory={props.draft.directory} server={props.draft.server}>
                  <DraftProviders>
                    <NewSession draftId={props.draft.draftID} />
                  </DraftProviders>
                </SessionUIProvider>
              </LocationProvider>
            </ModelsProvider>
          </ServerProvider>
        )}
      </Show>
    </Show>
  )
}

// The draft page only renders the prompt composer, so it drops TerminalProvider.
// FileProvider and CommentsProvider stay because PromptInput uses file search and comment context.
function DraftProviders(props: ParentProps) {
  return (
    <FileProvider>
      <PromptProvider>
        <CommentsProvider>{props.children}</CommentsProvider>
      </PromptProvider>
    </FileProvider>
  )
}
