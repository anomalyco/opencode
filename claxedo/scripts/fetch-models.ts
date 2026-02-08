#!/usr/bin/env npx tsx
/**
 * Build-time script to fetch models.dev data and embed as static JSON
 *
 * Usage: npx tsx scripts/fetch-models.ts
 *
 * Generates:
 *   - src/generated/models-data.json  (raw data)
 *   - src/generated/models-types.ts   (TypeScript types)
 */

const MODELS_URL = process.env.OPENCODE_MODELS_URL || "https://models.dev"
const OUTPUT_DIR = new URL("../src/generated/", import.meta.url)

async function main() {
  const url = `${MODELS_URL.replace(/\/+$/, "")}/api.json`

  console.log(`Fetching models from ${url}...`)

  const res = await fetch(url, {
    headers: { "User-Agent": "claxedo-build" },
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  const providerCount = Object.keys(data).length
  const modelCount = Object.values(data).reduce(
    (acc: number, p: any) => acc + Object.keys(p.models || {}).length,
    0
  )

  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  const { fileURLToPath } = await import("node:url")

  const outputDir = fileURLToPath(OUTPUT_DIR)
  await fs.mkdir(outputDir, { recursive: true })

  // Write JSON data
  const jsonFile = path.join(outputDir, "models-data.json")
  const jsonContent = {
    _generatedAt: new Date().toISOString(),
    _source: url,
    data,
  }
  await fs.writeFile(jsonFile, JSON.stringify(jsonContent, null, 2), "utf-8")
  console.log(`Written ${jsonFile}`)

  // Write types file
  const typesFile = path.join(outputDir, "models-types.ts")
  const typesContent = `// AUTO-GENERATED - DO NOT EDIT
// Generated at: ${new Date().toISOString()}
// Source: ${url}

export type ModelsDevModel = {
  id: string
  name: string
  family?: string
  release_date?: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  interleaved?: true | { field: "reasoning_content" | "reasoning_details" }
  cost?: unknown
  limit?: unknown
  modalities?: unknown
  experimental?: boolean
  status?: "alpha" | "beta" | "deprecated"
  options?: Record<string, unknown>
  headers?: Record<string, string>
  provider?: { npm: string }
  variants?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export type ModelsDevProvider = {
  api?: string
  name: string
  env: string[]
  id: string
  npm?: string
  models: Record<string, ModelsDevModel>
  [key: string]: unknown
}

export type ModelsData = Record<string, ModelsDevProvider>
`
  await fs.writeFile(typesFile, typesContent, "utf-8")
  console.log(`Written ${typesFile}`)

  console.log(`  ${providerCount} providers, ${modelCount} models`)
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
})
