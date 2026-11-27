import type { SessionInfo } from "@opencode/client/promise"
import { useQueryClient } from "@tanstack/solid-query"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"

export function createSessionRenamer() {
  const global = useGlobal()

  const language = useLanguage()

  const queryClient = useQueryClient()

  return async (server: ServerConnection.Key, session: SessionInfo, title: string) => {
    const ctx = global.serverCtx(server)

    const conn = global.servers.list().find((item) => ServerConnection.key(item) === server)

    if (!ctx || !conn) throw new Error(language.t("common.requestFailed"))
    await ctx.sdk.api.session.update({ sessionID: session.id, title })
    ctx.data.session.remember({ ...(ctx.data.session.get(session.id) ?? session), title })

    // Like the iOS app, a rename changes the title only. The server advanced time.updated, and the session moves
    // when a list next reloads, so update the cached indexes instead of refetching them now.
    for (const queryKey of ["home-sessions", "inbox-sessions", "inbox-archived-sessions"]) {
      queryClient.setQueryData<SessionInfo[]>([queryKey, conn], (current) =>
        current?.map((item) => (item.id === session.id ? { ...item, title } : item)),
      )
    }
  }
}
