import { SessionMessage } from "@opencode-ai/schema/session-message"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { isDuplicateEntry, type PromptInfo } from "../../prompt/history"

export type PromptRetry = {
  id: SessionMessage.ID
  contextID?: SessionMessage.ID
  prompt: PromptInfo
  agent: string
  providerID: string
  modelID: string
  variant?: string
  delivery: SessionInbox.Delivery
  contextKey?: string
  contextIncluded: boolean
  restored?: boolean
}

const MAX_PROMPT_RETRIES = 10
export const MAX_TOTAL_PROMPT_RETRIES = 20
const MAX_PROMPT_ACKNOWLEDGEMENTS = 100
const retries = new Map<string, PromptRetry[]>()
const claims = new Map<string, Set<SessionMessage.ID>>()
let retryOrder: Array<{ sessionID: string; messageID: SessionMessage.ID }> = []
const acknowledgements = new Map<string, Set<SessionMessage.ID>>()
let acknowledgementOrder: Array<{ sessionID: string; messageID: SessionMessage.ID }> = []

export function rememberPromptRetry(sessionID: string, retry: PromptRetry) {
  if (acknowledgements.get(sessionID)?.has(retry.id)) return false
  const stored = { ...retry, prompt: structuredClone(retry.prompt) }
  const current = retries.get(sessionID) ?? []
  if (current.some((item) => item.id === retry.id)) {
    retries.set(
      sessionID,
      current.map((item) => (item.id === retry.id ? stored : item)),
    )
    releasePromptRetry(sessionID, retry.id)
    return true
  }
  retries.set(sessionID, [...current, stored])
  retryOrder.push({ sessionID, messageID: retry.id })
  while ((retries.get(sessionID)?.length ?? 0) > MAX_PROMPT_RETRIES) {
    const oldest = retries.get(sessionID)?.find((item) => !claims.get(sessionID)?.has(item.id))
    if (!oldest) break
    removePromptRetry(sessionID, oldest.id)
  }
  while (retryOrder.length > MAX_TOTAL_PROMPT_RETRIES) {
    const oldest = retryOrder.find((item) => !claims.get(item.sessionID)?.has(item.messageID))
    if (!oldest) break
    removePromptRetry(oldest.sessionID, oldest.messageID)
  }
  return true
}

export function takePromptRetry(
  sessionID: string,
  input: Omit<PromptRetry, "id" | "contextID" | "contextIncluded" | "restored">,
) {
  const claimed = claims.get(sessionID)
  const retry = retries.get(sessionID)?.find((item) => !claimed?.has(item.id) && matches(item, input))
  if (!retry) return
  const current = claimed ?? new Set<SessionMessage.ID>()
  current.add(retry.id)
  claims.set(sessionID, current)
  retries.set(
    sessionID,
    (retries.get(sessionID) ?? []).map((item) => (item.id === retry.id ? { ...item, restored: false } : item)),
  )
  return { ...retry, restored: false }
}

export function releasePromptRetry(sessionID: string, messageID: SessionMessage.ID) {
  const current = claims.get(sessionID)
  current?.delete(messageID)
  if (current?.size === 0) claims.delete(sessionID)
}

export function markPromptRetryRestored(sessionID: string, messageID: SessionMessage.ID) {
  const current = retries.get(sessionID)
  if (!current?.some((item) => item.id === messageID)) return
  retries.set(
    sessionID,
    current.map((item) => (item.id === messageID ? { ...item, restored: true } : item)),
  )
}

export function restorePromptRetry(sessionID: string, messageID: SessionMessage.ID, restore: () => boolean) {
  const current = retries.get(sessionID)
  if (!current?.some((item) => item.id === messageID) || acknowledgements.get(sessionID)?.has(messageID)) {
    releasePromptRetry(sessionID, messageID)
    return false
  }
  const restored = restore()
  if (restored) markPromptRetryRestored(sessionID, messageID)
  releasePromptRetry(sessionID, messageID)
  return restored
}

export function acknowledgePromptRetry(sessionID: string, messageID: SessionMessage.ID) {
  const retry = removePromptRetry(sessionID, messageID)
  const current = acknowledgements.get(sessionID) ?? new Set<SessionMessage.ID>()
  if (current.has(messageID)) return retry
  current.add(messageID)
  acknowledgements.set(sessionID, current)
  acknowledgementOrder.push({ sessionID, messageID })
  const oldest = acknowledgementOrder.length > MAX_PROMPT_ACKNOWLEDGEMENTS ? acknowledgementOrder.shift() : undefined
  if (!oldest) return retry
  const remaining = acknowledgements.get(oldest.sessionID)
  remaining?.delete(oldest.messageID)
  if (remaining?.size === 0) acknowledgements.delete(oldest.sessionID)
  return retry
}

export function clearPromptRetry(sessionID: string, messageID?: SessionMessage.ID) {
  if (messageID) {
    removePromptRetry(sessionID, messageID)
    return
  }
  retries.delete(sessionID)
  claims.delete(sessionID)
  retryOrder = retryOrder.filter((item) => item.sessionID !== sessionID)
  acknowledgements.delete(sessionID)
  acknowledgementOrder = acknowledgementOrder.filter((item) => item.sessionID !== sessionID)
}

function removePromptRetry(sessionID: string, messageID: SessionMessage.ID) {
  const current = retries.get(sessionID)
  const retry = current?.find((item) => item.id === messageID)
  if (!retry) return
  releasePromptRetry(sessionID, messageID)
  const remaining = current?.filter((item) => item.id !== messageID)
  if (remaining?.length) retries.set(sessionID, remaining)
  if (!remaining?.length) retries.delete(sessionID)
  retryOrder = retryOrder.filter((item) => item.sessionID !== sessionID || item.messageID !== messageID)
  return retry
}

function matches(retry: PromptRetry, input: Omit<PromptRetry, "id" | "contextID" | "contextIncluded" | "restored">) {
  return (
    isDuplicateEntry(retry.prompt, input.prompt) &&
    retry.agent === input.agent &&
    retry.providerID === input.providerID &&
    retry.modelID === input.modelID &&
    (retry.variant ?? "default") === (input.variant ?? "default") &&
    retry.delivery === input.delivery &&
    retry.contextKey === input.contextKey
  )
}
