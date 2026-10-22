import type { MarkdownToken } from "./markdown-worker-protocol"

export type HighlightedCodeState = {
  requestedLanguage: string
  language: string
  source: string
  complete: boolean
  generation: number
  stable: MarkdownToken[]
  unstable: MarkdownToken[]
}

export type RenderedCodeState = {
  language: string
  generation: number
  stableCount: number
  stable?: MarkdownToken[]
  unstable: MarkdownToken[]
  raw: string
}

export function shouldResetCodeTokens(
  previous: RenderedCodeState | undefined,
  next: { language: string; generation: number; stableCount: number; raw: string },
) {
  return (
    !previous ||
    previous.language !== next.language ||
    previous.generation !== next.generation ||
    next.stableCount < previous.stableCount ||
    !next.raw.startsWith(previous.raw)
  )
}

export function projectHighlightedCode(
  previous: HighlightedCodeState | undefined,
  source: string,
  language: string | undefined,
) {
  const requestedLanguage = language ?? "text"
  if (previous && previous.requestedLanguage === requestedLanguage && source.startsWith(previous.source)) {
    const suffix = source.slice(previous.source.length)
    return {
      language: previous.language,
      generation: previous.generation,
      stable: previous.stable,
      unstable: suffix ? [...previous.unstable, [suffix, ""] satisfies MarkdownToken] : previous.unstable,
    }
  }
  return {
    language: requestedLanguage,
    generation: -1,
    stable: [] as MarkdownToken[],
    unstable: source ? ([[source, ""]] satisfies MarkdownToken[]) : ([] as MarkdownToken[]),
  }
}

export function diffCodeTokens(
  previous: RenderedCodeState | undefined,
  next: {
    language: string
    generation: number
    stable: MarkdownToken[]
    unstable: MarkdownToken[]
    raw: string
  },
) {
  const reset = shouldResetCodeTokens(previous, {
    language: next.language,
    generation: next.generation,
    stableCount: next.stable.length,
    raw: next.raw,
  })
  if (!reset && previous) {
    const tail = [...next.stable.slice(previous.stableCount), ...next.unstable]
    const prefix = previous.unstable.findIndex((token, index) => !sameToken(token, tail[index]))
    const matched = prefix < 0 ? Math.min(previous.unstable.length, tail.length) : prefix
    return {
      keep: previous.stableCount + matched,
      append: tail.slice(matched),
    }
  }
  const all = [...next.stable, ...next.unstable]
  if (!previous || previous.language !== next.language || !previous.stable) {
    return {
      keep: 0,
      append: all,
    }
  }
  const prior = [...previous.stable, ...previous.unstable]
  const prefix = prior.findIndex((token, index) => !sameToken(token, all[index]))
  const keep = prefix < 0 ? Math.min(prior.length, all.length) : prefix
  return {
    keep,
    append: all.slice(keep),
  }
}

function sameToken(left: MarkdownToken, right: MarkdownToken | undefined) {
  return !!right && left[0] === right[0] && left[1] === right[1]
}
