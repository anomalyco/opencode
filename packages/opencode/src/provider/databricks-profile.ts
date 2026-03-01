export function parseDatabricksProfiles(input: string) {
  const profiles = input
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = line.match(/^\[([^\]]+)\]$/)
      if (!match) return []
      const name = match[1]?.trim()
      if (!name) return []
      return [name]
    })

  return [...new Set(profiles)].toSorted((a, b) => {
    if (a === "DEFAULT" && b !== "DEFAULT") return -1
    if (b === "DEFAULT" && a !== "DEFAULT") return 1
    return a.localeCompare(b)
  })
}

export function pickDatabricksProfileFlow(input: { profiles: string[] }) {
  if (input.profiles.length === 0) return {}
  return { promptProfiles: input.profiles }
}
