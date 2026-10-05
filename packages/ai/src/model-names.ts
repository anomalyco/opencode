export * as ModelNames from "./model-names.js"

// Parse API IDs, including gateway prefixes and dot/dash version spellings.
// Hyphenated minor versions are bounded so snapshot dates are not treated as versions.
const GPT =
  /(?:^|[./])(?:(?:openai|databricks|duo-chat|xpersona)-)?(?:chat)?gpt-(\d+)(?:\.(\d+)|-(\d{1,2}))?(?=$|[-:@]|o(?:$|[-:@]))/i
const GPT_COMPACT = /(?:^|[./])openai-gpt-(5[2-6]|61)(?=$|[-:@])/i
const GPT_LEGACY = /(?:^|[./])gpt-35-turbo(?=$|[-:@])/i
const CLAUDE =
  /(?:^|[./])(?:(?:anthropic|databricks|duo-chat)-+)?(?:claude-([a-z]+)|(opus|sonnet|haiku|fable|mythos))-?(\d+)(?:\.(\d+)|-(\d{1,2}))?(?=$|[-:@])/i
const CLAUDE_LEGACY =
  /(?:^|[./])(?:(?:anthropic|databricks)-+)?claude-(\d+)(?:\.(\d+)|-(\d{1,2}))?-([a-z]+)(?=$|[-:@])/i
const ANTHROPIC = /^(?:anthropic[-/]|claude-)/i

export function gptVersion(id: string) {
  // GitLab's compact aliases spell GPT-5.4 as openai-gpt-54, not GPT-54.
  const compact = GPT_COMPACT.exec(id)
  if (compact) return { major: Number(compact[1][0]), minor: Number(compact[1][1]) }
  if (GPT_LEGACY.test(id)) return { major: 3, minor: 5 }
  const match = GPT.exec(id)
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2] ?? match[3] ?? 0) }
}

export function claudeVersion(id: string) {
  const match = CLAUDE.exec(id)
  if (match)
    return {
      family: (match[1] ?? match[2]).toLowerCase(),
      major: Number(match[3]),
      minor: Number(match[4] ?? match[5] ?? 0),
    }
  const legacy = CLAUDE_LEGACY.exec(id)
  if (!legacy) return undefined
  return { family: legacy[4].toLowerCase(), major: Number(legacy[1]), minor: Number(legacy[2] ?? legacy[3] ?? 0) }
}

export const isAnthropic = (id: string) => ANTHROPIC.test(id)
