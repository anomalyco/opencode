import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { errorMessage } from "@/pages/layout/helpers"
import { useSessionKey } from "@/pages/session/session-layout"
import { requireServerKey } from "@/utils/session-route"
import { showToast } from "@/utils/toast"
import { createSessionMutation } from "@/utils/session-mutation"

export function useSessionArchive() {
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()
  const server = useServer()
  const serverSync = useServerSync()
  const { params } = useSessionKey()

  const archive = async (sessionID: string) => {
    const session = sync().session.get(sessionID)
    if (!session) return

    await createSessionMutation({ client: sdk().client, serverSync: serverSync() })
      .archive(session)
      .then(() => {
        notifySessionTabsRemoved({
          server: params.serverKey ? requireServerKey(params.serverKey) : server.key,
          directory: sdk().directory,
          sessionIDs: [sessionID],
        })
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
  }

  return { archive }
}
