#!/usr/bin/env bun
/**
 * Refreshes the bundled models.dev catalog snapshot at src/models-dev/snapshot.txt,
 * or writes it to the path given as the first argument.
 * The snapshot is the boot-time floor for the catalog when no cache entry exists
 * and fetching is disabled or unavailable; live fetch still refreshes on top.
 */
import path from "node:path"
import { committedSnapshot, fetchModelsSnapshot } from "./models-snapshot"

const target = process.argv[2] ? path.resolve(process.argv[2]) : Bun.fileURLToPath(committedSnapshot)
const snapshot = await fetchModelsSnapshot()
await Bun.write(target, snapshot.text)
console.log(`Wrote ${snapshot.providers} providers (${snapshot.text.length} bytes) to ${target}`)
