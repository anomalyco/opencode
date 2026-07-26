export type MarkerInput =
  | { kind: "interrupt"; intent: "steer" | "cancel" | "abort"; origin: "user" | "parent"; reason?: string }
  | { kind: "message"; peer: "parent" | "subagent"; body: string; expectReply?: boolean }
  | { kind: "inbox"; from: string; body?: string }

// The metadata tag carries small attributes only — body/reason are not echoed
// onto the part, so call sites can omit them when calling metadataFor.
export type MarkerMetadataInput =
  | { kind: "interrupt"; intent: "steer" | "cancel" | "abort"; origin: "user" | "parent" }
  | { kind: "message"; peer: "parent" | "subagent"; expectReply?: boolean }
  | { kind: "inbox"; from: string }

export function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
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
  return `✉ Inbox from ${escape(input.from)}${input.body ? `: ${escape(input.body)}` : ""}`
}

// The metadata tag written on the non-synthetic transcript part. The TUI keys
// its render branch off metadata.marker.kind. Carries small attributes only.
export function metadataFor(input: MarkerMetadataInput): { marker: Record<string, unknown> } {
  if (input.kind === "interrupt") return { marker: { kind: "interrupt", intent: input.intent, origin: input.origin } }
  if (input.kind === "message") return { marker: { kind: "message", peer: input.peer, expectReply: input.expectReply } }
  return { marker: { kind: "inbox", from: input.from } }
}

export * as Marker from "./marker"
