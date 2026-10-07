import { sortBy } from "remeda"

/**
 * Zero-spend across every metered axis — mirrors the core `ModelCost.isFree`
 * policy so the picker badge and engine selection never disagree. Applies to
 * any provider, not just the hosted opencode catalog.
 */
export function isFreeModel(
  cost: { input: number; output: number; cache?: { read?: number; write?: number } } | undefined,
) {
  if (!cost) return false
  return (
    cost.input === 0 &&
    cost.output === 0 &&
    (cost.cache?.read ?? 0) === 0 &&
    (cost.cache?.write ?? 0) === 0
  )
}

/**
 * Release-descending ordering shared by the model dialog. Without
 * `newestFirst`, free options sort ahead of priced ones first (FREE-FIRST).
 */
export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}
