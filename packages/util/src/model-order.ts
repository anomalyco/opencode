export type ModelOrder = {
  free: boolean
  released: number
  name: string
}

/** Apply after filtering so fuzzy relevance cannot put older models first. */
export function compareModelOrder(a: ModelOrder, b: ModelOrder) {
  return Number(b.free) - Number(a.free) || b.released - a.released || a.name.localeCompare(b.name)
}
