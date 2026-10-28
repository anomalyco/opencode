import type { SessionMessageUser } from "@opencode/client/promise"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"

import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { clonePrompt, promptLength } from "@/composer/prompt-parts"
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

  const request = async <A>(action: () => Promise<A>) =>
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
    const restored = extractPromptFromMessage(message, {
      directory: location().directory,
      attachmentName: language.t("common.attachment"),
      sessionTitle: (id) => data.session.get(id)?.title,
    })

    const context = extractPromptContext(message, { directory: location().directory })

    target.set(restored, promptLength(restored))
    // The restored prompt replaces the draft, so chips from an earlier restore do not ride along.
    target.context.replace([...context.comments, ...context.files])
  }

  const stage = async (message: SessionMessageUser, previous: SessionMessageUser | undefined) => {
    const sessionID = input.session.identity.params.id

    if (!sessionID) return
    const owner = input.session.ownership.capture()
    const target = prompt.capture()

    // An undelivered prompt has no history to rewind. Withdraw it like the TUI
    // instead of interrupting the work it is waiting behind.
    if (data.session.input.has(sessionID, message.id)) {
      if (!(await request(() => server.api.session.inbox.cancel({ sessionID, inboxID: message.id })))) return
      restore(target, message)
      owner.run(() => input.setActiveMessage(previous))

      return
    }

    // Interrupt acknowledges before the execution settles, and staging a busy Session fails. The
    // local status can lag the server either way, so always settle first; both are idle no-ops.
    // Like the TUI, stop at the first failure instead of waiting on work that was never interrupted.
    if (!(await request(() => server.api.session.interrupt({ sessionID })))) return

    if (!(await request(() => server.api.session.wait({ sessionID })))) return

    // Read before staging: the staged event can land before the request resolves.
    const prior = input.session.data.revertMessageID()

    if (!(await request(() => server.api.session.revert.stage({ sessionID, messageID: message.id })))) return

    const draft = {
      prompt: clonePrompt(target.current()),
      cursor: target.cursor(),
      context: target.context.items().map((item) => ({ ...item })),
    }

    // Like the TUI, pending inputs are left alone: the revert hides them, committing it drops them,
    // and redo delivers them.
    restore(target, message)
    owner.run(() => input.setActiveMessage(previous))

    // Rewinding also puts the files back, so offer the way out right where it happened. Undo is bound to
    // this Session and its earlier revert, not to whatever the route and the event stream show when clicked.
    const undoRewind = async () => {
      const undone = prior
        ? request(() => server.api.session.revert.stage({ sessionID, messageID: prior }))
        : request(() => server.api.session.revert.clear({ sessionID }))

      if (!(await undone)) return
      target.set(draft.prompt, draft.cursor ?? promptLength(draft.prompt))
      target.context.replace(draft.context)
      owner.run(() => {
        const messages = input.session.history.userMessages()
        const boundary = prior ? messages.findIndex((item) => item.id === prior) : -1

        input.setActiveMessage(
          boundary >= 0
            ? messages[boundary - 1]
            : messages.filter((item) => !data.session.input.has(sessionID, item.id)).at(-1),
        )
      })
    }

    showToast({
      title: language.t("session.rewind.toast.title"),
      actions: [{ label: language.t("session.rewind.toast.undo"), onClick: () => void undoRewind() }],
    })
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
    const owner = input.session.ownership.capture()

    // Like the TUI, redo restores every reverted message at once and leaves the composer alone.
    if (!(await request(() => server.api.session.revert.clear({ sessionID })))) return
    owner.run(() =>
      input.setActiveMessage(
        input.session.history
          .userMessages()
          .filter((message) => !data.session.input.has(sessionID, message.id))
          .at(-1),
      ),
    )
  }

  /** Puts a sent prompt back in the composer without rewinding the Session. */
  const recall = (message: SessionMessageUser) => restore(prompt.capture(), message)

  return { to, undo, redo, recall }
}

export type SessionRevert = ReturnType<typeof createSessionRevert>
