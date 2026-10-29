/**
 * Snapshot benchmark + robustness probe.
 *
 *   bun run script/benchmark-snapshot.ts [--fixtures small,medium,large,opencode] [--iterations 10] [--json out.json]
 *
 * Fixtures are generated once under $TMPDIR/opencode-snapshot-bench and reset before each run.
 * Every timed scenario also reports how many git processes it spawned.
 */
import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer, Logger } from "effect"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Git } from "../src/git"
import { Location } from "../src/location"
import { AbsolutePath, RelativePath } from "../src/schema"
import { Snapshot } from "../src/snapshot"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"

const args = process.argv.slice(2)
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}
const iterations = Number(flag("iterations") ?? 10)
const selected = (flag("fixtures") ?? "small,medium,large,opencode").split(",")
const jsonOut = flag("json")
const root = path.join(process.env.SNAPSHOT_BENCH_ROOT ?? os.tmpdir(), "opencode-snapshot-bench")

type Fixture = { name: string; tracked: number; ignored: number; dirs: number }
const fixtures: Record<string, Fixture> = {
  small: { name: "small", tracked: 1_000, ignored: 0, dirs: 20 },
  medium: { name: "medium", tracked: 20_000, ignored: 20_000, dirs: 400 },
  large: { name: "large", tracked: 100_000, ignored: 50_000, dirs: 2_000 },
}

// ---------- fixture generation ----------

async function writeMany(files: Array<[string, string]>) {
  const dirs = new Set(files.map(([file]) => path.dirname(file)))
  await Promise.all([...dirs].map((dir) => fs.mkdir(dir, { recursive: true })))
  for (let index = 0; index < files.length; index += 512)
    await Promise.all(files.slice(index, index + 512).map(([file, content]) => Bun.write(file, content)))
}

async function generate(fixture: Fixture) {
  const dir = path.join(root, "fixtures", fixture.name)
  if (await Bun.file(path.join(dir, ".bench-ready")).exists()) return dir
  await fs.rm(dir, { recursive: true, force: true })
  console.error(`generating fixture ${fixture.name} (${fixture.tracked} tracked, ${fixture.ignored} ignored)`)
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

async function cloneOpencode() {
  const dir = path.join(root, "fixtures", "opencode")
  if (await Bun.file(path.join(dir, ".bench-ready")).exists()) return dir
  await fs.rm(dir, { recursive: true, force: true })
  const source = (await $`git rev-parse --show-toplevel`.cwd(import.meta.dir).text()).trim()
  console.error(`cloning ${source} into fixture opencode`)
  await $`git clone --quiet --local --no-hardlinks ${source} ${dir}`.quiet()
  // A realistic ignored dependency tree without paying for a full install.
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
  await $`git -c core.fsmonitor=false add -A`.cwd(dir).quiet()
  await $`git -c user.email=bench@opencode.test -c user.name=Bench commit -q --no-gpg-sign -m initial`.cwd(dir).quiet()
}

async function reset(dir: string) {
  await $`git -c core.fsmonitor=false reset -q --hard`.cwd(dir).quiet()
  await $`git -c core.fsmonitor=false clean -qfd`.cwd(dir).quiet()
}

// ---------- harness ----------

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

function snapshotLayer(data: string, directory: string) {
  return AppNodeBuilder.build(Snapshot.node, [
    Location.node.replace(Location.boundNode(Location.Ref.make({ directory: AbsolutePath.make(directory) }))),
    Global.node.replace(Global.layerWith({ data, config: path.join(data, "config") })),
    AppProcess.node.replace(countingProcess),
  ])
}

type Sample = { ms: number; spawns: number }
const results: Array<{ fixture: string; scenario: string; samples: Sample[] }> = []

const time = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const before = spawns
    const start = performance.now()
    const value = yield* effect
    return { value, sample: { ms: performance.now() - start, spawns: spawns - before } }
  })

function record(fixture: string, scenario: string, samples: Sample[]) {
  results.push({ fixture, scenario, samples })
  const sorted = samples.map((sample) => sample.ms).toSorted((a, b) => a - b)
  const p = (value: number) => sorted[Math.min(Math.ceil(sorted.length * value) - 1, sorted.length - 1)] ?? 0
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length
  const spawned = samples.reduce((total, sample) => total + sample.spawns, 0) / samples.length
  console.log(
    `${fixture.padEnd(9)} ${scenario.padEnd(22)} p50 ${p(0.5).toFixed(1).padStart(8)} ms  mean ${mean
      .toFixed(1)
      .padStart(8)} ms  max ${(sorted.at(-1) ?? 0).toFixed(1).padStart(8)} ms  git ${spawned.toFixed(1).padStart(5)}`,
  )
}

