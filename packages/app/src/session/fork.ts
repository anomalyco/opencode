import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode/util/encode"
import { useComposerState } from "@/composer/persistence"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { sessionHref } from "@/shell/routes/session"
import { useWorkspaceLocation } from "@/workspaces/location"

/**
 * Forks a session before one of its prompts: the new session keeps the history above the prompt, opens, and has the
 * prompt back in its composer to edit and send. Resolves to whether the fork opened.
 */
export function useSessionFork() {
  const navigate = useNavigate()
  const data = useData()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const prompt = useComposerState()
  const language = useLanguage()
  const server = useServer()

  return async (input: { sessionID: string; messageID: string }) => {
    const message = data.session.message.get(input.sessionID, input.messageID)

    if (message?.type !== "user") return false

    const restored = extractPromptFromMessage(message, {
      directory: location().directory,
      attachmentName: language.t("common.attachment"),
      sessionTitle: (id) => data.session.get(id)?.title,
    })

    const context = extractPromptContext(message, { directory: location().directory })
    const dir = base64Encode(location().directory)

    return serverSDK.api.session
      .fork({ sessionID: input.sessionID, before: input.messageID })
      .then((forked) => {
        data.session.remember(forked)
        const target = prompt.capture({ dir, id: forked.id })
        target.set(restored)
        target.context.replace([...context.comments, ...context.files])
        navigate(sessionHref(server.key, forked.id))

        return true
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause)
        showToast({ title: language.t("common.requestFailed"), description: message })

        return false
      })
  }
}
