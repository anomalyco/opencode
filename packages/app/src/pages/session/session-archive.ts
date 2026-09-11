import { useNavigate } from "@solidjs/router"
import { produce } from "solid-js/store"
import { notifySessionTabsRemoved } from "@/components/titlebar-session-events"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { useTabs } from "@/context/tabs"
import { errorMessage } from "@/pages/layout/helpers"
import { useSessionKey } from "@/pages/session/session-layout"
import { legacySessionHref, requireServerKey, sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"

export function useSessionArchive() {
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const tabs = useTabs()
  const { params } = useSessionKey()

  const navigateAfterRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    const href = (id: string) =>
      params.serverKey ? sessionHref(requireServerKey(params.serverKey), id) : legacySessionHref(sdk().directory, id)
    if (parentID) {
      navigate(href(parentID))
      return
    }
    if (nextSessionID) {
      navigate(href(nextSessionID))
      return
    }
    if (params.serverKey) {
      tabs.newDraft({ server: requireServerKey(params.serverKey), directory: sdk().directory })
      return
    }
    navigate(`/${params.dir}/session`)
  }

  const archive = async (sessionID: string) => {
    const session = sync().session.get(sessionID)
    if (!session) return
    if ((await sdk().protocol) !== "v1") return

    const sessions = sync().data.session ?? []
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk()
      .client.session.update({ sessionID, directory: sdk().directory, time: { archived: Date.now() } })
      .then(() => {
        sync().set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === sessionID)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        sync().session.evict(sessionID)
        serverSync().homeSessions.remove(sessionID)
        navigateAfterRemoval(sessionID, session.parentID, nextSession?.id)
        notifySessionTabsRemoved({ directory: sdk().directory, sessionIDs: [sessionID] })
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
  }

  const unarchive = async (sessionID: string) => {
    if ((await sdk().protocol) !== "v1") return

    // Omitting `archived` clears the timestamp. The request body serializes to
    // {"time":{}}, which the server reads as "clear the archive state".
    await sdk()
      .client.session.update({ sessionID, directory: sdk().directory, time: {} })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err, language.t("common.requestFailed")),
        })
      })
  }

  return { archive, unarchive, navigateAfterRemoval }
}
