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

export const containsHedge = (text: string): boolean => {
  const prose = stripNonProse(text).toLowerCase()
  return HEDGES.some((phrase) => prose.includes(phrase))
}
