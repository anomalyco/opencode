import { ErrorBoundary, createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { useParams } from "@solidjs/router"
import { DataProvider } from "@opencode-ai/session-ui/context"
import { SessionUserMessage } from "@opencode-ai/session-ui/message"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { CommentsProvider } from "@/composer/comments"
import { readPromptPresentation } from "@/composer/comment-note"
import { FileProvider } from "@/workspaces/files/model"
import { LocationProvider } from "@/workspaces/location"
import { ModelsProvider } from "@/providers/models/models"
import { useProviders } from "@/providers/catalog/providers"
import { useLanguage } from "@/runtime/i18n/language"
import { useNotification } from "@/shell/notifications/notification"
import { ComposerPersistenceProvider } from "@/composer/persistence"
import { useData, useServer } from "@/runtime/server/current"
import { ServerConnection } from "@/runtime/server/registry"
import { TerminalProvider } from "@/session/terminal/context"
import { useSettingsCommand } from "@/settings/command"
import { SessionUIProvider } from "@/shell/routes/session-ui-provider"
import { useTabs, type PendingSession } from "@/shell/tabs/tabs"
import { requireServerKey } from "@/shell/routes/session"
import { useSessionModel } from "./model"
import { SessionPanelFrame } from "./session-frame"
import { SessionIdentityHeader } from "./session-identity-header"
import { IncompatibleServerPanel } from "./incompatible-server-panel"
import { SessionErrorFallback } from "./route-error"
import { createSessionResolution } from "./session-resolution"
import { SessionScreen } from "./screen"
import { PreparingComposer } from "./preparing-composer"

export function TargetSessionRouteContent() {
  const params = useParams<{ serverKey: string; id: string }>()
  const data = useData()
  const server = useServer()
  const tabs = useTabs()
  const directory = createMemo(() => data.session.get(params.id)?.location.directory)

  return (
    <>
      <MarkSessionNotificationsViewed sessionID={() => params.id} />
      <ModelsProvider directory={directory}>
        <TargetSessionSettingsCommand />
        <SessionRouteErrorBoundary sessionID={params.id} serverKey={requireServerKey(params.serverKey)}>
          <Show when={tabs.pendingSession(server.key, params.id)} fallback={<ResolvedTargetSessionRoute />}>
            {(pending) => <PreparingSession sessionID={params.id} pending={pending()} />}
          </Show>
        </SessionRouteErrorBoundary>
      </ModelsProvider>
    </>
  )
}

function PreparingSession(props: { sessionID: string; pending: PendingSession }) {
  const language = useLanguage()
  const providers = useProviders(() => props.pending.draft.directory)
  return (
    <SessionStatePanel>
      <DataProvider
        directory={props.pending.draft.directory}
        data={{
          session: [],
          session_status: {},
          session_diff: {},
          provider: { all: providers.all(), default: providers.default(), connected: [] },
        }}
      >
        <div data-component="session-preparing" data-workspace-session class="min-h-0 flex-1 overflow-y-auto">
          <SessionIdentityHeader sessionID={props.sessionID} />
          <div class="mx-auto w-full min-w-0 max-w-[1000px] px-4 pb-5 md:px-5">
            <SessionUserMessage
              sessionID={props.sessionID}
              message={props.pending.message}
              comments={readPromptPresentation(props.pending.message.metadata)?.comments}
              historicalAgent={props.pending.selection.agent}
              historicalModel={{
                id: props.pending.selection.model.modelID,
                providerID: props.pending.selection.model.providerID,
                variant: props.pending.selection.variant,
              }}
            />
            <div
              role="status"
              class="mt-3 flex min-h-6 items-center text-[13px] font-medium leading-[var(--line-height-compact)] text-v2-text-text-muted"
            >
              <TextShimmer text={language.t("session.new.worktree.creating")} active />
            </div>
          </div>
        </div>
        <PreparingComposer pending={props.pending} />
      </DataProvider>
    </SessionStatePanel>
  )
}

function TargetSessionSettingsCommand() {
  useSettingsCommand()
  return null
}

function SessionRouteErrorBoundary(props: ParentProps<{ sessionID?: string; serverKey?: ServerConnection.Key }>) {
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
    { children: true, connected: () => server.ctx.sdk.connection.status() === "connected" },
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
      <Show when={directory()} fallback={<PendingSessionState sessionID={params.id} />}>
        {(value) => (
          <LocationProvider directory={value} workspaceID={() => current()?.location.workspaceID}>
            <SessionUIProvider directory={value()} server={server.key}>
              <TargetSessionPage />
            </SessionUIProvider>
          </LocationProvider>
        )}
      </Show>
    </Show>
  )
}

function PendingSessionState(props: { sessionID: string }) {
  return (
    <SessionStatePanel>
      <SessionIdentityHeader sessionID={props.sessionID} />
    </SessionStatePanel>
  )
}

function SessionStatePanel(props: ParentProps) {
  return (
    <div class="flex min-h-0 flex-1 px-2 pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
      <SessionPanelFrame raised>{props.children}</SessionPanelFrame>
    </div>
  )
}

function TargetSessionPage() {
  return (
    // These providers select their scoped state reactively and retain bounded caches,
    // so keep their owners alive while navigating between workspaces on this server.
    <TerminalProvider>
      <FileProvider>
        <ComposerPersistenceProvider>
          <CommentsProvider>
            <SessionPage />
          </CommentsProvider>
        </ComposerPersistenceProvider>
      </FileProvider>
    </TerminalProvider>
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
