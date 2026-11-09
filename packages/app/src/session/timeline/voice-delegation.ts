import { Option, Schema } from "effect"

// Voice calls send each request as plain prompt text: a header line, then a JSON body. Nothing else marks the
// message, so this mirrors the iOS app's `VoiceHandoff.parse`. The header's wording has changed between
// releases; its opening and the body's shape have not.
const decodeBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      instruction: Schema.String,
      transcript_delta: Schema.optional(Schema.Array(Schema.String)),
      voice: Schema.optional(Schema.String),
    }),
  ),
)

/** The user's spoken request and the voice agent's framing of it, or undefined for any other prompt. */
export function parseVoiceDelegation(text: string) {
  if (!text.startsWith("Voice delegation.") && !text.startsWith("Voice delegation (continued).")) return

  const newline = text.indexOf("\n")

  if (newline === -1) return

  // Without presentation metadata, path attachments such as the call log follow the body as reference lines.
  const body = Option.getOrUndefined(
    decodeBody(text.slice(newline + 1).replace(/(\s*\nAttached file: `[^\n]*`)+\s*$/, "")),
  )

  const instruction = body?.instruction.trim()

  if (!instruction) return

  // Desktop's first voice calls wrote a bare header and put the user's raw transcript in `voice`, not a framing.
  if (text.slice(0, newline) === "Voice delegation." && !body?.transcript_delta)
    return { instruction, framing: undefined }

  return { instruction, framing: body?.voice?.trim() || undefined }
}
