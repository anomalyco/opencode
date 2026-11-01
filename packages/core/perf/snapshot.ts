// Snapshot capture, listing, diff, restore and packing against generated repositories, and a scripted
// agent session with snapshots on or off. strobe's script host loads this module once per block and
// calls its exports (perf/snapshot.bench.ts, perf/session.bench.ts). Each operation returns how many
// git processes it spawned, an exact count next to its time.
//
// Fixtures are generated once under $SNAPSHOT_BENCH_ROOT (default the temp folder) by running this file
// (`bun packages/core/perf/snapshot.ts medium`), and reset to their first commit when a block prepares one. The
// snapshot store is a fresh folder per block.
import { $ } from "bun"
import fs from "fs/promises"
import { rmSync } from "fs"
import os from "os"
import path from "path"
import type { LLMEvent } from "@opencode/ai/effect"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Effect, Layer, Logger, ManagedRuntime, Stream } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Git } from "../src/git"
import { Location } from "../src/location"
import { AbsolutePath, RelativePath } from "../src/schema"
import { Snapshot } from "../src/snapshot"

const root = path.join(process.env.SNAPSHOT_BENCH_ROOT ?? os.tmpdir(), "opencode-snapshot-bench")

const fixtures: Record<string, { tracked: number; ignored: number; dirs: number }> = {
  small: { tracked: 1_000, ignored: 0, dirs: 20 },
  medium: { tracked: 20_000, ignored: 20_000, dirs: 400 },
  large: { tracked: 100_000, ignored: 50_000, dirs: 2_000 },
}

let spawns = 0
const countingProcess = Layer.effect(
  AppProcess.Service,
  Effect.gen(function* () {
    const real = yield* AppProcess.Service
    return AppProcess.Service.of({
      ...real,
      run: (command, options) => {
        spawns++
        return real.run(command, options)
      },
    })
  }),
).pipe(Layer.provide(AppNodeBuilder.build(AppProcess.node)))

