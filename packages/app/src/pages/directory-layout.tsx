import { createMemo, Show, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { LocalProvider } from "@/context/local"
import { DataProvider } from "@opencode-ai/ui/context"
import { SessionProviders } from "@/app"

function ProjectDataProvider(props: ParentProps<{ projectID: string }>) {
  const navigate = useNavigate()
  const sync = useSync()

  return (
    <DataProvider
      data={sync.data}
      directory={props.projectID}
      onNavigateToSession={(sessionID: string) => navigate(`/${props.projectID}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${props.projectID}/session/${sessionID}`}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const projectID = createMemo(() => params.dir?.trim() ?? "")

  return (
    <Show when={projectID()}>
      {(id) => (
        <SDKProvider directory={id}>
          <SyncProvider>
            <SessionProviders>
              <ProjectDataProvider projectID={id()}>{props.children}</ProjectDataProvider>
            </SessionProviders>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
