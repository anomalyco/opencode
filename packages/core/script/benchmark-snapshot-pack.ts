/**
 * Copy existing snapshot stores and run the real object packing on the copies. Verifies
 * that every locally stored object survives and reports size, time, and peak RSS
 * of the Git child. The originals are only read.
 *
 *   bun run script/benchmark-snapshot-pack.ts <store>...
 */
import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Logger } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Git } from "../src/git"
import { AbsolutePath } from "../src/schema"

const root = path.join(process.env.SNAPSHOT_BENCH_ROOT ?? os.tmpdir(), "opencode-snapshot-pack")
await fs.mkdir(root, { recursive: true })

// Local objects only: alternates are hidden so borrowed source objects do not count.
async function objects(store: string) {
  const alternates = path.join(store, "objects", "info", "alternates")
  const borrowed = await fs.readFile(alternates, "utf8").catch(() => undefined)
  if (borrowed !== undefined) await fs.rm(alternates)
  const listed =
    await $`git --git-dir ${store} --work-tree ${store} cat-file --batch-all-objects ${"--batch-check=%(objectname)"}`
      .quiet()
      .text()
  if (borrowed !== undefined) await fs.writeFile(alternates, borrowed)
  return listed.split("\n").filter(Boolean).toSorted()
}

const size = async (directory: string) => Number((await $`du -sk ${directory}`.quiet().text()).split("\t")[0])
const loose = async (store: string) =>
  (await $`find ${path.join(store, "objects")} -path '*/objects/??/*' -type f`.quiet().text())
    .split("\n")
    .filter(Boolean).length

let failed = false
for (const source of process.argv.slice(2)) {
  const copy = await fs.mkdtemp(path.join(root, "store-"))
  await $`cp -R ${source}/. ${copy}`.quiet()
  const before = { objects: await objects(copy), size: await size(copy), loose: await loose(copy) }
  const started = performance.now()
  await Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git.Service
      yield* git.objects.pack(
        new Git.Repository({
          worktree: AbsolutePath.make(copy),
          gitDirectory: AbsolutePath.make(copy),
          commonDirectory: AbsolutePath.make(copy),
        }),
      )
    }).pipe(Effect.provide(AppNodeBuilder.build(Git.node)), Effect.provide(Logger.layer([]))),
  )
  const elapsed = performance.now() - started
  const after = { objects: await objects(copy), size: await size(copy), loose: await loose(copy) }
  const same = before.objects.join("\n") === after.objects.join("\n")
  if (!same) failed = true
  console.log(
    `${path.basename(source)}  ${before.size} KiB -> ${after.size} KiB  loose ${before.loose} -> ${after.loose}  objects ${before.objects.length} -> ${after.objects.length} ${same ? "identical" : "MISMATCH"}  ${elapsed.toFixed(0)} ms`,
  )
  await fs.rm(copy, { recursive: true, force: true })
}
if (failed) process.exit(1)