const snapshotLayer = (data: string, directory: string) =>
  AppNodeBuilder.build(Snapshot.node, [
    Location.node.replace(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    Global.node.replace(Global.layerWith({ data, config: path.join(data, "config") })),
    AppProcess.node.replace(countingProcess),
  ]).pipe(Layer.provide(Logger.layer([])))

const state: {
  dir: string
  data: string
  sample: string[]
  runtime?: ManagedRuntime.ManagedRuntime<Snapshot.Service, never>
  before?: Snapshot.ID
  after?: Snapshot.ID
  edits: number
  store?: string
} = { dir: "", data: "", sample: [], edits: 0 }

process.on("exit", () => {
  if (state.data) rmSync(state.data, { recursive: true, force: true })
  if (state.store) rmSync(`${state.store}-work`, { recursive: true, force: true })
})

const snapshot = <A, E>(body: (snapshot: Snapshot.Interface) => Effect.Effect<A, E>) => {
  if (!state.runtime) throw new Error("prepare a fixture first")
  return state.runtime.runPromise(Effect.flatMap(Snapshot.Service, body))
}

// The spawned git processes of `body`, an exact count per run.
const counted = async (body: () => Promise<unknown>) => {
  const before = spawns
  await body()
  return spawns - before
}

/** Resets the fixture and opens a fresh snapshot store on it; the first capture creates the store. */
export async function prepare(fixture: string) {
  const dir = path.join(root, "fixtures", fixture)
  if (!(await Bun.file(path.join(dir, ".bench-ready")).exists()))
    throw new Error(
      `fixture ${fixture} is not generated yet: run \`bun packages/core/perf/snapshot.ts ${fixture}\` once`,
    )
  state.dir = dir
  await reset(state.dir)
  state.data = await fs.mkdtemp(path.join(root, "data-"))
  state.sample = await trackedSample(state.dir, 100)
  state.runtime = ManagedRuntime.make(snapshotLayer(state.data, state.dir) as Layer.Layer<Snapshot.Service>)
  await capture()
}

export const capture = () =>
  counted(() =>
    snapshot((s) =>
      s
        .capture()
        .pipe(Effect.flatMap((id) => (id ? Effect.succeed(id) : Effect.die(new Error("capture returned undefined"))))),
    ),
  )

/** Edits `count` tracked files (spread across the tree). */
export async function edit(count: number) {
  const tag = `edit-${state.edits++}`
  await Promise.all(
    state.sample.slice(0, count).map((file) => Bun.write(path.join(state.dir, file), `// ${tag}\n${file}\n`)),
  )
}

/** Adds one new file. */
export async function add() {
  await Bun.write(path.join(state.dir, "src", `new-${state.edits++}.ts`), "new\n")
}

/** A capture before and after editing 100 files, for listing and diffing the change. */
export async function change() {
  state.before = await snapshot((s) => s.capture())
  await edit(100)
  state.after = await snapshot((s) => s.capture())
}

/** The capture `restore` puts files back to. */
export async function mark() {
  state.before = await snapshot((s) => s.capture())
}

export const files = () => counted(() => snapshot((s) => s.files({ from: state.before!, to: state.after! })))

export const diff = () => counted(() => snapshot((s) => s.diff({ from: state.before!, to: state.after! })))

export const restore = () =>
  counted(() =>
    snapshot((s) =>
      s.restore({ files: new Map(state.sample.map((file) => [RelativePath.make(file), state.before!] as const)) }),
    ),
  )

/**
 * A read-mostly agent loop under the step policy, 20 steps: capture at attempt start, capture at
 * settlement, then list changed files. One step in five edits two files.
 */
export const agentLoop = () =>
  counted(async () => {
    for (let index = 0; index < 20; index++) {
      const from = await snapshot((s) => s.capture())
      if (index % 5 === 0) await edit(2)
      const to = await snapshot((s) => s.capture())
      if (from !== to) await snapshot((s) => s.files({ from: from!, to: to! }))
    }
  })

/** A store with history to pack: ten captures of 100 edited files, copied aside untouched. */
export async function history() {
  for (let index = 0; index < 10; index++) {
    await edit(100)
    await snapshot((s) => s.capture())
  }
  const project = (await fs.readdir(path.join(state.data, "snapshot")))[0]!
  const stores = await fs.readdir(path.join(state.data, "snapshot", project))
  state.store = path.join(state.data, "snapshot", project, stores[0]!)
  await unpack()
}

/** Puts the unpacked copy of the store back, for the next packing. */
export async function unpack() {
  await fs.rm(`${state.store}-work`, { recursive: true, force: true })
  await fs.cp(state.store!, `${state.store}-work`, { recursive: true })
}

/** Packs the store copy's loose objects; returns the git processes and the store's size after (KiB). */
export async function pack() {
  const store = AbsolutePath.make(`${state.store}-work`)
  const git = await counted(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        const git = yield* Git.Service
        yield* git.objects.pack(
          new Git.Repository({ worktree: AbsolutePath.make(state.dir), gitDirectory: store, commonDirectory: store }),
        )
      }).pipe(
        Effect.provide(AppNodeBuilder.build(Git.node, [AppProcess.node.replace(countingProcess)])),
        Effect.provide(Logger.layer([])),
      ),
    ),
  )
  return { git, kib: Math.round((await size(store)) / 1024) }
}

async function size(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const sizes = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? size(path.join(dir, entry.name)) : fs.stat(path.join(dir, entry.name)).then((s) => s.size),
    ),
  )
  return sizes.reduce((total, n) => total + n, 0)
}

// A read-heavy coding loop: explore, edit, run checks, answer.
const trace = [
  "read",
  "grep",
  "read",
  "glob",
  "read",
  "edit",
  "shell",
  "read",
  "edit",
  "shell",
  "grep",
  "read",
  "edit",
  "shell",
  "text",
] as const

/**
 * One agent session through the real SessionStep.attempt: the scripted trace, each model response
 * after `ttft` ms, with snapshots on (a real store) or off. The difference between the two is what
 * snapshots add to a session's wall time.
 */
