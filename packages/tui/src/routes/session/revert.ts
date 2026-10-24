import type { PromptInfo } from "../../prompt/history"

type RevertClient = {
  api: {
    session: {
      interrupt(input: { sessionID: string }): Promise<unknown>
      wait(input: { sessionID: string }): Promise<unknown>
      revert: {
        stage(input: { sessionID: string; messageID: string }): Promise<unknown>
      }
    }
  }
}

/**
 * Reverting while a turn is streaming fails with SessionBusyError, so stop and
 * settle the turn first, like /undo does. The prompt is only filled after the
 * server has staged the revert: a failed stage must not leave the old text in
 * the composer where it can be sent again.
 */
export async function revertMessage(input: {
  client: RevertClient
  sessionID: string
  messageID: string
  prompt?: PromptInfo
  setPrompt?: (prompt: PromptInfo) => void
}) {
  await input.client.api.session.interrupt({ sessionID: input.sessionID })
  await input.client.api.session.wait({ sessionID: input.sessionID })
  await input.client.api.session.revert.stage({ sessionID: input.sessionID, messageID: input.messageID })
  if (input.prompt) input.setPrompt?.(input.prompt)
}
