export type SplitGroups = Record<string, string[]>

const groupEntry = (groups: SplitGroups, id: string) => Object.entries(groups).find(([, items]) => items.includes(id))

const unique = (items: string[]) => Array.from(new Set(items))

export const splitMembers = (groups: SplitGroups, id: string) => groupEntry(groups, id)?.[1]

export const splitHead = (groups: SplitGroups, id: string) => splitMembers(groups, id)?.[0]

export const splitSibling = (groups: SplitGroups, id: string, ids?: string[]) => {
  const allow = ids ? new Set(ids) : undefined
  const group = splitMembers(groups, id)
  if (!group) return
  return group.find((item) => item !== id && (!allow || allow.has(item)))
}

export const splitRemove = (groups: SplitGroups, id: string) => {
  const group = groupEntry(groups, id)
  if (!group) return groups

  const [key, items] = group
  const next = items.filter((item) => item !== id)
  const rest = Object.fromEntries(Object.entries(groups).filter(([groupKey]) => groupKey !== key))
  if (next.length < 2) return rest

  const head = next[0]
  if (!head) return rest
  return {
    ...rest,
    [head]: unique(next),
  }
}

export const splitAdd = (groups: SplitGroups, id: string, created: string) => {
  if (id === created) return groups
  const base = splitRemove(groups, created)
  const group = groupEntry(base, id)
  if (!group) {
    return {
      ...base,
      [id]: [id, created],
    }
  }

  const [key, items] = group
  if (items.includes(created)) return base
  return {
    ...base,
    [key]: [...items, created],
  }
}

export const splitNormalize = (groups: SplitGroups, ids: string[]) => {
  const current = new Set(ids)
  const used = new Set<string>()
  return Object.fromEntries(
    Object.values(groups).flatMap((group) => {
      const next = unique(group).filter((id) => current.has(id) && !used.has(id))
      if (next.length < 2) return []

      next.forEach((id) => used.add(id))
      const head = next[0]
      if (!head) return []
      return [[head, next] as const]
    }),
  )
}

export const splitEqual = (left: SplitGroups, right: SplitGroups) => {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => {
    const a = left[key]
    const b = right[key]
    if (!a || !b) return false
    if (a.length !== b.length) return false
    return a.every((id, index) => id === b[index])
  })
}
