import { Route, useParams } from "@solidjs/router"
import { createMemo, lazy, Show, Suspense, type ParentProps } from "solid-js"
import { Home } from "@/home/route"
import { ServerProvider } from "@/runtime/server/current"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"
import { LayoutProvider } from "@/shell/state/layout"
import { TitlebarHistoryProvider } from "@/shell/titlebar/history-context"
import Shell from "@/shell/shell"
import { requireServerKey } from "./session"

export const File = lazy(() => import("@opencode-ai/session-ui/file").then((module) => ({ default: module.File })))
const loadDraftRoute = () => Promise.all([import("@/new-session/route"), File.preload()]).then(([module]) => module)
const loadSessionRoute = () => Promise.all([import("@/session/route"), File.preload()]).then(([module]) => module)
const DraftRoute = lazy(() => loadDraftRoute().then((module) => ({ default: module.DraftRoute })))
const SettingsRoute = lazy(() => import("@/settings/shell").then((module) => ({ default: module.SettingsScreen })))
const TargetSessionRouteContent = lazy(() =>
  loadSessionRoute().then((module) => ({ default: module.TargetSessionRouteContent })),
)

export function preloadRoute(url: string) {
  const pathname = url.split(/[?#]/, 1)[0]
  if (pathname === "/settings") return SettingsRoute.preload().then(() => undefined)
  if (pathname === "/new-session") return DraftRoute.preload().then(() => undefined)
  if (/^\/server\/[^/]+\/session\/[^/]+$/.test(pathname))
    return TargetSessionRouteContent.preload().then(() => undefined)
  return Promise.resolve()
}

export function AppRoutes() {
  return (
    <Route component={AppLayout}>
      <Route path="/" component={Home} />
      <Route path="/settings" component={SettingsRoute} />
      <Route
        path="/server/:serverKey/session/:id"
        component={() => (
          <SessionRouteFrame>
            <Suspense
              fallback={
                <div class="flex min-h-0 flex-1 p-2">
                  <SessionPanelFrame raised />
                </div>
              }
            >
              <TargetServerRoute>
                <TargetSessionRouteContent />
              </TargetServerRoute>
            </Suspense>
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
      <TitlebarHistoryProvider>
        <Shell>{props.children}</Shell>
      </TitlebarHistoryProvider>
    </LayoutProvider>
  )
}
