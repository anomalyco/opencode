import type { SessionMessageUser } from "@opencode-ai/client/promise"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { extractPromptComments, extractPromptFromMessage } from "@/composer/prompt"
import { showToast } from "@/shell/notifications/toast"
import type { SessionModel } from "./model"

export function createSessionRevert(input: {
  session: SessionModel
  setActiveMessage: (message: SessionMessageUser | undefined) => void
}) {
  const prompt = useComposerState()
  const server = useServerSDK()
  const data = useData()
  const location = useWorkspaceLocation()
  const language = useLanguage()

  const request = async (action: () => Promise<unknown>) =>
    action()
      .then(() => true)
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
        return false
      })
  const restore = (target: ReturnType<typeof prompt.capture>, message: SessionMessageUser) => {
    target.set(
      extractPromptFromMessage(message, {
        directory: location().directory,
      }),
    )
    target.context.replaceComments(
      extractPromptComments(message).map((comment) => ({
        type: "file",
        path: comment.path,
        selection: comment.selection,
        comment: comment.comment,
        preview: comment.preview,
        commentOrigin: comment.origin,
      })),
    )
  }

  const stage = async (message: SessionMessageUser, previous: SessionMessageUser | undefined) => {
    const sessionID = input.session.identity.params.id
    if (!sessionID) return
    const owner = input.session.ownership.capture()
    const target = prompt.capture()
    if (data.session.status(sessionID) === "running") {
      await server.api.session.interrupt({ sessionID }).catch(() => undefined)
    }
    if (!(await request(() => server.api.session.revert.stage({ sessionID, messageID: message.id })))) return
    restore(target, message)
    owner.run(() => input.setActiveMessage(previous))
  }

  const to = async (messageID: string) => {
    const messages = input.session.history.userMessages()
    const index = messages.findIndex((message) => message.id === messageID)
    const message = messages[index]
    if (!message) return
    await stage(message, messages[index - 1])
  }

  const undo = async () => {
    const messages = input.session.history.userMessages()
    const reverted = input.session.data.revertMessageID()
    const boundary = reverted ? messages.findIndex((message) => message.id === reverted) : messages.length
    if (boundary <= 0) return
    const message = messages[boundary - 1]
    if (message) await stage(message, messages[boundary - 2])
  }

  const redo = async () => {
    const sessionID = input.session.identity.params.id
    const reverted = input.session.data.revertMessageID()
    if (!sessionID || !reverted) return
    const messages = input.session.history.userMessages()
    const boundary = messages.findIndex((message) => message.id === reverted)
    if (boundary < 0) return
    const next = messages[boundary + 1]
    if (next) {
      await stage(next, messages[boundary])
      return
    }
    const owner = input.session.ownership.capture()
    const target = prompt.capture()
    if (!(await request(() => server.api.session.revert.clear({ sessionID })))) return
    target.reset()
    target.context.replaceComments([])
    owner.run(() => input.setActiveMessage(messages.at(-1)))
  }

  return { to, undo, redo }
}

export type SessionRevert = ReturnType<typeof createSessionRevert>
