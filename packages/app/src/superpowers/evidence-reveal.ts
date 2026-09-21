import { createStore } from "solid-js/store"

export type EvidenceRevealTarget = {
  sessionID: string
  messageID: string
  partID?: string
}

const [pending, setPending] = createStore<Record<string, EvidenceRevealTarget | undefined>>({})

export function requestEvidenceReveal(target: EvidenceRevealTarget) {
  setPending(target.sessionID, target)
}

export function consumeEvidenceReveal(sessionID: string) {
  const target = pending[sessionID]
  if (!target) return
  setPending(sessionID, undefined)
  return target
}

export function revealPendingEvidence(input: {
  sessionID: string | undefined
  ready: boolean
  reveal: (messageID: string, partID?: string) => void
}) {
  if (!input.sessionID || !input.ready) return
  const target = consumeEvidenceReveal(input.sessionID)
  if (!target) return
  input.reveal(target.messageID, target.partID)
  return target
}
