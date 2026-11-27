import { consoleProviderGroup } from "@/providers/catalog/console"
import { isFreeModel } from "./models"

type Model = { id: string; provider: { id: string; name: string; integrationID?: string }; cost?: { input: number } }

type Group<M> = { category: string; items: M[] }

/** The free models' group, when paid OpenCode models are listed too, so the two keep their own collapsed states. */
export const FREE_GROUP_KEY = "free:opencode"

/**
 * Takes the free models out of their provider into a group of their own, which lists last. When OpenCode has no paid
 * models listed, the group keeps OpenCode's own key, so its collapsed state and a reveal of OpenCode still find it.
 */
export function splitFreeModels<M extends Parameters<typeof isFreeModel>[0]>(groups: readonly Group<M>[]) {
  const paid = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !isFreeModel(item)) }))
    .filter((group) => group.items.length > 0)
  const items = groups.flatMap((group) => group.items.filter(isFreeModel))

  return {
    groups: paid,
    free:
      items.length > 0
        ? { category: paid.some((group) => group.category === "opencode") ? FREE_GROUP_KEY : "opencode", items }
        : undefined,
  }
}

/** `list`: the section is Favorites, Recent or Free instead of a provider. */
export type PickerSection<M> = { key: string; list?: "favorite" | "recent" | "free"; items: readonly M[] }

const modelKey = (model: Model) => `${model.provider.id}:${model.id}`

/**
 * The model picker's sections in display order. Favorites and Recent lead until a search narrows the list, and their
 * models leave their provider. The Console workspace's providers list together at the first one's position. Free
 * models leave their provider for a group of their own, always last.
 */
export function pickerSections<M extends Model>(input: {
  /** Provider groups in the order the picker lists providers. */
  groups: readonly Group<M>[]
  /** Every listed model, so a search that hides the workspace root keeps its providers together. */
  all: readonly M[]
  favorites: readonly M[]
  recent: readonly M[]
  searching: boolean
}): PickerSection<M>[] {
  const favorites = input.searching ? [] : input.favorites
  const favored = new Set(favorites.map(modelKey))
  const recent = input.searching ? [] : input.recent.filter((item) => !favored.has(modelKey(item)))
  const listed = new Set([...favored, ...recent.map(modelKey)])
  const split = splitFreeModels(
    input.groups.map((group) => ({ ...group, items: group.items.filter((item) => !listed.has(modelKey(item))) })),
  )
  const managed = new Set(
    consoleProviderGroup([
      ...new Map(input.all.map((item) => [item.provider.id, item.provider])).values(),
    ])?.providers.map((provider) => provider.id),
  )
  const first = split.groups.findIndex((group) => managed.has(group.category))

  return [
    ...(favorites.length > 0 ? [{ key: "favorite", list: "favorite" as const, items: favorites }] : []),
    ...(recent.length > 0 ? [{ key: "recent", list: "recent" as const, items: recent }] : []),
    ...split.groups.flatMap((group, index) => {
      if (!managed.has(group.category)) return [{ key: group.category, items: group.items }]

      if (index !== first) return []

      return split.groups
        .filter((item) => managed.has(item.category))
        .map((item) => ({ key: item.category, items: item.items }))
    }),
    ...(split.free ? [{ key: "free", list: "free" as const, items: split.free.items }] : []),
  ]
}
