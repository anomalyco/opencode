import { Button } from "@opencode-ai/ui/button"
import { createMemo, Show } from "solid-js"
import { ErrorPage } from "@/pages/error"
import { useLanguage } from "@/context/language"
import { ServerConnection, serverName, useServers } from "@/context/servers"
import { useTabs } from "@/context/tabs"
import { isLocalSessionNotFoundError, isSessionNotFoundError } from "@/utils/server-errors"

export function SessionErrorFallback(props: { error: unknown; sessionID?: string; serverKey?: ServerConnection.Key }) {
  const language = useLanguage()
  const server = useServers()
  const tabs = useTabs()
  const displayServer = createMemo(() => {
    const conn = server.list.find((item) => ServerConnection.key(item) === props.serverKey)
    return conn ? serverName(conn) : props.serverKey
  })

  if (!isCurrentSessionNotFoundError(props.error, props.sessionID)) return <ErrorPage error={props.error} />

  return (
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="h-full px-6 pb-42 -mt-4 flex flex-col items-center justify-center text-center gap-4">
        <div class="flex flex-col items-center gap-2">
          <div class="text-16-medium text-text max-w-md">{language.t("session.error.notFound")}</div>
          <div class="text-13-regular text-text-weak max-w-md">{language.t("session.error.notFound.description")}</div>
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
  )
}

function isCurrentSessionNotFoundError(error: unknown, sessionID: string | undefined) {
  if (!sessionID) return false
  return isSessionNotFoundError(error, sessionID) || isLocalSessionNotFoundError(error, sessionID)
}