const edit = (dir: string, files: string[], tag: string) =>
  Effect.promise(() => Promise.all(files.map((file) => Bun.write(path.join(dir, file), `// ${tag}\n${file}\n`))))

function trackedSample(dir: string, count: number) {
  return $`git ls-files -z`
    .cwd(dir)
    .text()
    .then((text) => {
      const files = text.split("\0").filter((file) => file.endsWith(".ts") || file.endsWith(".md"))
      const stride = Math.max(1, Math.floor(files.length / count))
      return Array.from({ length: count }, (_, index) => files[(index * stride) % files.length]!)
    })
}

const repeat = <A, E, R>(count: number, effect: (index: number) => Effect.Effect<Sample, E, R>) =>
  Effect.forEach(
    Array.from({ length: count }, (_, index) => index),
    effect,
  )

async function bench(name: string, dir: string) {
  await reset(dir)
  const data = await fs.mkdtemp(path.join(root, "data-"))
  const sample = await trackedSample(dir, 100)
  const program = Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const capture = snapshot
      .capture()
      .pipe(Effect.flatMap((id) => (id ? Effect.succeed(id) : Effect.die(new Error("capture returned undefined")))))

    const cold = yield* time(capture)
    record(name, "capture cold", [cold.sample])

    record(
      name,
      "capture clean",
      yield* repeat(iterations, () => time(capture).pipe(Effect.map((result) => result.sample))),
    )

    record(
      name,
      "capture edit 1",
      yield* repeat(iterations, (index) =>
        edit(dir, [sample[0]!], `edit-${index}`).pipe(
          Effect.andThen(time(capture)),
          Effect.map((result) => result.sample),
        ),
      ),
    )

    record(
      name,
      "capture add 1",
      yield* repeat(iterations, (index) =>
        edit(dir, [`src/new-${index}.ts`], "new").pipe(
          Effect.andThen(time(capture)),
          Effect.map((result) => result.sample),
        ),
      ),
    )

    const before = yield* capture
    const edited = yield* repeat(Math.max(3, Math.ceil(iterations / 2)), (index) =>
      edit(dir, sample, `bulk-${index}`).pipe(
        Effect.andThen(time(capture)),
        Effect.map((result) => result.sample),
      ),
    )
    record(name, "capture edit 100", edited)
    const after = yield* capture

    record(
      name,
      "files (100 changed)",
      yield* repeat(iterations, () =>
        time(snapshot.files({ from: before, to: after })).pipe(Effect.map((result) => result.sample)),
      ),
    )
    record(
      name,
      "diff (100 changed)",
      yield* repeat(iterations, () =>
        time(snapshot.diff({ from: before, to: after })).pipe(Effect.map((result) => result.sample)),
      ),
    )
    const plan = new Map(sample.map((file) => [RelativePath.make(file), before] as const))
    record(
      name,
      "restore 100",
      yield* repeat(Math.max(3, Math.ceil(iterations / 2)), (index) =>
        edit(dir, sample, `restore-${index}`).pipe(
          Effect.andThen(time(snapshot.restore({ files: plan }))),
          Effect.map((result) => result.sample),
        ),
      ),
    )

    // A read-mostly agent loop under the step policy: capture at attempt start, capture at settlement,
    // then list changed files. One step in five edits two files.
    const steps = yield* repeat(20, (index) =>
      Effect.gen(function* () {
        const before = spawns
        const start = performance.now()
        const from = yield* capture
        if (index % 5 === 0) yield* edit(dir, [sample[index]!, sample[index + 1]!], `step-${index}`)
        const to = yield* capture
        if (from !== to) yield* snapshot.files({ from, to })
        return { ms: performance.now() - start, spawns: spawns - before }
      }),
    )
    record(name, "step loop (per step)", steps)
  }).pipe(Effect.provide(snapshotLayer(data, dir)))
  await Effect.runPromise(program.pipe(Effect.provide(Logger.layer([]))))
  await reset(dir)
  const store = (await $`find ${path.join(data, "snapshot")} -mindepth 2 -maxdepth 2 -type d`.text()).trim()
  const before = Number((await $`du -sk ${store}`.text()).split("\t")[0])
  const started = performance.now()
  await Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git.Service
      // The baseline worktree predates object packing.
      if (!("objects" in git)) return
      yield* git.objects.pack(
        new Git.Repository({
          worktree: AbsolutePath.make(dir),
          gitDirectory: AbsolutePath.make(store),
          commonDirectory: AbsolutePath.make(store),
        }),
      )
    }).pipe(Effect.provide(AppNodeBuilder.build(Git.node)), Effect.provide(Logger.layer([]))),
  )
  const after = Number((await $`du -sk ${store}`.text()).split("\t")[0])
  console.log(
    `${name.padEnd(9)} packing                ${before} KiB -> ${after} KiB in ${(performance.now() - started).toFixed(0)} ms`,
  )
  const size = await $`du -sk ${data}`.text()
  const loose = (await $`find ${data}/snapshot -path '*/objects/??/*' -type f`.text()).split("\n").filter(Boolean)
  const files = (await $`find ${data}/snapshot -maxdepth 3 -type f`.text()).split("\n").filter(Boolean)
  console.log(
    `${name.padEnd(9)} snapshot store         ${size.split("\t")[0]} KiB, ${loose.length} loose objects, top-level files: ${files.map((file) => path.basename(file)).join(" ")}`,
  )
  await fs.rm(data, { recursive: true, force: true })
}

