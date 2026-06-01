import path from "path"

import { createPlugTask, type PlugCtx, type PlugDeps } from "../../src/cli/cmd/plug"
import { Filesystem } from "@/util/filesystem"

type Msg = {
  dir: string
  target: string
  mod: string
  global?: boolean
  force?: boolean
  globalDir?: string
  vcs?: string
  worktree?: string
  directory?: string
  holdMs?: number
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function input() {
  const raw = process.argv[2]
  if (!raw) {
    throw new Error("Missing plug worker input")
  }

  const msg = JSON.parse(raw) as Partial<Msg>
  if (!msg.dir || !msg.target || !msg.mod) {
    throw new Error("Invalid plug worker input")
  }

  return msg as Msg
}

function deps(msg: Msg): PlugDeps {
  return {
    spinner: () => ({
      start() {},
      stop() {},
    }),
    log: {
      error() {},
      info() {},
      success() {},
    },
    resolve: async () => msg.target,
    readText: (file) => Filesystem.readText(file),
    write: async (file, text) => {
      if (msg.holdMs && msg.holdMs > 0) {
        await sleep(msg.holdMs)
      }
      await Filesystem.write(file, text)
    },
    exists: (file) => Filesystem.exists(file),
    files: (dir, name) => [path.join(dir, `${name}.jsonc`), path.join(dir, `${name}.json`)],
    global: msg.globalDir ?? path.join(msg.dir, ".global"),
  }
}

function ctx(msg: Msg): PlugCtx {
  return {
    vcs: msg.vcs ?? "git",
    worktree: msg.worktree ?? msg.dir,
    directory: msg.directory ?? msg.dir,
  }
}

async function main() {
  const msg = input()
  const run = createPlugTask(
    {
      mod: msg.mod,
      global: msg.global,
      force: msg.force,
    },
    deps(msg),
  )

  const ok = await run(ctx(msg))
  if (!ok) {
    throw new Error("Plug task failed")
  }
}

await main().catch((err) => {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
  process.stderr.write(text)
  process.exit(1)
})
