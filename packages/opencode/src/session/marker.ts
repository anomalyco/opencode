export type MarkerInput =
  | { kind: "interrupt"; intent: "steer" | "cancel" | "abort"; origin: "user" | "parent"; reason?: string }
  | { kind: "message"; peer: "parent" | "subagent"; body: string; expectReply?: boolean }
  // `from` is the human-readable sender label (session name for s2s, slug for
  // coordinator-messaging). `sessionId`, when present (s2s), is the addressable
  // peer session id — shown so the recipient knows who to message back.
  | { kind: "inbox"; from: string; sessionId?: string; body?: string }

// The metadata tag carries small attributes only — body/reason are not echoed
// onto the part, so call sites can omit them when calling metadataFor.
export type MarkerMetadataInput =
  | { kind: "interrupt"; intent: "steer" | "cancel" | "abort"; origin: "user" | "parent" }
  | { kind: "message"; peer: "parent" | "subagent"; expectReply?: boolean }
  | { kind: "inbox"; from: string; sessionId?: string }

export function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// For double-quoted XML/HTML attribute *values*. Escapes the quote
// characters on top of escape()'s &/</> so an untrusted value (e.g. a
// peer's session title) cannot close the attribute and inject sibling
// attributes or break out of the tag. Use this for anything interpolated
// inside name="..." / session="..."; keep escape() for element *content*
// (between tags) and the visible ✉/⊘ markers (where &quot; would render
// literally and there is no attribute to break out of).
export function escapeAttr(text: string) {
  return escape(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

export function render(input: MarkerInput): string {
  if (input.kind === "interrupt") {
    const verb = input.intent === "cancel" ? "Cancelled" : input.intent === "abort" ? "Aborted" : "Steered"
    return `⊘ ${verb} by ${input.origin}${input.reason ? `: ${escape(input.reason)}` : ""}`
  }
  if (input.kind === "message") {
    const verb =
      input.peer === "subagent"
        ? input.expectReply
          ? "Message from subagent (awaiting your reply)"
          : "Message from subagent"
        : "Reply from parent"
    return `✉ ${verb}: ${escape(input.body)}`
  }
  return `✉ Inbox from ${escape(input.from)}${input.sessionId ? ` (${escape(input.sessionId)})` : ""}${input.body ? `: ${escape(input.body)}` : ""}`
}

// The metadata tag written on the non-synthetic transcript part. The TUI keys
// its render branch off metadata.marker.kind. Carries small attributes only.
export function metadataFor(input: MarkerMetadataInput): { marker: Record<string, unknown> } {
  if (input.kind === "interrupt") return { marker: { kind: "interrupt", intent: input.intent, origin: input.origin } }
  if (input.kind === "message") return { marker: { kind: "message", peer: input.peer, expectReply: input.expectReply } }
  return { marker: { kind: "inbox", from: input.from, ...(input.sessionId ? { sessionId: input.sessionId } : {}) } }
}

export * as Marker from "./marker"
