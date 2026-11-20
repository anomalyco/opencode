import { useSearchParams } from "@solidjs/router"
import { createMemo, Show, type ParentProps } from "solid-js"
import { CommentsProvider } from "@/composer/comments"
import { ComposerPersistenceProvider } from "@/composer/persistence"
import { ModelsProvider } from "@/providers/models/models"
import { Contribution } from "@/runtime/plugin/render"
import { ServerProvider, useServer } from "@/runtime/server/current"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { isServerHealthy } from "@/runtime/server/health-machine"
import { useGlobal } from "@/runtime/server/runtime"
import { SessionUIProvider } from "@/shell/routes/session-ui-provider"
import { FileProvider } from "@/workspaces/files/model"
import { LocationProvider } from "@/workspaces/location"
import { LabBrowser } from "./browser"
import { loadLabCatalog, type StoryModule } from "./catalog"

// Standalone stories mount fixture runtimes that must not access the live app's storage.
// Vite needs the patterns as literals in each call.
const modules = import.meta.glob<StoryModule>([
  "../**/*.stories.tsx",
  "../../../ui/src/**/*.stories.tsx",
  "../../../session-ui/src/**/*.stories.tsx",
  "../../../gui-plugins/src/**/*.stories.tsx",
  "!../**/*.standalone.stories.tsx",
])

// Each file's text, for the order its states were written in.
const sources = import.meta.glob<string>(
  [
    "../**/*.stories.tsx",
    "../../../ui/src/**/*.stories.tsx",
    "../../../session-ui/src/**/*.stories.tsx",
    "../../../gui-plugins/src/**/*.stories.tsx",
    "!../**/*.standalone.stories.tsx",
  ],
  { query: "?raw", import: "default" },
)

export default function ComponentsLab() {
  const [params, setParams] = useSearchParams<{ story?: string; view?: string }>()

  return (
    <LabBrowser
      params={params}
      setParams={setParams}
      loadCatalog={() => loadLabCatalog(modules, sources)}
      workspace={Workspace}
      plugin={Plugin}
    />
  )
}

/**
 * The provider stack of a draft session in the first project of the first healthy server, so a story that reads the
 * server, models, location or composer state renders as it does in the app. Without a server, stories render bare.
 */
function Workspace(props: ParentProps) {
  const servers = useServers()
  const global = useGlobal()

  // Kept once picked while the server stays listed: a new pick remounts the story, losing whatever it was showing.
  const healthy = createMemo((picked?: ServerConnection.Any) =>
    picked && servers.list.some((conn) => ServerConnection.key(conn) === ServerConnection.key(picked))
      ? picked
      : servers.list.find((conn) => isServerHealthy(global.servers.health[ServerConnection.key(conn)])),
  )

  return (
    <Show when={healthy()} keyed fallback={props.children}>
      {(conn) => (
        <ServerProvider conn={conn}>
          <Project>{props.children}</Project>
        </ServerProvider>
      )}
    </Show>
  )
}

function Project(props: ParentProps) {
  const server = useServer()

  // The list puts the most recently active project first, and on a busy server that changes every few seconds. The
  // story keeps the project it started in, so another session's activity never remounts it.
  const directory = createMemo((picked?: string) => {
    const list = server.ctx.projects.list()

    return picked && list.some((project) => project.worktree === picked) ? picked : list[0]?.worktree
  })

  return (
    <Show when={directory()} keyed fallback={props.children}>
      {(directory) => (
        <ModelsProvider directory={directory}>
          <LocationProvider directory={directory}>
            <SessionUIProvider directory={directory} server={server.key}>
              <FileProvider>
                <ComposerPersistenceProvider>
                  <CommentsProvider>{props.children}</CommentsProvider>
                </ComposerPersistenceProvider>
              </FileProvider>
            </SessionUIProvider>
          </LocationProvider>
        </ModelsProvider>
      )}
    </Show>
  )
}

// A story of a plugin renders as its contributions do: inside that plugin's context from the app's host.
function Plugin(props: ParentProps<{ file: string }>) {
  const id = props.file.match(/gui-plugins\/src\/([^/]+)\//)?.[1]

  return id ? <Contribution plugin={id}>{() => props.children}</Contribution> : props.children
}