export async function session(snapshots: "on" | "off", ttft: number) {
  // Loaded here, not at the top: the snapshot cases then load at git refs whose session and model
  // APIs differ, and the first session call (a warmup run) pays for the import.
  const { ai, LanguageModel } = await import("@opencode/ai/effect")
  const { OpenAIChat } = await import("@opencode/ai/protocols/openai-chat")
  const { TestLLM } = await import("@opencode/ai/testing")
  const { LayerNode } = await import("@opencode/util/effect/layer-node")
  const { Money } = await import("@opencode/schema/money")
  const { Agent } = await import("../src/agent")
  const { Bus } = await import("../src/bus")
  const { Database } = await import("../src/database/database")
  const { Project } = await import("../src/project")
  const { ProjectTable } = await import("../src/project/sql")
  const { Session } = await import("../src/session")
  const { SessionMessage } = await import("../src/session/message")
  const { SessionProjector } = await import("../src/session/projector")
  const { SessionRunnerModel } = await import("../src/session/runner/model")
  const { SessionStep } = await import("../src/session/runner/step")
  const { SessionTable } = await import("../src/session/sql")
  const { ToolOutput } = await import("../src/tool-output")

  const model = SessionRunnerModel.resolved(
    LanguageModel.make({ id: "bench-model", provider: "test", route: OpenAIChat.route }),
    {
      capabilities: { tools: true, input: ["text"], output: ["text"] },
      limit: { context: 100_000, output: 1_000 },
      cost: [
        {
          input: Money.USDPerMillionTokens.make(1),
          output: Money.USDPerMillionTokens.make(2),
          cache: { read: Money.USDPerMillionTokens.make(0.1), write: Money.USDPerMillionTokens.make(0.5) },
        },
      ],
    },
  )

  const before = spawns
  const layer = snapshots === "on" ? snapshotLayer(state.data, state.dir) : Snapshot.noopLayer
  const delayed = (response: ReturnType<typeof TestLLM.stop>) =>
    Stream.unwrap(Effect.sleep(ttft).pipe(Effect.as(Stream.fromIterable(response as Iterable<LLMEvent>))))
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const llm = yield* TestLLM.Test
      const sessionID = Session.ID.create()
      yield* db
        .insert(ProjectTable)
        .values({ id: Project.ID.global, worktree: AbsolutePath.make(state.dir), sandboxes: [] })
        .onConflictDoNothing()
        .run()
      yield* db
        .insert(SessionTable)
        .values({ id: sessionID, project_id: Project.ID.global, slug: "bench", directory: state.dir, version: "bench" })
        .run()
      const steps = yield* SessionStep.make
      let edits = 0
      for (const kind of trace) {
        const call = `call-${edits}-${kind}-${Math.random().toString(36).slice(2)}`
        yield* llm.push(
          delayed(
            kind === "text"
              ? TestLLM.text("Done.", `text-${call}`)
              : TestLLM.toolCall(call, kind, { path: state.sample[edits % state.sample.length] }),
          ),
        )
        yield* steps.attempt({
          isLocationClosed: () => false,
          sessionID,
          assistantMessageID: SessionMessage.ID.create(),
          agent: Agent.defaultID,
          model,
          prepared: {
            retry: () => Effect.void,
            request: ai.request({ model: model.model, prompt: "bench" }),
            options: {},
            executeTool: (input) =>
              Effect.gen(function* () {
                if (input.call.name === "edit")
                  yield* Effect.promise(() =>
                    Bun.write(
                      path.join(state.dir, state.sample[edits++ % state.sample.length]!),
                      `// bench ${edits}\n`,
                    ),
                  )
                return { content: [{ type: "text" as const, text: "ok" }] }
              }),
          },
          retry: () => Effect.succeed({ retry: false as const }),
          recoverContinuation: false,
          recoverOverflow: Effect.succeed(false),
        })
      }
    }).pipe(
      Effect.provide(layer),
      Effect.provide(
        Layer.merge(
          AppNodeBuilder.build(LayerNode.group([Database.node, Bus.node, SessionProjector.node, ToolOutput.node]), [
            Bus.node.replace(Bus.configured({ persist: true })),
          ]),
          TestLLM.testLayer(),
        ),
      ),
      Effect.provide(Logger.layer([])),
    ),
  )
  return spawns - before
}

/** Puts the fixture back to its commit after a session edited it. */
export const resetFixture = () => reset(state.dir)

// ---------- fixtures ----------

