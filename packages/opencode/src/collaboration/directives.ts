import type { Collaboration } from "./types"

export namespace CollaborationDirectives {
  /**
   * Regex to match ~directives in text
   * Matches: ~alice, ~all, ~bob123
   */
  const DIRECTIVE_REGEX = /~(\w+)/g

  /**
   * Parse directives from message text
   * @param text - The message text to parse
   * @param participants - Map of participant ID to participant info
   * @returns Array of parsed directives
   */
  export function parse(
    text: string,
    participants: Record<string, Collaboration.Participant>,
  ): Collaboration.Directive[] {
    const directives: Collaboration.Directive[] = []
    const matches = text.matchAll(DIRECTIVE_REGEX)
    const participantNames = Object.values(participants).map((p) => p.name.toLowerCase())

    for (const match of matches) {
      const target = match[1].toLowerCase()

      if (target === "all") {
        // ~all waits for everyone
        directives.push({
          type: "wait",
          target: "all",
          resolved: false,
        })
      } else if (participantNames.includes(target)) {
        // ~alice waits for alice to respond
        directives.push({
          type: "wait",
          target,
          resolved: false,
        })
      } else {
        // Unknown target - treat as mention (no wait)
        directives.push({
          type: "mention",
          target,
          resolved: true,
        })
      }
    }

    return directives
  }

  /**
   * Check if a message has any unresolved wait directives
   */
  export function hasUnresolvedWaits(directives: Collaboration.Directive[]): boolean {
    return directives.some((d) => d.type === "wait" && !d.resolved)
  }

  /**
   * Strip directives from text for clean display
   */
  export function stripDirectives(text: string): string {
    return text.replace(DIRECTIVE_REGEX, "").trim().replace(/\s+/g, " ")
  }

  /**
   * Extract all targets from directives
   */
  export function extractTargets(text: string): string[] {
    const matches = text.matchAll(DIRECTIVE_REGEX)
    return Array.from(matches).map((m) => m[1].toLowerCase())
  }

  /**
   * Check if text contains any directives
   */
  export function hasDirectives(text: string): boolean {
    return DIRECTIVE_REGEX.test(text)
  }
}
