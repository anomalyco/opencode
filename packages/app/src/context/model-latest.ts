import { DateTime } from "luxon"
import { filter, firstBy, flat, groupBy, mapValues, pipe, values } from "remeda"

export function selectLatest(
  models: Array<{ id: string; family?: string; release_date: string; provider: { id: string } }>,
  releases: Map<string, DateTime>,
) {
  return pipe(
    models,
    filter(
      (x) =>
        Math.abs((releases.get(`${x.provider.id}:${x.id}`) ?? DateTime.invalid("invalid")).diffNow().as("months")) < 6,
    ),
    groupBy((x) => x.provider.id),
    mapValues((group) =>
      pipe(
        group,
        // remeda groupBy drops items keyed by undefined, which would hide
        // family-less models from latestSet forever. Prefix both sides so a
        // family-less model can never share a group with a same-named family,
        // no matter what the family string contains.
        groupBy((x) => (x.family === undefined ? `model:${x.id}` : `family:${x.family}`)),
        values(),
        (groups) =>
          groups.flatMap((g) => {
            const first = firstBy(g, [(x) => x.release_date, "desc"])
            return first ? [{ modelID: first.id, providerID: first.provider.id }] : []
          }),
      ),
    ),
    values(),
    flat(),
  )
}
