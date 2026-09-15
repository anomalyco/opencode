import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Snapshot } from "../../src/snapshot"
import { provideInstance, testInstanceStoreLayer } from "./fixture"

type Message = {
  directory: string
  output: string
  ready?: string
  barrier?: string
  file?: string
  nativeIndexLock?: boolean
  transientIndexLockMs?: number
  twice?: boolean
  configLockBeforeSecond?: boolean
  preexistingToken?: boolean
  reportToken?: boolean
  deadToken?: boolean
  liveToken?: boolean
  foreignHostToken?: boolean
  cleanup?: boolean
  patchAfterIgnore?: boolean
}

const message: Message = JSON.parse(process.argv[2] ?? "{}")

async function waitFor(file: string) {
  for (;;) {
    if (await Bun.file(file).exists()) return
    await Bun.sleep(10)
  }
}

async function snapshotGitdir() {
  const root = path.join(process.env.XDG_DATA_HOME!, "opencode", "snapshot")
  const projects = await fs.readdir(root)
  const directories = await Promise.all(
    projects.map(async (project) => {
      const children = await fs.readdir(path.join(root, project))
      return children.map((child) => path.join(root, project, child))
    }),
  )
  const gitdir = directories.flat().at(0)
  if (!gitdir) throw new Error("snapshot git directory was not created")
  return gitdir
}

function deadPid() {
  const candidate = process.pid + 1_000_000
  try {
    process.kill(candidate, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return candidate
  }
  throw new Error(`Expected ${candidate} to be a dead PID`)
}

const layer = Layer.mergeAll(
  LayerNode.compile(LayerNode.group([Snapshot.node, FSUtil.node])),
  testInstanceStoreLayer,
)

const result = await Effect.runPromise(
  Effect.gen(function* () {
    if (message.file) yield* Effect.promise(() => fs.writeFile(path.join(message.directory, message.file!), process.pid.toString()))
    if (message.ready) yield* Effect.promise(() => fs.writeFile(message.ready!, process.pid.toString()))
    if (message.barrier) yield* Effect.promise(() => waitFor(message.barrier!))

    const snapshot = yield* Snapshot.Service
    if (message.cleanup) {
      yield* snapshot.cleanup()
      return { cleanup: true }
    }
    const first = yield* snapshot.track()
    if (message.twice) {
      const gitdir = yield* Effect.promise(snapshotGitdir)
      if (message.configLockBeforeSecond) yield* Effect.promise(() => fs.writeFile(path.join(gitdir, "config.lock"), ""))
      const second = yield* snapshot.track()
      return {
        first,
        second,
        tokenExists: yield* Effect.promise(() => Bun.file(path.join(gitdir, "snapshot-transaction-token")).exists()),
      }
    }
    if (message.patchAfterIgnore) {
      yield* Effect.promise(() => fs.writeFile(path.join(message.directory, "tracked.txt"), "changed"))
      yield* Effect.promise(() => fs.writeFile(path.join(message.directory, ".gitignore"), "tracked.txt\n"))
      const patch = yield* snapshot.patch(first ?? "missing")
      return { first, patch }
    }
    if (
      !message.nativeIndexLock &&
      !message.transientIndexLockMs &&
      !message.preexistingToken &&
      !message.deadToken &&
      !message.liveToken &&
      !message.foreignHostToken
    ) {
      if (!message.reportToken) return { first }
      const gitdir = yield* Effect.promise(snapshotGitdir)
      return {
        first,
        tokenExists: yield* Effect.promise(() => Bun.file(path.join(gitdir, "snapshot-transaction-token")).exists()),
      }
    }

    const gitdir = yield* Effect.promise(snapshotGitdir)
    yield* Effect.promise(() => fs.writeFile(path.join(message.directory, "changed.txt"), "changed"))
    if (message.nativeIndexLock || message.transientIndexLockMs) {
      yield* Effect.promise(() => fs.writeFile(path.join(gitdir, "index.lock"), ""))
    }
    if (message.preexistingToken) {
      yield* Effect.promise(() => fs.writeFile(path.join(gitdir, "snapshot-transaction-token"), "split-lock"))
    }
    if (message.deadToken) {
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(gitdir, "snapshot-transaction-token"),
          JSON.stringify({ pid: deadPid(), hostname: os.hostname(), createdAt: Date.now() - 1_000 }),
        ),
      )
    }
    if (message.liveToken) {
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(gitdir, "snapshot-transaction-token"),
          JSON.stringify({ pid: process.pid, hostname: os.hostname(), createdAt: Date.now() - 1_000 }),
        ),
      )
    }
    if (message.foreignHostToken) {
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(gitdir, "snapshot-transaction-token"),
          JSON.stringify({ pid: deadPid(), hostname: "foreign-host", createdAt: Date.now() - 1_000 }),
        ),
      )
    }
    if (message.transientIndexLockMs) {
      setTimeout(() => void fs.rm(path.join(gitdir, "index.lock"), { force: true }), message.transientIndexLockMs)
    }
    const second = yield* snapshot.track()
    return {
      first,
      second,
      indexLockExists: yield* Effect.promise(() => Bun.file(path.join(gitdir, "index.lock")).exists()),
      tokenExists: yield* Effect.promise(() => Bun.file(path.join(gitdir, "snapshot-transaction-token")).exists()),
    }
  }).pipe(provideInstance(message.directory), Effect.provide(layer)),
)

await fs.writeFile(message.output, JSON.stringify(result))
