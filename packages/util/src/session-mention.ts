export type SessionMention = { id: `ses_${string}` }

// Match complete generated IDs only, including while an assistant is streaming one.
const pattern = /(?<![\w/:@-])(?:@session:)?(ses_[A-Za-z0-9]{26})(?![\w/-])/g

export function sessionMentions(text: string) {
  return Array.from(text.matchAll(pattern), (match) => ({
    // SAFETY: the capture above requires the session prefix and a complete generated suffix.
    id: match[1] as SessionMention["id"],
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }))
}

export function parseSessionMention(text: string): SessionMention | undefined {
  const match = sessionMentions(text)[0]

  return match?.text === text ? { id: match.id } : undefined
}

export function serializeSessionMention(mention: SessionMention) {
  return `@session:${mention.id}`
}
