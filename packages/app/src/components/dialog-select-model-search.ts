export const normalizeModelSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")

export const compactModelSearch = (value: string) => normalizeModelSearch(value).replaceAll(" ", "")

export const matchesModelSearch = (query: string, values: string[]) => {
  const search = normalizeModelSearch(query)
  if (!search) return true

  const compactSearch = compactModelSearch(query)
  return values.some(
    (value) => normalizeModelSearch(value).includes(search) || compactModelSearch(value).includes(compactSearch),
  )
}