// Generated once, outside any benchmark: tens of thousands of files and their first commit take minutes on a
// machine that scans every new file. `bun packages/core/perf/snapshot.ts medium opencode`
if (import.meta.main) {
  await fs.mkdir(root, { recursive: true })
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ["medium"]) {
    const started = performance.now()
    const dir = name === "opencode" ? await cloneOpencode() : await generate(name)
    console.log(`${name}: ${dir} (${((performance.now() - started) / 1000).toFixed(0)} s)`)
  }
}

async function writeMany(files: Array<[string, string]>) {
  const dirs = new Set(files.map(([file]) => path.dirname(file)))
  await Promise.all([...dirs].map((dir) => fs.mkdir(dir, { recursive: true })))
  for (let index = 0; index < files.length; index += 512)
    await Promise.all(files.slice(index, index + 512).map(([file, content]) => Bun.write(file, content)))
}

async function generate(name: string) {
  const fixture = fixtures[name]
  if (!fixture) throw new Error(`unknown fixture ${name}: small, medium, large or opencode`)
  const dir = path.join(root, "fixtures", name)
  if (await Bun.file(path.join(dir, ".bench-ready")).exists()) return dir
  await fs.rm(dir, { recursive: true, force: true })
  console.error(`generating fixture ${name} (${fixture.tracked} tracked, ${fixture.ignored} ignored)`)
  const tracked = Array.from({ length: fixture.tracked }, (_, index) => {
    const file = path.join(dir, "src", `d${index % fixture.dirs}`, `f${index}.ts`)
    return [file, `export const value${index} = ${index}\n`.repeat(8)] as [string, string]
  })
  const ignored = Array.from({ length: fixture.ignored }, (_, index) => {
    const file = path.join(dir, "node_modules", `pkg${index % 500}`, `f${index}.js`)
    return [file, `module.exports = ${index}\n`] as [string, string]
  })
  await writeMany([...tracked, ...ignored, [path.join(dir, ".gitignore"), "node_modules\ndist\n"]])
  await gitInit(dir)
  await Bun.write(path.join(dir, ".bench-ready"), "")
  return dir
}

// This repository, cloned, with a realistic ignored dependency tree instead of a full install.
async function cloneOpencode() {
  const dir = path.join(root, "fixtures", "opencode")
  if (await Bun.file(path.join(dir, ".bench-ready")).exists()) return dir
  await fs.rm(dir, { recursive: true, force: true })
  const source = (await $`git rev-parse --show-toplevel`.cwd(import.meta.dir).text()).trim()
  console.error(`cloning ${source} into fixture opencode`)
  await $`git clone --quiet --local --no-hardlinks ${source} ${dir}`.quiet()
  await writeMany(
    Array.from({ length: 30_000 }, (_, index) => [
      path.join(dir, "node_modules", `pkg${index % 700}`, `f${index}.js`),
      `module.exports = ${index}\n`,
    ]),
  )
  await Bun.write(path.join(dir, ".git", "info", "exclude"), ".bench-ready\n")
  await Bun.write(path.join(dir, ".bench-ready"), "")
  return dir
}

async function gitInit(dir: string) {
  await $`git init -q`.cwd(dir).quiet()
  await Bun.write(path.join(dir, ".git", "info", "exclude"), ".bench-ready\n")
  await $`git -c core.fsmonitor=false -c core.fscache=true -c core.preloadindex=true add -A`.cwd(dir).quiet()
  await $`git -c user.email=bench@opencode.test -c user.name=Bench commit -q --no-gpg-sign -m initial`.cwd(dir).quiet()
}

async function reset(dir: string) {
  await $`git -c core.fsmonitor=false reset -q --hard`.cwd(dir).quiet()
  await $`git -c core.fsmonitor=false clean -qfd`.cwd(dir).quiet()
}

async function trackedSample(dir: string, count: number) {
  const text = await $`git ls-files -z`.cwd(dir).text()
  const files = text.split("\0").filter((file) => file.endsWith(".ts") || file.endsWith(".md"))
  const stride = Math.max(1, Math.floor(files.length / count))
  return Array.from({ length: count }, (_, index) => files[(index * stride) % files.length]!)
}
