import { mkdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"
import { screens, type CaptureId } from "../catalog/authored/screens"
import type { ScreenCategory } from "../catalog/dsl"
import { executeFlow, type ExecutableScenario } from "../catalog/flow"
import { patchSuccessFlow } from "../scenarios/tools/patch-success"
import { executableScenarios } from "../scenarios"
import { catalogScenarioRuntime, catalogViewport } from "../scenarios/runtime"
import type { Variant as CaptureSet } from "../catalog/schema"
import {
  captureSetId,
  captureSetLabel,
  captureMatrixManifest,
  captureSource,
  parseCaptureOptions,
} from "./capture-sets"

type Capture = {
  readonly id: CaptureId
  readonly title: string
  readonly category: ScreenCategory
  readonly frame: {
    readonly variantId: string
    readonly src: string
    readonly cols: number
    readonly rows: number
  }
}

type Variant = {
  readonly id: string
  readonly label: string
  readonly source: string
  readonly revision: string
  readonly ref: string
  readonly committedAt: string
  readonly path: string
  readonly theme?: string
}

const defaultOpenCode = fileURLToPath(new URL("../../../../", import.meta.url))
const options = parseCaptureOptions(process.argv.slice(2), defaultOpenCode)
const processStartedAt = performance.now()
const stagingRoot = fileURLToPath(new URL(`../.tmp/capture-staging/${crypto.randomUUID()}/`, import.meta.url))
const prepared = await prepareCaptureSets(options)
metric("capture_prepare_ms", processStartedAt)
const variants = prepared.variants
let captureSucceeded = false
const lifecycleScenarios = executableScenarios.filter((scenario) => scenario.id !== patchSuccessFlow.id)

const captureVariant = (variant: Variant) => Effect.gen(function* () {
  if (options.flow !== undefined) {
    const selected = executableScenarios.find((scenario) => scenario.id === options.flow)
    if (!selected) {
      const known = executableScenarios.map((scenario) => scenario.id).join(", ")
      return yield* Effect.fail(
        new Error(`Unknown executable flow ${JSON.stringify(options.flow)}. Known flows: ${known}`),
      )
    }
    return yield* captureScenarioProcess(variant, [selected], true)
  }

  const queued = lifecycleScenarios.filter((scenario) => scenario.llmMode === "queue")
  const served = lifecycleScenarios.filter((scenario) => scenario.llmMode === "serve")
  const captures = yield* captureScenarioProcess(variant, [], false, true)
  for (const scenario of queued) {
    captures.push(...(yield* captureScenarioProcess(variant, [scenario])))
  }
  for (const scenario of served) {
    captures.push(...(yield* captureScenarioProcess(variant, [scenario])))
  }
  return captures
})

function captureScenarioProcess(
  variant: Variant,
  scenarios: ReadonlyArray<ExecutableScenario>,
  preview = false,
  baseline = false,
) {
  return OpenCodeDriver.use(
    catalogScenarioRuntime({ opencode: variant.path, theme: variant.theme }),
    (driver) => Effect.gen(function* () {
      const captures = baseline ? [...(yield* captureBaseline(driver, variant))] : []
      const shared = scenarios.filter((scenario) => scenario.clientIsolation === "shared")
      if (shared.length > 0) {
        captures.push(...(yield* captureScenarioClient(driver, variant, shared, preview)))
      }
      for (const scenario of scenarios.filter((candidate) => candidate.clientIsolation === "isolated")) {
        captures.push(...(yield* captureScenarioClient(driver, variant, [scenario], preview)))
      }
      return captures
    }),
  )
}

function captureScenarioClient(
  driver: OpenCodeDriver.Driver,
  variant: Variant,
  scenarios: ReadonlyArray<ExecutableScenario>,
  preview: boolean,
) {
  const clientName = `catalog-${scenarios[0]?.id ?? "empty"}-${scenarios.length}`
  return Effect.acquireUseRelease(
    driver.tuis.launch(clientName, { viewport: catalogViewport }),
    (client) => Effect.gen(function* () {
      const captures: Array<Capture> = []
      for (const scenario of scenarios) {
        yield* openNewSession(client.ui)
        yield* resetProjectFiles(driver)
        const startedAt = performance.now()
        console.error(`Capturing ${scenario.id}`)
        captures.push(...(yield* captureScenario({ ...driver, ui: client.ui }, variant, scenario, preview)))
        metric(`capture_scenario_${scenario.id}_ms`, startedAt)
      }
      return captures
    }),
    (client) => client.close(),
  )
}

const openNewSession = Effect.fn("Catalog.openNewSession")(function* (ui: OpenCodeDriver.Driver["ui"]) {
  yield* ui.press("p", { ctrl: true })
  yield* ui.waitFor("Commands", { timeout: 15_000 })
  yield* ui.type("New session")
  yield* ui.waitFor("New session", { timeout: 15_000 })
  yield* ui.enter()
  yield* ui.waitFor("Ask anything...", { timeout: 15_000 })
})

const captureBaseline = (driver: OpenCodeDriver.Driver, variant: Variant) =>
  Effect.gen(function* () {
      const captures: Capture[] = []
      const outputDirectory = join(stagingRoot, variant.id)
      yield* Effect.promise(() => mkdir(outputDirectory, { recursive: true }))

      const capture = Effect.fn("Catalog.capture")(function* (id: CaptureId) {
        const screen = screens[id]
        const frame = yield* driver.ui.capture()
        const src = `captures/${variant.id}/${id}.frame.json`
        yield* Effect.promise(() =>
          Bun.write(
            join(outputDirectory, `${id}.frame.json`),
            `${JSON.stringify({ format: "opencode-terminal-frame-v1", ...frame })}\n`,
          ),
        )
        captures.push({
          id,
          title: screen.title,
          category: screen.category,
          frame: { variantId: variant.id, src, cols: frame.cols, rows: frame.rows },
        })
      })

      const close = Effect.fn("Catalog.closeDialog")(function* () {
        yield* driver.ui.press("\u001b")
        yield* Effect.sleep(150)
      })

      const openSlash = Effect.fn("Catalog.openSlash")(function* (
        slash: string,
        marker: string,
      ) {
        yield* driver.ui.submit(slash)
        yield* driver.ui.waitFor(marker)
      })

      yield* driver.ui.waitFor((state) => state.elements.length > 0)
      yield* Effect.sleep(400)
      yield* capture("home")

      yield* driver.ui.press("p", { ctrl: true })
      yield* driver.ui.waitFor("Commands")
      yield* capture("command-palette")
      yield* close()

      const dialogs = [
        ["/models", "Select model", "model-picker"],
        ["/agents", "Select agent", "agent-picker"],
        ["/connect", "Connect an integration", "integration-picker"],
        ["/themes", "Themes", "theme-picker"],
        ["/mcps", "MCP servers", "mcp-list"],
        ["/status", "No MCP servers", "status"],
        ["/debug", "Debug", "debug"],
        ["/help", "Press ctrl+p", "help"],
        ["/pair", "Pair", "pair"],
        ["/sessions", "Sessions", "session-picker"],
        ["/skills", "Skills", "skill-picker"],
      ] as const

      for (const [slash, marker, id] of dialogs) {
        yield* openSlash(slash, marker)
        yield* capture(id)
        yield* close()
      }

      yield* executeFlow(patchSuccessFlow, {
        driver,
        capture: (state) => capture(state.id),
      })

      const sessionDialogs = [
        ["/rename", "Rename session", "session-rename"],
        ["/fork", "Full session", "session-fork"],
        ["/export", "Export as", "session-export"],
      ] as const

      for (const [slash, marker, id] of sessionDialogs) {
        yield* openSlash(slash, marker)
        yield* capture(id)
        yield* close()
      }

      yield* driver.llm.queue(
        Llm.toolCall({
          index: 0,
          id: "call_question_capture",
          name: "question",
          input: {
            questions: [
              {
                question: "Which direction should the fixture take?",
                header: "Fixture",
                options: [
                  {
                    label: "Keep it minimal (Recommended)",
                    description: "Small deterministic fixture",
                  },
                  {
                    label: "Expand coverage",
                    description: "Add more scripted states",
                  },
                ],
              },
            ],
          },
        }),
        Llm.finish("tool-calls"),
      )
      yield* driver.llm.queue(Llm.text("Keeping the fixture minimal."))
      yield* driver.ui.submit("Ask me about the fixture direction.")
      yield* driver.ui.waitFor("Permission required", { timeout: 15_000 })
      yield* driver.ui.enter()
      yield* driver.ui.waitFor("Which direction should the fixture take?", { timeout: 15_000 })
      yield* capture("question-prompt")
      yield* driver.ui.enter()
      yield* driver.ui.waitFor("Keeping the fixture minimal.", { timeout: 15_000 })

      yield* openSlash("/rename", "Rename session")
      yield* driver.ui.type("Catalog capture session")
      yield* driver.ui.enter()
      yield* Effect.sleep(300)

      yield* openSlash("/sessions", "Sessions")
      yield* driver.ui.waitFor("Catalog capture session")
      yield* capture("session-picker-populated")
      yield* close()

      yield* driver.ui.type("/copy")
      yield* driver.ui.waitFor("Copy session transcript")
      yield* driver.ui.enter()
      yield* Effect.sleep(600)
      yield* capture("toast-success")
      yield* Effect.sleep(200)

      yield* driver.ui.submit("/share")
      yield* driver.ui.waitFor("Sharing is not implemented for V2 sessions yet")
      yield* capture("toast-error")

      yield* openSlash("/debug", "Debug")
      yield* driver.ui.enter()
      yield* driver.ui.waitFor("Debug info copied to clipboard")
      yield* capture("toast-info")
      yield* close()

      yield* openSlash("/diff", "Diff working tree")
      yield* driver.ui.waitFor("No changes to show")
      yield* capture("diff-viewer")
      yield* close()

      return captures
  })

function captureScenario(
  driver: OpenCodeDriver.Driver,
  variant: Variant,
  scenario: ExecutableScenario,
  preview = false,
) {
  return Effect.gen(function* () {
      const captures: Array<Capture> = []
      yield* scenario.run({
        driver,
        capture: (state) => Effect.gen(function* () {
          if (!isCaptureId(state.id)) {
            return yield* Effect.fail(new Error(`Scenario ${scenario.id} references unknown screen ${state.id}`))
          }
          const id = state.id
          const screen = screens[id]
          const frame = yield* driver.ui.capture()
          const src = preview
            ? `.tmp/capture-runs/${variant.id}/${id}.frame.json`
            : `captures/${variant.id}/${id}.frame.json`
          const output = preview
            ? fileURLToPath(new URL(`../${src}`, import.meta.url))
            : join(stagingRoot, variant.id, `${id}.frame.json`)
          yield* Effect.promise(async () => {
            await mkdir(dirname(output), { recursive: true })
            await Bun.write(
              output,
              `${JSON.stringify({ format: "opencode-terminal-frame-v1", ...frame })}\n`,
            )
          })
          captures.push({
            id,
            title: screen.title,
            category: screen.category,
            frame: { variantId: variant.id, src, cols: frame.cols, rows: frame.rows },
          })
        }),
      })
      return captures
  })
}

const resetProjectFiles = Effect.fn("Catalog.resetProjectFiles")(function* (driver: OpenCodeDriver.Driver) {
  const files = join(driver.artifacts, "files")
  yield* Effect.promise(() => Promise.all([
    Bun.write(join(files, "fixture.txt"), "before\n"),
    rm(join(files, "patched.txt"), { force: true }),
  ]))
})

function isCaptureId(value: string): value is CaptureId {
  return value in screens
}

try {
  const captured = options.workerOutput === undefined && variants.length > 1 && options.jobs > 1
    ? await captureVariantProcesses(options, variants)
    : await Effect.runPromise(Effect.forEach(variants, captureVariant, { concurrency: 1 }))
  const expectedIds = captured[0]?.map((capture) => capture.id) ?? []
  for (const [index, variantCaptures] of captured.entries()) {
    const actualIds = variantCaptures.map((capture) => capture.id)
    if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
      throw new Error(`Variant ${variants[index]?.id ?? index} captured a different ordered screen set`)
    }
  }
  const captures = captured[0]?.map((first) => ({
    id: first.id,
    title: first.title,
    category: first.category,
    frames: captured.flatMap((variantCaptures) =>
      variantCaptures.filter((capture) => capture.id === first.id).map((capture) => capture.frame),
    ) as [Capture["frame"], ...Array<Capture["frame"]>],
  })) ?? []
  if (options.flow !== undefined) {
    for (const capture of captures) {
      for (const frame of capture.frames) console.log(frame.src)
    }
  } else if (options.workerOutput !== undefined) {
    const [variant] = variants
    if (!variant) throw new Error("Capture worker requires one variant")
    const target = join(options.workerOutput, variant.id)
    await rm(target, { recursive: true, force: true })
    await mkdir(options.workerOutput, { recursive: true })
    await rename(join(stagingRoot, variant.id), target)
    await Bun.write(
      join(options.workerOutput, `${variant.id}.json`),
      `${JSON.stringify({ variant: (({ path: _, ...value }) => value)(variant), captures: captured[0] ?? [] })}\n`,
    )
  } else {
    for (const variant of variants) {
      const target = fileURLToPath(new URL(`../public/captures/${variant.id}/`, import.meta.url))
      await rm(target, { recursive: true, force: true })
      await mkdir(dirname(target), { recursive: true })
      await rename(join(stagingRoot, variant.id), target)
    }
    const manifestFile = new URL("../public/drive-captures.json", import.meta.url)
    const captureSets = variants.map(({ path: _, ...variant }) => variant satisfies CaptureSet)
    const manifest = captureMatrixManifest(captureSets, captures)
    await Bun.write(manifestFile, `${JSON.stringify(manifest, undefined, 2)}\n`)
  }
  captureSucceeded = true
} finally {
  metric("capture_total_ms", processStartedAt)
  if (captureSucceeded) await rm(stagingRoot, { recursive: true, force: true })
  else console.error(`Retained staged capture frames: ${stagingRoot}`)
  await prepared.cleanup(captureSucceeded)
}

