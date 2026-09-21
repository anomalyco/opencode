export type EvidenceRevealTarget = {
  sessionID: string
  messageID: string
  partID?: string
}

const pending = new Map<string, EvidenceRevealTarget>()

export function requestEvidenceReveal(target: EvidenceRevealTarget) {
  pending.set(target.sessionID, target)
}

export function consumeEvidenceReveal(sessionID: string) {
  const target = pending.get(sessionID)
  if (!target) return
  pending.delete(sessionID)
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