// ---------- robustness probes ----------

async function probe(label: string, run: () => Promise<boolean>) {
  const ok = await run().catch((error) => {
    console.error(error)
    return false
  })
  console.log(`probe     ${label.padEnd(44)} ${ok ? "PASS" : "FAIL"}`)
  results.push({ fixture: "probe", scenario: label, samples: [{ ms: ok ? 1 : 0, spawns: 0 }] })
}

async function withRepo<A>(setup: (dir: string) => Promise<void>, body: (dir: string, data: string) => Promise<A>) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(root, "probe-")))
  const project = path.join(dir, "project")
  await fs.mkdir(project)
  await setup(project)
  await gitInit(project)
  const result = await body(project, path.join(dir, "data"))
  await fs.rm(dir, { recursive: true, force: true })
  return result
}

const captureOnce = (data: string, directory: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      return yield* snapshot.capture()
    }).pipe(Effect.provide(snapshotLayer(data, directory)), Effect.provide(Logger.layer([]))),
  )

async function snapshotGitDir(data: string) {
  const projects = await fs.readdir(path.join(data, "snapshot"))
  const project = path.join(data, "snapshot", projects[0]!)
  return path.join(project, (await fs.readdir(project))[0]!)
}

async function probes() {
  await probe("capture self-heals a zeroed index", () =>
    withRepo(
      (dir) => Bun.write(path.join(dir, "a.txt"), "a\n").then(() => {}),
      async (dir, data) => {
        await captureOnce(data, dir)
        const gitDir = await snapshotGitDir(data)
        await Bun.write(path.join(gitDir, "index"), new Uint8Array(1024))
        await Bun.write(path.join(dir, "a.txt"), "b\n")
        return (await captureOnce(data, dir)) !== undefined
      },
    ),
  )

  await probe("capture survives a stale index.lock", () =>
    withRepo(
      (dir) => Bun.write(path.join(dir, "a.txt"), "a\n").then(() => {}),
      async (dir, data) => {
        await captureOnce(data, dir)
        const gitDir = await snapshotGitDir(data)
        await Bun.write(path.join(gitDir, "index.lock"), "")
        await Bun.write(path.join(dir, "a.txt"), "b\n")
        return (await captureOnce(data, dir)) !== undefined
      },
    ),
  )

  await probe("capture works in a `..scope` directory", () =>
    withRepo(
      (dir) => Bun.write(path.join(dir, "..scope", "a.txt"), "a\n").then(() => {}),
      async (dir, data) => (await captureOnce(data, path.join(dir, "..scope"))) !== undefined,
    ),
  )

  await probe("two processes capture concurrently (4x25)", () =>
    withRepo(
      (dir) => writeMany(Array.from({ length: 2000 }, (_, i) => [path.join(dir, `d${i % 20}`, `f${i}.txt`), `${i}\n`])),
      async (dir, data) => {
        await captureOnce(data, dir)
        const worker = path.join(import.meta.dir, "benchmark-snapshot-worker.ts")
        const outputs = await Promise.all(
          Array.from({ length: 4 }, (_, id) => $`bun run ${worker} ${data} ${dir} ${id} 25`.nothrow().quiet()),
        )
        const failures = outputs.map((output) => Number(output.stdout.toString().trim() || "25"))
        console.log(`          concurrent capture failures per process: ${failures.join(", ")}`)
        return failures.every((count) => count === 0)
      },
    ),
  )
}

await fs.mkdir(root, { recursive: true })
for (const name of selected) {
  if (name === "probes") continue
  const dir = name === "opencode" ? await cloneOpencode() : await generate(fixtures[name]!)
  await bench(name, dir)
}
if (selected.includes("probes") || !flag("fixtures")) await probes()
if (jsonOut) await Bun.write(jsonOut, JSON.stringify(results, null, 2))
