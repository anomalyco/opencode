#!/usr/bin/env bun
/**
 * Refreshes the bundled models.dev catalog snapshot at src/models-dev/snapshot.txt.
 * The snapshot is the boot-time floor for the catalog when no cache entry exists
 * and fetching is disabled or unavailable; live fetch still refreshes on top.
 */
const source = process.env.OPENCODE_MODELS_URL || "https://models.opencode.ai"
const response = await fetch(`${source}/api.json`)
if (!response.ok) {
  console.error(`Failed to fetch ${source}/api.json: ${response.status} ${response.statusText}`)
  process.exit(1)
}
const text = await response.text()
const parsed: unknown = JSON.parse(text)
if (typeof parsed !== "object" || parsed === null || Object.keys(parsed).length === 0) {
  console.error("Fetched catalog is empty; refusing to write snapshot")
  process.exit(1)
}
const target = new URL("../src/models-dev/snapshot.txt", import.meta.url)
await Bun.write(target, text)
console.log(`Wrote ${Object.keys(parsed).length} providers (${text.length} bytes) to ${target.pathname}`)
