type RevertClient = {
  api: {
    session: {
      interrupt(input: { sessionID: string }): Promise<unknown>
      revert: {
        stage(input: { sessionID: string; messageID: string }): Promise<unknown>
      }
    }
    experimental: {
      session: {
        wait(input: { sessionID: string }): Promise<unknown>
      }
    }
  }
}

/**
 * Reverting while a turn is streaming fails with SessionBusyError, so stop and
 * settle the turn first, like /undo does.
 */
export async function revertMessage(input: { client: RevertClient; sessionID: string; messageID: string }) {
  await input.client.api.session.interrupt({ sessionID: input.sessionID })
  await input.client.api.experimental.session.wait({ sessionID: input.sessionID })
  await input.client.api.session.revert.stage({ sessionID: input.sessionID, messageID: input.messageID })
}
