import { Navigate, Route, useParams } from "@solidjs/router"
import { createMemo, lazy, Show, type ParentProps } from "solid-js"
import { Home } from "@/home/route"
import { ServerProvider } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { LayoutProvider } from "@/shell/state/layout"
import Shell from "@/shell/shell"
import { parseServerKey } from "./session"

export const File = lazy(() => import("@opencode-ai/session-ui/file").then((module) => ({ default: module.File })))
const loadDraftRoute = () => Promise.all([import("@/new-session/route"), File.preload()]).then(([module]) => module)
const loadSessionRoute = () => Promise.all([import("@/session/route"), File.preload()]).then(([module]) => module)
const DraftRoute = lazy(() => loadDraftRoute().then((module) => ({ default: module.DraftRoute })))
const TargetSessionRouteContent = lazy(() =>
  loadSessionRoute().then((module) => ({ default: module.TargetSessionRouteContent })),
)

export function preloadRoute(url: string) {
  const pathname = url.split(/[?#]/, 1)[0]
  if (pathname === "/new-session") return DraftRoute.preload().then(() => undefined)
  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(pathname))
    return TargetSessionRouteContent.preload().then(() => undefined)
  return Promise.resolve()
}

export function AppRoutes() {
  return (
    <Route component={AppLayout}>
      <Route path="/" component={Home} />
      <Route
        path="/server/:serverKey/session/:id"
        component={() => (
          <TargetServerRoute>
            <TargetSessionRouteContent />
          </TargetServerRoute>
        )}
      />
      <Route path="/new-session" component={DraftRoute} />
    </Route>
  )
}

function TargetServerRoute(props: ParentProps) {
  const params = useParams<{ serverKey: string }>()
  const global = useGlobal()
  const connection = createMemo(() => {
    const key = parseServerKey(params.serverKey)
    if (!key) return
    return global.servers.list().find((item) => ServerConnection.key(item) === key)
  })

  return (
    <Show when={connection()} keyed fallback={<Navigate href="/" />}>
      {(connection) => <ServerProvider conn={connection}>{props.children}</ServerProvider>}
    </Show>
  )
}

function AppLayout(props: ParentProps) {
  return (
    <LayoutProvider>
      <Shell>{props.children}</Shell>
    </LayoutProvider>
  )
}