async function captureVariantProcesses(
  captureOptions: ReturnType<typeof parseCaptureOptions>,
  planned: ReadonlyArray<Variant>,
): Promise<Array<Array<Capture>>> {
  const output = fileURLToPath(new URL(`../.tmp/capture-workers/${crypto.randomUUID()}/`, import.meta.url))
  await mkdir(output, { recursive: true })
  let next = 0
  const results = Array.from<Array<Capture> | undefined>({ length: planned.length })

  await Promise.all(Array.from({ length: Math.min(captureOptions.jobs, planned.length) }, async () => {
    while (true) {
      const index = next++
      const variant = planned[index]
      if (!variant) return
      const args = [
        process.execPath,
        fileURLToPath(import.meta.url),
        "--opencode", captureOptions.opencode,
        "--revision", variant.revision,
        "--theme", variant.theme ?? "default",
        "--jobs", "1",
        "--worker-output", output,
      ]
      const child = Bun.spawn(args, { cwd: fileURLToPath(new URL("..", import.meta.url)), stdout: "inherit", stderr: "inherit" })
      if (await child.exited !== 0) throw new Error(`Capture worker ${variant.id} failed`)
      const result = await Bun.file(join(output, `${variant.id}.json`)).json() as { captures: Array<Capture> }
      results[index] = result.captures
    }
  }))

  for (const variant of planned) {
    const target = join(stagingRoot, variant.id)
    await mkdir(dirname(target), { recursive: true })
    await rename(join(output, variant.id), target)
  }
  await rm(output, { recursive: true, force: true })
  return results.map((result, index) => {
    if (!result) throw new Error(`Capture worker ${planned[index]?.id ?? index} produced no result`)
    return result
  })
}

