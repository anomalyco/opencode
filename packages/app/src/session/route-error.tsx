import { Button } from "@opencode-ai/ui/button"
import { createMemo, Show } from "solid-js"
import { ErrorPage } from "@/shell/errors/error"
import { useLanguage } from "@/runtime/i18n/language"
import { useServer } from "@/runtime/server/current"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { isLocalSessionNotFoundError, isSessionNotFoundError } from "@/runtime/server/errors"
import { IncompatibleServerPanel } from "./incompatible-server-panel"

export function SessionErrorFallback(props: { error: unknown; sessionID?: string; serverKey?: ServerConnection.Key }) {
  const language = useLanguage()
  const activeServer = useServer()
  const server = useServers()
  const tabs = useTabs()
  const displayServer = createMemo(() => {
    const conn = server.list.find((item) => ServerConnection.key(item) === props.serverKey)
    return conn ? serverName(conn) : props.serverKey
  })
  const closeSession = () => {
    if (!props.sessionID) return
    tabs.removeSessionTab({ server: activeServer.key, sessionId: props.sessionID })
  }

  return (
    <Show
      when={!activeServer.health?.incompatible}
      fallback={<IncompatibleServerPanel onClose={props.sessionID ? closeSession : undefined} />}
    >
      <Show
        when={isCurrentSessionNotFoundError(props.error, props.sessionID)}
        fallback={<ErrorPage error={props.error} />}
      >
        <div class="flex-1 min-h-0 overflow-hidden">
          <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
            <div class="flex flex-col items-center gap-2">
              <div class="text-16-medium text-text max-w-md">{language.t("session.error.notFound")}</div>
              <div class="text-13-regular text-text-weak max-w-md">
                {language.t("session.error.notFound.description")}
              </div>
            </div>
            <Show when={props.sessionID}>
              {(sessionID) => (
                <div class="max-w-full flex flex-col items-center gap-1">
                  <div class="max-w-full text-11-regular text-text-faint break-all">{displayServer()}</div>
                  <code class="max-w-full rounded-[4px] px-1 py-0.5 font-mono text-xs font-medium leading-4 text-text-base break-all bg-[color-mix(in_oklch,var(--v2-text-text-base)_8%,transparent)]">
                    {sessionID()}
                  </code>
                </div>
              )}
            </Show>
            <Button
              variant="neutral"
              size="normal"
              icon="xmark-small"
              onClick={() => {
                if (!props.sessionID || !props.serverKey) return
                tabs.removeSessionTab({ server: props.serverKey, sessionId: props.sessionID })
              }}
            >
              {language.t("session.error.notFound.closeTab")}
            </Button>
          </div>
        </div>
      </Show>
    </Show>
  )
}

function isCurrentSessionNotFoundError(error: unknown, sessionID: string | undefined) {
  if (!sessionID) return false
  return isSessionNotFoundError(error, sessionID) || isLocalSessionNotFoundError(error, sessionID)
}
