#!/usr/bin/env bun
/**
 * Refreshes the bundled models.dev catalog snapshot at src/models-dev/snapshot.txt.
 * The snapshot is the boot-time floor for the catalog when no cache entry exists
 * and fetching is disabled or unavailable; live fetch still refreshes on top.
 */
import { committedSnapshot, fetchModelsSnapshot } from "./models-snapshot"

const snapshot = await fetchModelsSnapshot()
await Bun.write(committedSnapshot, snapshot.text)
console.log(
  `Wrote ${snapshot.providers} providers (${snapshot.text.length} bytes) to ${Bun.fileURLToPath(committedSnapshot)}`,
)
