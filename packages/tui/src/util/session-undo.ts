import { stripPromptPartIDs } from "../prompt/part"

export type UndoMessage = {
  id: string
  role: string
}

export type UndoPart = {
  id: string
  messageID: string
  sessionID: string
  type: string
  text?: string
  synthetic?: boolean
}

export type UndoPrompt = {
  input: string
  parts: ReturnType<typeof stripPromptPartIDs<UndoPart>>[]
}

/** Next user message to undo: last user message before the current revert cursor. */
export function findUndoUserMessage<T extends UndoMessage>(
  messages: readonly T[],
  revertMessageID: string | undefined,
): T | undefined {
  return messages.findLast((message) => (!revertMessageID || message.id < revertMessageID) && message.role === "user")
}

/** Next user message to redo into: first user message after the current revert cursor. */
export function findRedoUserMessage<T extends UndoMessage>(
  messages: readonly T[],
  revertMessageID: string,
): T | undefined {
  return messages.find((message) => message.role === "user" && message.id > revertMessageID)
}

/** Rebuild prompt input from a user message's parts (skips synthetic text). */
export function promptFromMessageParts(parts: readonly UndoPart[]): UndoPrompt {
  return parts.reduce(
    (agg, part) => {
      if (part.type === "text") {
        if (!part.synthetic && part.text) agg.input += part.text
        return agg
      }
      if (part.type === "file") agg.parts.push(stripPromptPartIDs(part))
      return agg
    },
    { input: "", parts: [] as UndoPrompt["parts"] },
  )
}

/** Serialize async tasks so rapid /undo calls cannot race on stale state. */
export function createSequentialQueue() {
  let chain: Promise<void> = Promise.resolve()
  return {
    enqueue(task: () => Promise<void>) {
      const run = chain.then(task, task)
      chain = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
  }
}

export async function waitUntil(
  predicate: () => boolean,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<boolean> {
  const timeoutMs = options?.timeoutMs ?? 5_000
  const intervalMs = options?.intervalMs ?? 50
  if (predicate()) return true
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))
    if (predicate()) return true
  }
  return predicate()
}
