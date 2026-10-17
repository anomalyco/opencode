import type { SessionMessageInfo } from "@opencode/client/promise"

export interface InstructionUpdate {
  readonly description: string | undefined
  readonly text: string
}

/**
 * The only `system` messages a session stores are the instruction updates it announces mid-turn
 * (`packages/core/src/session/message-updater.ts`): the prompt they update is assembled per request
 * in `packages/core/src/session/model-request.ts` and is never stored, so the last of them is not it.
 */
export const instructionUpdates = (messages: readonly SessionMessageInfo[]): readonly InstructionUpdate[] =>
  messages.flatMap((message) => {
    if (message.type !== "system") return []

    const text = message.text.trim()

    if (!text) return []

    return [{ description: message.description, text }]
  })
