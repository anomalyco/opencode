// Mirrors the OpenCode iOS app's `VoiceHandoff` (VoiceTranscript.swift) so sessions read voice
// delegations from either client the same way. parseVoiceDelegation reads them back.
export const header =
  "Voice delegation. The user is on a voice call with a voice agent, which hands their requests to you. Instruction is the user's own spoken words since the previous delegation, transcribed from speech, so it may contain recognition errors and disfluencies: resolve meaning from the complete utterance, not a disfluent prefix. Voice, when present, is how the voice agent framed the request. Transcript delta is the surrounding voice conversation, both sides, for context, not additional commands. Lead your reply with one or two plain sentences suitable for reading aloud, then any detail; answer only what was asked, with no unrequested tips. If this arrives while you are already working (a follow-up, nudge, or status check), answer it promptly: a clear status update, the finished result if you have enough, or the precise blocker or input you need; then continue on the fastest safe path."

export const continuedHeader = "Voice delegation (continued). Same fields as before."

/** A session that goes this long without a delegation gets the full header again. */
export const headerLapse = 30 * 60 * 1000

export function formatHandoff(input: { instruction: string; transcript: string[]; context?: string; full: boolean }) {
  // Keys in sorted order, as the iOS encoder writes them; JSON drops an undefined context.
  const body = {
    context: input.context?.trim() || undefined,
    instruction: input.instruction,
    transcript_delta: input.transcript,
  }

  return `${input.full ? header : continuedHeader}\n${JSON.stringify(body, null, 2)}`
}
