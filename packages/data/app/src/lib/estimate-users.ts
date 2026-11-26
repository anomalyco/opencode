const DAY_MS = 86_400_000
// The daily and weekly counts fit any churn equally well, so it is fixed: a regular is still around the next day
// with this chance. Lower values give a higher estimate.
const STAY = 0.95

type Day = { date: string; users: number }
type Week = { week: string; users: number }

// Estimates a new model's distinct users since launch from distinct users per day and per ISO week, which can't be
// added up without counting returning users again. Each adopter is active on the day they first use the model; a share
// of them are regulars who come back on a later day with some chance, the rest never return. The two are fitted so
// the days reproduce every week's count, and the estimate is the adopters from launch on. The last day may be partial.
export function estimateUsersSinceLaunch(input: { daily: Day[]; weekly: Week[]; firstSeen: string; launch: string }) {
  const weeks = input.weekly.filter((week) => isoAfter(week.week, 6) >= input.launch)
  const fallback = weeks.reduce((sum, week) => sum + week.users, 0)
  const floor = Math.max(0, ...weeks.map((week) => week.users))
  const days = input.daily
  const first = days[0]?.date
  if (!first) return fallback
  // A week's count only lines up with the days when the days cover all of its earlier usage.
  const targets = input.weekly.flatMap((week) => {
    if (week.users <= 0 || (week.week < first && first !== input.firstSeen) || isoAfter(week.week, 6) < first) return []
    const start = Math.max(
      0,
      days.findIndex((day) => day.date >= week.week),
    )
    const end = days.findLastIndex((day) => day.date <= isoAfter(week.week, 6))
    return end < start ? [] : [{ start, end, users: week.users }]
  })
  if (targets.length === 0) return fallback
  const activity = days.map((day, index) =>
    index === days.length - 1 && index > 0 && days[index - 1]!.users > 0
      ? Math.min(1, day.users / days[index - 1]!.users)
      : 1,
  )
  const fit = search(days, activity, targets)
  if (!fit) return fallback
  const total = fit.adopters.reduce((sum, value, index) => (days[index]!.date >= input.launch ? sum + value : sum), 0)
  return Math.round(Math.min(Math.max(total, floor), fallback))
}

function search(days: Day[], activity: number[], targets: { start: number; end: number; users: number }[]) {
  const grid = (center: number | undefined, step: number) =>
    Array.from({ length: center === undefined ? 20 : 11 }, (_, index) =>
      center === undefined ? (index + 1) * step : center + (index - 5) * step,
    ).filter((value) => value > 0 && value <= 1)
  const best = (regulars: number[], chances: number[]) =>
    regulars
      .flatMap((regular) => chances.map((chance) => simulate(days, activity, targets, regular, chance)))
      .reduce<
        ReturnType<typeof simulate>
      >((top, item) => (item && (!top || item.error < top.error) ? item : top), undefined)
  const coarse = best(grid(undefined, 0.05), grid(undefined, 0.05))
  if (!coarse) return undefined
  return best(grid(coarse.regular, 0.01), grid(coarse.chance, 0.01))
}

// regular: share of adopters who come back; chance: a regular's chance of using the model on a later day.
function simulate(
  days: Day[],
  activity: number[],
  targets: { start: number; end: number; users: number }[],
  regular: number,
  chance: number,
) {
  // earlier[t]: adopters before day t, each weighted by the chance they are still around on day t.
  const earlier: number[] = []
  const adopters: number[] = []
  for (const [index, day] of days.entries()) {
    earlier.push(index === 0 ? 0 : STAY * (earlier[index - 1]! + adopters[index - 1]!))
    const value = day.users - regular * chance * activity[index]! * earlier[index]!
    if (value < 0) return undefined
    adopters.push(value)
  }
  const error = targets.reduce((sum, target) => {
    // Chance that a regular still around on the week's first day uses the model at least once that week.
    const back = Array.from({ length: target.end - target.start + 1 }, (_, offset) => target.start + offset).reduce(
      (result, index) => ({
        chance: result.chance + result.unseen * chance * activity[index]!,
        unseen: result.unseen * STAY * (1 - chance * activity[index]!),
      }),
      { chance: 0, unseen: 1 },
    ).chance
    const fresh = adopters.slice(target.start, target.end + 1).reduce((total, value) => total + value, 0)
    return sum + ((fresh + regular * back * earlier[target.start]! - target.users) / target.users) ** 2
  }, 0)
  return { error, regular, chance, adopters }
}

function isoAfter(date: string, days: number) {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10)
}
