function lines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function hasHeading(text: string, test: RegExp) {
  return lines(text).some((line) => /^#{1,6}\s+/.test(line) && test.test(line.toLowerCase()))
}

export function hasConfirmation(text: string) {
  return hasHeading(text, /confirmed understanding|my understanding|confirmation|理解确认|确认/)
}

export function missingFields(text: string) {
  const result = [] as string[]
  const list = lines(text)
  const titled = list.some((line) => line.startsWith("# "))
  if (!titled && !hasHeading(text, /objective|goal|目标/)) result.push("objective")
  if (!hasHeading(text, /scope|范围|in[\s-]?scope/)) result.push("scope")
  if (!hasHeading(text, /constraints|限制|约束/)) result.push("constraints")
  if (!hasHeading(text, /acceptance|success criteria|验收/)) result.push("acceptance_criteria")
  if (!hasHeading(text, /steps|implementation|执行步骤/)) result.push("steps")
  return result
}

export function nextQuestionCount(input: { missing: number; hasPlan: boolean }) {
  if (!input.hasPlan) return 2
  if (input.missing >= 3) return 3
  if (input.missing >= 2) return 2
  return 1
}

export function canFinalize(text: string) {
  const missing = missingFields(text)
  const confirmed = hasConfirmation(text)
  return {
    ok: missing.length === 0 && confirmed,
    missing,
    confirmed,
  }
}
