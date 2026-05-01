export type SkillCommandCandidate = {
  name: string
  source?: string
}

export type SkillCommandToken = {
  name: string
  token: string
  start: number
  end: number
}

export function leadingSkillCommandToken(
  input: string,
  commands: Iterable<SkillCommandCandidate>,
): SkillCommandToken | undefined {
  if (!input.startsWith("/")) return

  const match = input.match(/^\/(\S+)/)
  if (!match) return

  const name = match[1]
  if (!name) return

  const matches = Array.from(commands).filter((c) => c.name === name)
  if (matches.length === 0) return
  if (matches.some((c) => c.source !== "skill")) return

  const token = match[0]
  return {
    name,
    token,
    start: 0,
    end: token.length,
  }
}