async function prepareCaptureSets(options: ReturnType<typeof parseCaptureOptions>) {
  const worktrees: Array<string> = []
  const variants: Array<Variant> = []
  const revisions = new Map<string, { ref: string; committedAt: string; path: string }>()

  try {
    for (const ref of options.revisions) {
      const revision = await git(options.opencode, "rev-parse", `${ref}^{commit}`)
      if (revisions.has(revision)) continue
      const committedAt = await git(options.opencode, "show", "-s", "--format=%cI", revision)
      if (ref === "HEAD") {
        revisions.set(revision, { ref, committedAt, path: options.opencode })
        continue
      }
      const path = fileURLToPath(new URL(`../.tmp/capture-worktrees/${revision}/`, import.meta.url))
      const preparedRevision = await preparedWorktreeRevision(path)
      if (options.fresh && preparedRevision !== undefined) {
        await command(["git", "worktree", "remove", "--force", path], options.opencode)
          .catch(() => rm(path, { recursive: true, force: true }))
      }
      if (options.fresh || preparedRevision !== revision) {
        if (preparedRevision !== undefined) {
          await command(["git", "worktree", "remove", "--force", path], options.opencode)
            .catch(() => rm(path, { recursive: true, force: true }))
        }
        await mkdir(dirname(path), { recursive: true })
        await command(["git", "worktree", "add", "--detach", path, revision], options.opencode)
        // Bun can reuse another Git worktree's install state without creating local links.
        await command(["bun", "install", "--frozen-lockfile", "--force"], path)
      }
      worktrees.push(path)
      revisions.set(revision, { ref, committedAt, path })
    }

    for (const [revision, preparedRevision] of revisions) {
      for (const theme of options.themes) {
        variants.push({
          id: captureSetId(revision, theme, revisions.size > 1),
          label: captureSetLabel(revision, theme),
          source: captureSource(options.opencode),
          revision,
          ref: preparedRevision.ref,
          committedAt: preparedRevision.committedAt,
          path: preparedRevision.path,
          ...(theme === undefined ? {} : { theme }),
        })
      }
    }
  } catch (error) {
    await cleanup()
    throw error
  }

  return { variants, cleanup }

  async function cleanup(_succeeded = false) {
    for (const path of worktrees) console.error(`Prepared capture worktree: ${path}`)
  }
}

async function preparedWorktreeRevision(path: string) {
  if (!(await Bun.file(join(path, ".git")).exists())) return undefined
  return git(path, "rev-parse", "HEAD").catch(() => undefined)
}

function metric(name: string, startedAt: number) {
  console.log(`METRIC ${name}=${Math.round(performance.now() - startedAt)}`)
}

async function git(cwd: string, ...args: ReadonlyArray<string>): Promise<string> {
  return (await command(["git", ...args], cwd)).trim()
}

async function command(argv: ReadonlyArray<string>, cwd: string): Promise<string> {
  const process = Bun.spawn([...argv], { cwd, stdout: "pipe", stderr: "inherit" })
  const output = await new Response(process.stdout).text()
  if (await process.exited !== 0) throw new Error(`${argv.join(" ")} failed`)
  return output
}
