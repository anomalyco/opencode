type Item = {
  featureKey: string
  tenantId: string
  startsAt: string
}

const rows: Item[] = []

export function registerRollout(item: Item) {
  rows.push(item)
  return { ok: true }
}

export function listRollouts() {
  return rows
}
