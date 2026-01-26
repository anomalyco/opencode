/**
 * SWE-bench Dataset Loader
 * Download and parse dataset from HuggingFace
 */

import type { SWEInstance, RunConfig } from "./types"
import { DATASETS } from "./types"

const HF_API_BASE = "https://huggingface.co/api/datasets"

interface HFParquetRef {
  dataset: string
  config: string
  split: string
  url: string
}

/** Get Parquet file URLs from HuggingFace dataset */
async function getParquetUrls(dataset: string): Promise<HFParquetRef[]> {
  const response = await fetch(`${HF_API_BASE}/${dataset}/parquet`)
  if (!response.ok) {
    throw new Error(`Failed to fetch parquet info: ${response.statusText}`)
  }
  const data = await response.json()
  const refs: HFParquetRef[] = []

  for (const [config, splits] of Object.entries(data)) {
    for (const [split, urls] of Object.entries(splits as Record<string, string[]>)) {
      for (const url of urls) {
        refs.push({ dataset, config, split, url })
      }
    }
  }
  return refs
}

/** Fetch dataset rows using HuggingFace datasets API */
async function fetchDatasetRows(datasetName: string, split: string, limit?: number): Promise<SWEInstance[]> {
  const encodedName = encodeURIComponent(datasetName)
  const pageSize = limit ? Math.min(limit, 100) : 100
  const instances: SWEInstance[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    // Only request needed amount if limit is set
    const remaining = limit ? limit - instances.length : pageSize
    if (limit && remaining <= 0) break

    const fetchSize = limit ? Math.min(remaining, pageSize) : pageSize
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encodedName}&config=default&split=${split}&offset=${offset}&length=${fetchSize}`
    const response = await fetch(url)

    if (!response.ok) {
      // Try without config parameter
      const altUrl = `https://datasets-server.huggingface.co/rows?dataset=${encodedName}&split=${split}&offset=${offset}&length=${fetchSize}`
      const altResponse = await fetch(altUrl)
      if (!altResponse.ok) {
        throw new Error(`Failed to fetch dataset rows: ${response.statusText}`)
      }
      const altData = await altResponse.json()
      const rows = altData.rows || []
      for (const row of rows) {
        instances.push(row.row as SWEInstance)
        if (limit && instances.length >= limit) break
      }
      hasMore = rows.length === fetchSize && (!limit || instances.length < limit)
      offset += rows.length
      continue
    }

    const data = await response.json()
    const rows = data.rows || []

    for (const row of rows) {
      instances.push(row.row as SWEInstance)
      if (limit && instances.length >= limit) break
    }

    hasMore = rows.length === fetchSize && (!limit || instances.length < limit)
    offset += rows.length
  }

  return instances
}

/** Load dataset */
export async function loadDataset(config: RunConfig): Promise<SWEInstance[]> {
  const datasetInfo = DATASETS[config.dataset]
  
  // Calculate actual count to load
  const targetCount = config.limit || datasetInfo.count
  console.log(`Loading ${targetCount} instances from ${datasetInfo.name}...`)

  const instances = await fetchDatasetRows(datasetInfo.name, datasetInfo.split, config.limit)

  let filtered = instances

  // Filter specific instances
  if (config.instances && config.instances.length > 0) {
    const instanceSet = new Set(config.instances)
    filtered = filtered.filter((i) => instanceSet.has(i.instance_id))
  }

  console.log(`Loaded ${filtered.length} instances`)
  return filtered
}

/** Filter completed instances when resuming from checkpoint */
export function filterCompleted(instances: SWEInstance[], completed: string[]): SWEInstance[] {
  const completedSet = new Set(completed)
  return instances.filter((i) => !completedSet.has(i.instance_id))
}
