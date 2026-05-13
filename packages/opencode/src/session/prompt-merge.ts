import type { PromptInput } from "./prompt"

type Part = PromptInput["parts"][number]

function fileKey(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === "file:") return `file://${u.host}${u.pathname}`
    return url
  } catch {
    return url
  }
}

/**
 * Merge a slash-command template's resolved parts with client-supplied input
 * parts. Drops later FileParts whose normalized URL has already appeared and
 * later AgentParts whose name has already appeared, so the persisted user
 * message doesn't carry the same file or agent twice. Template-side parts win
 * on collision because the template body produced the reference first.
 *
 * file: URLs are normalized to `file://<host><pathname>`, dropping
 * searchParams, hash, and credentials. This dedups TUI autocomplete's
 * `?start=N&end=M` line-range refs against bare template `@file` refs to the
 * same path.
 */
export function mergeCommandParts(
  templateParts: readonly Part[],
  inputParts: readonly Part[] | undefined = [],
): Part[] {
  const seenFiles = new Set<string>()
  const seenAgents = new Set<string>()
  const out: Part[] = []
  for (const part of [...templateParts, ...inputParts]) {
    if (part.type === "file") {
      const key = fileKey(part.url)
      if (seenFiles.has(key)) continue
      seenFiles.add(key)
    } else if (part.type === "agent") {
      if (seenAgents.has(part.name)) continue
      seenAgents.add(part.name)
    }
    out.push(part)
  }
  return out
}
