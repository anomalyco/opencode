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
    ctx.data.session.invalidate(session.id)
    void ctx.data.session.sync(session.id).catch(() => undefined)
    void queryClient.invalidateQueries({ queryKey: ["home-sessions", conn], exact: true })
    void queryClient.invalidateQueries({ queryKey: ["inbox-sessions", conn], exact: true })
    void queryClient.invalidateQueries({ queryKey: ["inbox-archived-sessions", conn], exact: true })
  }
}
