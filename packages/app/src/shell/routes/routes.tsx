import { Route, useParams } from "@solidjs/router"
import { createMemo, lazy, Show, type ParentProps } from "solid-js"
import { Home } from "@/home/route"
import { ServerProvider } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { SessionRouteFrame } from "@/session/session-frame"
import { LayoutProvider } from "@/shell/state/layout"
import { SettingsSurfaceProvider } from "@/settings/surface"
import Shell from "@/shell/shell"
import { requireServerKey } from "./session"

export const File = lazy(() => import("@opencode-ai/session-ui/file").then((module) => ({ default: module.File })))
const loadSessionRoute = () => Promise.all([import("@/session/route"), File.preload()]).then(([module]) => module)
const DraftRoute = lazy(() => import("@/new-session/route").then((module) => ({ default: module.DraftRoute })))
const SettingsScreen = lazy(() => import("@/settings/shell").then((module) => ({ default: module.SettingsScreen })))
const TargetSessionRouteContent = lazy(() =>
  loadSessionRoute().then((module) => ({ default: module.TargetSessionRouteContent })),
)

export function preloadRoute(url: string) {
  const pathname = url.split(/[?#]/, 1)[0]
  if (pathname === "/new-session") return DraftRoute.preload().then(() => undefined)
  if (pathname === "/settings") return SettingsScreen.preload().then(() => undefined)
  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(pathname))
    return TargetSessionRouteContent.preload().then(() => undefined)
  return Promise.resolve()
}

export function AppRoutes() {
  return (
    <Route component={AppLayout}>
      <Route path="/" component={Home} />
      <Route path="/settings" component={SettingsScreen} />
      <Route
        path="/server/:serverKey/session/:id"
        component={() => (
          <SessionRouteFrame>
            <TargetServerRoute>
              <TargetSessionRouteContent />
            </TargetServerRoute>
          </SessionRouteFrame>
        )}
      />
      <Route path="/new-session" component={DraftRoute} />
    </Route>
  )
}

function TargetServerRoute(props: ParentProps) {
  const params = useParams<{ serverKey: string }>()
  const global = useGlobal()
  const connection = createMemo(() =>
    global.servers.list().find((item) => ServerConnection.key(item) === requireServerKey(params.serverKey)),
  )

  return (
    <Show when={connection()} keyed>
      {(connection) => <ServerProvider conn={connection}>{props.children}</ServerProvider>}
    </Show>
  )
}

function AppLayout(props: ParentProps) {
  return (
    <LayoutProvider>
      <SettingsSurfaceProvider>
        <Shell>{props.children}</Shell>
      </SettingsSurfaceProvider>
    </LayoutProvider>
  )
}
