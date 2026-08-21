import { ErrorBoundary, createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { useParams } from "@solidjs/router"
import { CommentsProvider } from "@/context/comments"
import { FileProvider } from "@/context/file"
import { LocationProvider, useWorkspaceLocation } from "@/context/location"
import { ModelsProvider } from "@/context/models"
import { useNotification } from "@/context/notification"
import { PromptProvider } from "@/context/prompt"
import { useData, useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection } from "@/context/servers"
import { TerminalProvider } from "@/context/terminal"
import { useSettingsCommand } from "@/components/settings-dialog"
import { SessionUIProvider } from "@/pages/directory-layout"
import { requireServerKey } from "@/utils/session-route"
import { useSessionModel } from "./model"
import { SessionPanelFrame, SessionRouteFrame } from "./session-frame"
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
        <SessionRouteErrorBoundary sessionID={params.id} serverKey={requireServerKey(params.serverKey)} padded>
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
  props: ParentProps<{ sessionID?: string; serverKey?: ServerConnection.Key; padded?: boolean }>,
) {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <SessionRouteFrame padded={props.padded}>
          <SessionPanelFrame raised={!!props.sessionID}>
            <SessionErrorFallback error={error} sessionID={props.sessionID} serverKey={props.serverKey} />
          </SessionPanelFrame>
        </SessionRouteFrame>
      )}
    >
      {props.children}
    </ErrorBoundary>
  )
}

function ResolvedTargetSessionRoute() {
  const params = useParams<{ id: string }>()
  const server = useServer()
  const data = useData()
  const current = createSessionResolution(
    () => params.id,
    () => data.session,
    { children: true },
  )
  const directory = createMemo(() => current()?.location.directory)

  return (
    <Show when={directory()}>
      {(value) => (
        <LocationProvider directory={value()}>
          <SessionUIProvider directory={value()} server={server.key}>
            <TargetSessionPage />
          </SessionUIProvider>
        </LocationProvider>
      )}
    </Show>
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
          <PromptProvider>
            <CommentsProvider>
              <SessionPage />
            </CommentsProvider>
          </PromptProvider>
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
