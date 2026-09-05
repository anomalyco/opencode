const HEDGES = [
  "maybe",
  "perhaps",
  "possibly",
  "might",
  "i think",
  "i'm not sure",
  "i am not sure",
  "not sure",
  "unsure",
  "i believe",
  "i suspect",
  "probably",
  "likely",
  "could be",
  "may be",
  "tends to",
  "seems to",
  "appears to",
  "assuming that",
  "let's assume",
  "lets assume",
  "suppose that",
  "hypothetically",
]

const stripNonProse = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^>.*$/gm, " ")

const HEDGE_PATTERNS = HEDGES.map((phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
  return new RegExp(`\\b${escaped}\\b`, "i")
})

export const containsHedge = (text: string): boolean => {
  const prose = stripNonProse(text)
  return HEDGE_PATTERNS.some((pattern) => pattern.test(prose))
}

