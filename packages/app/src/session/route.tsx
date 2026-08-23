import { ErrorBoundary, createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { useParams } from "@solidjs/router"
import { CommentsProvider } from "@/composer/comments"
import { FileProvider } from "@/workspaces/files/model"
import { LocationProvider, useWorkspaceLocation } from "@/workspaces/location"
import { ModelsProvider } from "@/providers/models/models"
import { useNotification } from "@/shell/notifications/notification"
import { ComposerPersistenceProvider } from "@/composer/persistence"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { ServerConnection } from "@/runtime/server/registry"
import { TerminalProvider } from "@/session/terminal/context"
import { useSettingsCommand } from "@/settings/command"
import { SessionUIProvider } from "@/shell/routes/session-ui-provider"
import { useTabs } from "@/shell/tabs/tabs"
import { requireServerKey } from "@/shell/routes/session"
import { useSessionModel } from "./model"
import { SessionPanelFrame } from "./session-frame"
import { IncompatibleServerPanel } from "./incompatible-server-panel"
import { SessionErrorFallback } from "./route-error"
import { createSessionResolution } from "./session-resolution"
import { SessionScreen } from "./screen"

export function TargetSessionRouteContent() {
  const params = useParams<{ serverKey: string; id: string }>()
  const data = useData()
  const directory = createMemo(() => data.session.get(params.id)?.location.directory)

  return (
    <>
      <MarkSessionNotificationsViewed sessionID={() => params.id} />
      <ModelsProvider directory={directory}>
        <TargetSessionSettingsCommand />
        <SessionRouteErrorBoundary sessionID={params.id} serverKey={requireServerKey(params.serverKey)}>
          <ResolvedTargetSessionRoute />
        </SessionRouteErrorBoundary>
      </ModelsProvider>
    </>
  )
}

function TargetSessionSettingsCommand() {
  useSettingsCommand()
  return null
}

function SessionRouteErrorBoundary(
  props: ParentProps<{ sessionID?: string; serverKey?: ServerConnection.Key }>,
) {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <SessionStatePanel>
          <SessionErrorFallback error={error} sessionID={props.sessionID} serverKey={props.serverKey} />
        </SessionStatePanel>
      )}
    >
      {props.children}
    </ErrorBoundary>
  )
}

function ResolvedTargetSessionRoute() {
  const params = useParams<{ id: string }>()
  const server = useServer()
  const tabs = useTabs()
  const data = useData()
  const current = createSessionResolution(
    () => params.id,
    () => data.session,
    { children: true },
  )
  const directory = createMemo(() => current()?.location.directory)

  return (
    <Show
      when={!server.health?.incompatible}
      fallback={
        <SessionStatePanel>
          <IncompatibleServerPanel
            onClose={() => tabs.removeSessionTab({ server: server.key, sessionId: params.id })}
          />
        </SessionStatePanel>
      }
    >
      <Show when={directory()} fallback={<SessionStatePanel />}>
        {(value) => (
          <LocationProvider directory={value()}>
            <SessionUIProvider directory={value()} server={server.key}>
              <TargetSessionPage />
            </SessionUIProvider>
          </LocationProvider>
        )}
      </Show>
    </Show>
  )
}

function SessionStatePanel(props: ParentProps) {
  return (
    <div class="flex min-h-0 flex-1 p-2">
      <SessionPanelFrame raised>{props.children}</SessionPanelFrame>
    </div>
  )
}

function TargetSessionPage() {
  const location = useWorkspaceLocation()
  const server = useServerSDK()

  return (
    // Keep workspace-scoped file, prompt, comment, and terminal state alive when
    // the user switches between Sessions in the same workspace.
    <Show when={`${server.scope}\0${location().directory}`} keyed>
      <TerminalProvider>
        <FileProvider>
          <ComposerPersistenceProvider>
            <CommentsProvider>
              <SessionPage />
            </CommentsProvider>
          </ComposerPersistenceProvider>
        </FileProvider>
      </TerminalProvider>
    </Show>
  )
}

function SessionPage() {
  const session = useSessionModel()
  return <SessionScreen session={session} />
}

function MarkSessionNotificationsViewed(props: { sessionID: () => string | undefined }) {
  const notification = useNotification()
  createEffect(() => {
    const sessionID = props.sessionID()
    if (!notification.ready() || !sessionID) return
    if (notification.session.unseenCount(sessionID) === 0) return
    notification.session.markViewed(sessionID)
  })
  return null
}
