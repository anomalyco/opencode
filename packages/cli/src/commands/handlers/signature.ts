export type Entry = {
  readonly sha: string
  readonly code: string
  readonly signer: string
}

/** Human label for a `%G?` signature verification code. */
export function label(code: string) {
  if (code === "G") return "valid signature"
  if (code === "U") return "valid signature, untrusted key"
  if (code === "X") return "valid signature, expired"
  if (code === "Y") return "valid signature, expired key"
  if (code === "B") return "BAD signature"
  if (code === "R") return "valid signature, revoked key"
  if (code === "E") return "signature cannot be checked (missing key?)"
  return "unsigned"
}

/** Whether a `%G?` code should be called out as a problem. */
export function suspect(code: string) {
  return code === "B" || code === "R" || code === "E"
}

/** Parse `git log --format=%h%x00%G?%x00%GS` output into signature entries. */
export function parse(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\x00"))
    .filter((parts) => parts.length >= 2 && /^[0-9a-f]{7,40}$/.test(parts[0]))
    .map((parts) => ({ sha: parts[0], code: parts[1] || "N", signer: parts[2] ?? "" }) satisfies Entry)
}

/** Summarize signature entries into printable lines: one aggregate line plus one line per problem commit. */
export function summary(entries: Entry[]) {
  if (!entries.length) return []
  const good = entries.filter((entry) => ["G", "U", "X", "Y"].includes(entry.code)).length
  const unsigned = entries.filter((entry) => entry.code === "N" || entry.code === "").length
  const bad = entries.filter((entry) => suspect(entry.code))
  const counts = [
    `${good} signed`,
    `${unsigned} unsigned`,
    ...(bad.length ? [`${bad.length} needing attention`] : []),
  ].join(", ")
  return [
    `Signatures: ${counts} of ${entries.length} commits`,
    ...bad.map((entry) => `  ${entry.sha} ${label(entry.code)}${entry.signer ? ` (${entry.signer})` : ""}`),
  ]
}

/** One-line signature status for a single commit. */
export function line(entry: Entry) {
  return `Signature: ${label(entry.code)}${entry.signer ? ` (${entry.signer})` : ""}`
}

export * as Signature from "./signature"
