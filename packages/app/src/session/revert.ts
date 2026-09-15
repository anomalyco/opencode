import type { SessionMessageUser } from "@opencode/client/promise"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"
import { extractPromptComments, extractPromptFromMessage } from "@/composer/prompt"
import { showToast } from "@/shell/notifications/toast"
import type { SessionModel } from "./model"
import { loadRevertBoundary, loadUndoTarget } from "./session-domain"

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

  const stage = async (sessionID: string, message: SessionMessageUser, previous: SessionMessageUser | undefined) => {
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
    const sessionID = input.session.identity.params.id
    if (!sessionID) return
    const messages = input.session.history.userMessages()
    const index = messages.findIndex((message) => message.id === messageID)
    const message = messages[index]
    if (!message) return
    await data.session.mutate(sessionID, () => stage(sessionID, message, messages[index - 1]))
  }

  const undo = async () => {
    const sessionID = input.session.identity.params.id
    if (!sessionID) return
    await data.session.mutate(sessionID, async () => {
      const reverted = input.session.data.revertMessageID()
      const messages = input.session.history.userMessages()
      if (!reverted) {
        const message = messages.at(-1)
        if (message) await stage(sessionID, message, messages.at(-2))
        return
      }
      const target = await loadUndoTarget({
        messageID: reverted,
        messages: input.session.history.userMessages,
        more: () => data.session.message.more(sessionID),
        loadMore: () => data.session.message.loadMore(sessionID),
      }).catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
        return undefined
      })
      if (target) await stage(sessionID, target.message, target.previous)
    })
  }

  const redo = async () => {
    const sessionID = input.session.identity.params.id
    const reverted = input.session.data.revertMessageID()
    if (!sessionID || !reverted) return
    await data.session.mutate(sessionID, async () => {
      const messages = await loadRevertBoundary({
        messageID: reverted,
        messages: input.session.history.userMessages,
        more: () => data.session.message.more(sessionID),
        loadMore: () => data.session.message.loadMore(sessionID),
      }).catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        })
        return undefined
      })
      if (!messages) return
      const boundary = messages.findIndex((message) => message.id === reverted)
      const next = messages[boundary + 1]
      if (next) {
        await stage(sessionID, next, messages[boundary])
        return
      }
      const owner = input.session.ownership.capture()
      const target = prompt.capture()
      if (!(await request(() => server.api.session.revert.clear({ sessionID })))) return
      target.reset()
      target.context.replaceComments([])
      owner.run(() => input.setActiveMessage(messages.at(-1)))
    })
  }

  return { to, undo, redo }
}

export type SessionRevert = ReturnType<typeof createSessionRevert>
