#!/usr/bin/env bun
/**
 * Runs the unit suite in sequential shards, each in a fresh process.
 *
 * Why not just `bun test`:
 *
 * A single `bun test` process over all ~286 files intermittently dies with
 * `panic(main thread): Segmentation fault` (SIGTRAP). It is a Bun bug, not a
 * test bug — it lands at a different file each time (observed at
 * server/httpapi-mdns, control-plane/workspace, after as few as 11 files) and
 * the reported trigger is `bun test` spawning child processes from the main
 * process, which this suite does constantly (CrossSpawnSpawner, the pty tests,
 * the mDNS tests, TestLLMServer). See oven-sh/bun#20643 and #23684.
 *
 * Sharding fixes it in practice because each shard is a fresh process handling
 * a fraction of the files, so neither the accumulated handle state nor the
 * memory footprint gets anywhere near where the crash appears. Four shards ran
 * clean where the single process crashed twice.
 *
 * Why not `--parallel` or `--isolate`:
 *
 *   --parallel (default = one worker per core): each worker loads the whole
 *   Effect graph + sqlite, ~1.1-2.3 GB each. On a 15-core machine that is
 *   ~26 GB and the machine starts swapping. Measured: 7 GB at --parallel=4,
 *   and *slower* than serial because of the thrashing.
 *
 *   --isolate: single process, fresh global per file, but the footprint still
 *   grew past 6 GB and the run was far slower than serial.
 *
 * Shards are sequential here so a dev machine never runs more than one heavy
 * process at a time. In CI, prefer one shard per job (matrix) instead — set
 * SHARD_INDEX/SHARD_TOTAL and this script runs exactly that one.
 */
import { $ } from "bun"

const total = Number(process.env["SHARD_TOTAL"] ?? 4)
const only = process.env["SHARD_INDEX"]
const args = process.argv.slice(2)

if (!Number.isInteger(total) || total < 1) {
  console.error(`SHARD_TOTAL must be a positive integer, got ${process.env["SHARD_TOTAL"]}`)
  process.exit(2)
}

const shards = only ? [Number(only)] : Array.from({ length: total }, (_, i) => i + 1)
if (shards.some((n) => !Number.isInteger(n) || n < 1 || n > total)) {
  console.error(`SHARD_INDEX must be between 1 and ${total}`)
  process.exit(2)
}

const failed: number[] = []
for (const index of shards) {
  console.log(`\n=== shard ${index}/${total} ===`)
  const result =
    await $`bun test --timeout 30000 --shard=${`${index}/${total}`} --only-failures ${args}`.nothrow()
  if (result.exitCode !== 0) failed.push(index)
}

if (failed.length) {
  console.error(`\nshards failed: ${failed.map((n) => `${n}/${total}`).join(", ")}`)
  process.exit(1)
}
console.log(`\nall ${shards.length} shard(s) passed`)
