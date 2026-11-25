export type ArtifactRow = {
  channel: string
  name: string
  distribution: string
  version: string
  metadata: string
  active: number
  minimum: number
  time_created: number
  time_updated: number
}

export type ManifestEntry = {
  version: string
  metadata: unknown
  time_created: number
  time_updated: number
}

export type DistributionManifest = {
  active: ManifestEntry
  minimum?: ManifestEntry
}

export type ChannelIndexEntry = {
  name: string
  distribution: string
}

export type ChannelIndex = {
  entries: ChannelIndexEntry[]
}

export type KvWrite = {
  key: string
  value: string
}

export const selectArtifactColumns =
  "SELECT channel, name, distribution, version, metadata, active, minimum, time_created, time_updated FROM artifact"

export const selectActiveAndMinimum = `${selectArtifactColumns} INDEXED BY artifact_active WHERE active = 1
UNION ALL
${selectArtifactColumns} INDEXED BY artifact_minimum WHERE minimum = 1 AND active = 0
ORDER BY channel, name, distribution`

export function manifestKey(channel: string, name: string, distribution: string) {
  return `manifest:${channel}/${name}/${distribution}`
}

export function indexKey(channel: string) {
  return `index:${channel}`
}

export function parseMetadata(input: string): unknown | undefined {
  try {
    return JSON.parse(input)
  } catch {
    return
  }
}

export function decodeMetadata(input: string) {
  return parseMetadata(input) ?? null
}

export function toManifestEntry(
  row: Pick<ArtifactRow, "version" | "metadata" | "time_created" | "time_updated">,
): ManifestEntry {
  return {
    version: row.version,
    metadata: decodeMetadata(row.metadata),
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

export function toManifest(rows: ArtifactRow[]): DistributionManifest | undefined {
  const activeRow = rows.find((row) => row.active === 1)
  if (!activeRow) return
  const minimumRow = rows.find((row) => row.minimum === 1)
  const active = toManifestEntry(activeRow)
  return minimumRow ? { active, minimum: toManifestEntry(minimumRow) } : { active }
}

export function compareEntries(a: ChannelIndexEntry, b: ChannelIndexEntry) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  if (a.distribution !== b.distribution) return a.distribution < b.distribution ? -1 : 1
  return 0
}

export function buildManifestEntries(rows: ArtifactRow[]): KvWrite[] {
  const groups = new Map<string, { channel: string; name: string; distribution: string; rows: ArtifactRow[] }>()
  for (const row of rows) {
    // Retired next channel resolves to beta on lookup; never backfill under next.
    if (row.channel === "next") continue
    const id = `${row.channel}/${row.name}/${row.distribution}`
    const group = groups.get(id) ?? {
      channel: row.channel,
      name: row.name,
      distribution: row.distribution,
      rows: [],
    }
    group.rows.push(row)
    groups.set(id, group)
  }

  const byChannel = new Map<string, ChannelIndexEntry[]>()
  const manifests: KvWrite[] = []
  const records = [...groups.values()].sort((a, b) => {
    if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1
    return compareEntries(a, b)
  })

  for (const record of records) {
    const manifest = toManifest(record.rows)
    if (!manifest) continue
    manifests.push({
      key: manifestKey(record.channel, record.name, record.distribution),
      value: JSON.stringify(manifest),
    })
    const entries = byChannel.get(record.channel) ?? []
    entries.push({ name: record.name, distribution: record.distribution })
    byChannel.set(record.channel, entries)
  }

  // Emit manifests before indexes for deterministic output (wrangler kv bulk put uploads the batch unordered).
  const indexes: KvWrite[] = [...byChannel.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([channel, entries]) => ({
      key: indexKey(channel),
      value: JSON.stringify({ entries } satisfies ChannelIndex),
    }))

  return [...manifests, ...indexes]
}
