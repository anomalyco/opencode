import type { SessionMessageUser } from "@opencode/client/promise"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"

import { extractPromptContext, extractPromptFromMessage, unchangedDraft } from "@/composer/prompt"
import { promptLength } from "@/composer/prompt-parts"
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
  let staging = false

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

  // Recheck the draft after every await: typing during hydration or server work must never be
  // overwritten by a restore.
  const capture = () => {
    const owner = input.session.ownership.capture()
    const target = prompt.capture()
    const unchanged = unchangedDraft(target)

    return { owner, target, current: () => owner.current() && prompt.capture() === target && unchanged() }
  }

  const hydrate = (sessionID: string, message: SessionMessageUser) =>
    server.attachments.hydrate(sessionID, message).catch(() => {
      showToast({ title: language.t("common.requestFailed") })
    })

  const stage = async (message: SessionMessageUser, previous: SessionMessageUser | undefined) => {
    const sessionID = input.session.identity.params.id

    if (!sessionID || staging) return
    const { owner, target, current } = capture()
    const step = async <A>(action: () => Promise<A>) => (await request(action)) && current()
    staging = true

    try {
      const original = await hydrate(sessionID, message)

      if (!original || !current()) return

      // An undelivered prompt has no history to rewind. Withdraw it like the TUI
      // instead of interrupting the work it is waiting behind.
      if (data.session.input.has(sessionID, message.id)) {
        if (!(await step(() => server.api.session.inbox.cancel({ sessionID, inboxID: message.id })))) return
        restore(target, original)
        owner.run(() => input.setActiveMessage(previous))

        return
      }

      // Interrupt acknowledges before execution settles, and staging a busy Session fails.
      if (!(await step(() => server.api.session.interrupt({ sessionID })))) return

      if (!(await step(() => server.api.session.wait({ sessionID })))) return

      if (!(await step(() => server.api.session.revert.stage({ sessionID, messageID: message.id })))) return
      // Pending inputs remain until the revert commits, or redo delivers them.
      restore(target, original)
      owner.run(() => input.setActiveMessage(previous))
    } finally {
      staging = false
    }
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
  const recall = async (message: SessionMessageUser) => {
    const sessionID = input.session.identity.params.id

    if (!sessionID) return
    const { target, current } = capture()
    const original = await hydrate(sessionID, message)

    if (original && current()) restore(target, original)
  }

  return { to, undo, redo, recall }
}

export type SessionRevert = ReturnType<typeof createSessionRevert>
