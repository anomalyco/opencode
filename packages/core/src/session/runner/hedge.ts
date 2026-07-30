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
]

export const containsHedge = (text: string): boolean => {
  const lower = text.toLowerCase()
  for (const phrase of HEDGES) if (lower.includes(phrase)) return true
  return false
}
