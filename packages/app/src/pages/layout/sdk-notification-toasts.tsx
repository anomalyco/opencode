import { createEffect, onCleanup, onMount } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decode64 } from "@/utils/base64"
import { getFilename } from "@opencode-ai/core/util/path"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { usePermission } from "@/context/permission"
import { useLanguage } from "@/context/language"
import { dismissToast, showToast } from "@/utils/toast"
import { playSoundById } from "@/utils/sound"
import { pathKey } from "@/utils/path-key"

/**
 * Mounts the global permission/question notification + sound handler.
 *
 * Renders nothing — purely a side-effect component.  Mount it inside any
 * layout that wants cross-session sounds and toast alerts when:
 *   - the agent needs a permission grant  (`permission.asked`)
 *   - the agent needs an answer           (`question.asked`)
 *
 * The component auto-dismisses toasts when the user navigates to the
 * relevant session, and respects a 5-second cooldown per session so
 * rapid retries don't spam notifications.
 */
export function SDKNotificationToasts() {
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const permission = usePermission()
  const settings = useSettings()
  const platform = usePlatform()
  const language = useLanguage()
  const navigate = useNavigate()
  const params = useParams()

  /** Resolve the currently-visible project directory from the route. */
  const currentDir = () => {
    const slug = params.dir
    if (!slug) return ""
    return decode64(slug) ?? ""
  }

  onMount(() => {
    const toastBySession = new Map<string, number>()
    const alertedAtBySession = new Map<string, number>()
    const cooldownMs = 5000

    const dismissSessionAlert = (sessionKey: string) => {
      const toastId = toastBySession.get(sessionKey)
      if (toastId === undefined) return
      dismissToast(toastId)
      toastBySession.delete(sessionKey)
      alertedAtBySession.delete(sessionKey)
    }

    const unsub = serverSDK().event.listen((e) => {
      if (
        e.details?.type === "question.replied" ||
        e.details?.type === "question.rejected" ||
        e.details?.type === "permission.replied"
      ) {
        const props = e.details.properties as { sessionID: string }
        dismissSessionAlert(`${e.name}:${props.sessionID}`)
        return
      }

      if (e.details?.type !== "permission.asked" && e.details?.type !== "question.asked") return

      const isPermission = e.details.type === "permission.asked"
      const title = isPermission
        ? language.t("notification.permission.title")
        : language.t("notification.question.title")
      const icon = isPermission ? ("checklist" as const) : ("bubble-5" as const)
      const directory = e.name
      const props = e.details.properties

      if (isPermission && permission.autoResponds(e.details.properties, directory)) return

      const [store] = serverSync().child(directory, { bootstrap: false })
      const session = store.session.find((s) => s.id === props.sessionID)
      const sessionKey = `${directory}:${props.sessionID}`
      const sessionTitle = session?.title ?? language.t("command.session.new")
      const projectName = getFilename(directory)
      const description = isPermission
        ? language.t("notification.permission.description", { sessionTitle, projectName })
        : language.t("notification.question.description", { sessionTitle, projectName })
      const href = `/${base64Encode(directory)}/session/${props.sessionID}`

      const now = Date.now()
      const lastAlerted = alertedAtBySession.get(sessionKey) ?? 0
      if (now - lastAlerted < cooldownMs) return
      alertedAtBySession.set(sessionKey, now)

      if (isPermission) {
        if (settings.sounds.permissionsEnabled()) {
          void playSoundById(settings.sounds.permissions())
        }
        if (settings.notifications.permissions()) {
          void platform.notify(title, description, () => navigate(href))
        }
      } else {
        // question.asked: play agent sound + system notification
        if (settings.sounds.agentEnabled()) {
          void playSoundById(settings.sounds.agent())
        }
        if (settings.notifications.agent()) {
          void platform.notify(title, description, () => navigate(href))
        }
      }

      // Skip the in-app toast if the user is already viewing this session.
      const currentSession = params.id
      if (pathKey(directory) === pathKey(currentDir()) && props.sessionID === currentSession) return
      if (pathKey(directory) === pathKey(currentDir()) && session?.parentID === currentSession) return

      dismissSessionAlert(sessionKey)

      const toastId = showToast({
        persistent: true,
        icon,
        title,
        description,
        actions: [
          {
            label: language.t("notification.action.goToSession"),
            onClick: () => navigate(href),
          },
          {
            label: language.t("common.dismiss"),
            onClick: "dismiss",
          },
        ],
      })
      toastBySession.set(sessionKey, toastId)
    })

    onCleanup(unsub)

    // Auto-dismiss toast when the user navigates to the session
    createEffect(() => {
      const currentSession = params.id
      if (!currentDir() || !currentSession) return
      const sessionKey = `${currentDir()}:${currentSession}`
      dismissSessionAlert(sessionKey)
      const [store] = serverSync().child(currentDir(), { bootstrap: false })
      const childSessions = store.session.filter((s) => s.parentID === currentSession)
      for (const child of childSessions) {
        dismissSessionAlert(`${currentDir()}:${child.id}`)
      }
    })
  })

  return null
}
