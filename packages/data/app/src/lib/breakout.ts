const DAY_MS = 86_400_000
const BREAKOUT_SHARE = 0.1
// New models are at most 30 days old.
const ordinals = (
  "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth " +
  "sixteenth seventeenth eighteenth nineteenth twentieth twenty-first twenty-second twenty-third twenty-fourth " +
  "twenty-fifth twenty-sixth twenty-seventh twenty-eighth twenty-ninth thirtieth"
).split(" ")

type Launch = {
  releaseDate: string
  daily: { date: string; tokens: number; users: number; share: number; rank: number }[]
}

// Every model's last day is the current, partial one, so nothing here reads it.
export function selectBreakout<T extends Launch>(models: T[]) {
  const featured = models
    .flatMap((model) => {
      const days = model.daily.slice(0, -1)
      const peak = days.toSorted((a, b) => b.share - a.share)[0]
      return peak && peak.share >= BREAKOUT_SHARE ? [{ model, days, peak }] : []
    })
    .toSorted((a, b) => b.peak.share - a.peak.share)[0]
  if (!featured) return undefined
  return {
    ...featured,
    peakDay: ordinals[Math.round((Date.parse(featured.peak.date) - Date.parse(featured.model.releaseDate)) / DAY_MS)],
    alsoNew: models.filter((model) => model !== featured.model && (model.daily.at(-2)?.tokens ?? 0) > 0),
  }
}
