#!/usr/bin/env bun
import fs from "fs/promises"
import os from "os"
import path from "path"
import { performance } from "perf_hooks"
import { Ripgrep } from "../src/file/ripgrep"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "glob-perf-"))
const scaleInput = process.env.GLOB_PERF_SCALE ?? "1"
const scale = Number.isNaN(Number(scaleInput)) ? 1 : Math.max(1, Number(scaleInput))

async function makeTree() {
  const branches = 40 * scale
  const subs = 12 * scale
  const filesPerDir = 40
  const content = "x".repeat(256)

  const tasks: Promise<unknown>[] = []
  for (const b of Array.from({ length: branches }).map((_, i) => i)) {
    const base = path.join(root, `dir${b}`)
    tasks.push(
      fs.mkdir(base, { recursive: true }).then(async () => {
        for (const s of Array.from({ length: subs }).map((_, j) => j)) {
          const sub = path.join(base, `sub${s}`)
          await fs.mkdir(sub, { recursive: true })
          for (const f of Array.from({ length: filesPerDir }).map((_, k) => k)) {
            await Bun.write(path.join(sub, `file${f}.txt`), content)
          }
        }
      }),
    )
  }
  await Promise.all(tasks)
}

async function makeSymlinkLoop() {
  const loopRoot = path.join(root, "loop")
  await fs.mkdir(loopRoot, { recursive: true })
  await Bun.write(path.join(loopRoot, "loop-file.txt"), "loop")
  await fs.symlink(loopRoot, path.join(loopRoot, "cycle"))
}

async function runScan(label: string, follow: boolean) {
  const start = performance.now()
  const files = await Array.fromAsync(
    Ripgrep.files({
      cwd: root,
      follow,
      timeoutMs: 5000,
    }),
  ).catch((e) => {
    console.log(`${label}: error ${e}`)
    return [] as string[]
  })
  const ms = Math.round(performance.now() - start)
  console.log(`${label}: files=${files.length} time=${ms}ms follow=${follow}`)
}

await makeTree()
await makeSymlinkLoop()

await runScan("no-follow", false)
await runScan("with-follow", true)

await fs.rm(root, { recursive: true, force: true })
