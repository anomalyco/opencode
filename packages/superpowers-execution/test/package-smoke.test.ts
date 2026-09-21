import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Plugin } from "@opencode/plugin/promise/plugin"
import {
  buildStagedPackage,
  createWorkingDirectory,
  importStagedContractInBrowser,
  removeWorkingDirectory,
  repositoryRoot,
  runDisposableHostGate,
} from "../script/package-smoke"
import type { RunSnapshot, RunSummary } from "../src/schema"
import { fixtureStart, memoryStorage, pluginHarness } from "./fixtures"

const root = { sessionID: "root" }
const rootSession = { id: "root" }
const temporaryRoots: string[] = []

afterEach(() => {
  temporaryRoots.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }))
})

function temporaryOutput(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-stager-output-"))
  temporaryRoots.push(directory)
  return path.join(directory, "package")
}

async function stagedPlugin(directory: string): Promise<Plugin> {
  const loaded = await import(pathToFileURL(path.join(directory, "index.js")).href)
  return loaded.default as Plugin
}

test("staged contract is browser-safe and package is self-contained", async () => {
  const artifact = await buildStagedPackage({ directory: temporaryOutput() })
  const browserSentinel = path.join(artifact.directory, ".browser/keep.txt")
  fs.mkdirSync(path.dirname(browserSentinel))
  fs.writeFileSync(browserSentinel, "keep")
  expect(
    Object.values(artifact.manifest.dependencies).some((value) => /^(workspace:|catalog:)/.test(String(value))),
  ).toBe(false)
  const result = await importStagedContractInBrowser(artifact)
  expect(result.rpcID).toBe("superpowers.execution.v1")
  expect(result.serverModulesLoaded).toEqual([])
  expect(fs.readFileSync(browserSentinel, "utf8")).toBe("keep")
})

test("staged runtime dependencies are self-contained copies outside the repository", async () => {
  const artifact = await buildStagedPackage({ directory: temporaryOutput() })
  const staged = fs.realpathSync(artifact.directory)
  const repository = fs.realpathSync(repositoryRoot)
  const names = Object.keys(artifact.manifest.dependencies).sort()
  expect(names).toEqual(["@opencode/plugin", "@opencode/schema", "zod"])

  for (const name of names) {
    const resolved = fs.realpathSync(artifact.dependencyPaths[name] ?? "")
    expect(resolved.startsWith(repository + path.sep)).toBe(false)
    expect(resolved.startsWith(staged + path.sep)).toBe(true)
    expect(fs.lstatSync(path.join(artifact.directory, "node_modules", name)).isSymbolicLink()).toBe(false)
    const installed = JSON.parse(fs.readFileSync(resolved, "utf8")) as { readonly version?: string }
    expect(installed.version).toBe(artifact.manifest.dependencies[name])
  }
})

test("the stager rejects unsafe targets before deleting anything", async () => {
  const pluginSource = path.join(repositoryRoot, "packages/superpowers-execution/src/plugin.ts")
  const repositoryManifest = path.join(repositoryRoot, "package.json")
  const nestedTarget = path.join(repositoryRoot, "packages/superpowers-execution/.stage-guard")
  const homeSentinel = path.join(os.homedir(), `.opencode-stager-home-${crypto.randomUUID()}`)
  fs.writeFileSync(homeSentinel, "keep")

  try {
    await expect(buildStagedPackage({ directory: repositoryRoot })).rejects.toThrow(/inside the repository/)
    await expect(buildStagedPackage({ directory: path.dirname(pluginSource) })).rejects.toThrow(/inside the repository/)
    await expect(buildStagedPackage({ directory: nestedTarget })).rejects.toThrow(/inside the repository/)
    await expect(buildStagedPackage({ directory: path.parse(repositoryRoot).root })).rejects.toThrow(/filesystem root/)
    await expect(buildStagedPackage({ directory: os.homedir() })).rejects.toThrow(/home directory root/)

    expect(fs.existsSync(pluginSource)).toBe(true)
    expect(fs.existsSync(repositoryManifest)).toBe(true)
    expect(fs.existsSync(nestedTarget)).toBe(false)
    expect(fs.readFileSync(homeSentinel, "utf8")).toBe("keep")
  } finally {
    fs.rmSync(homeSentinel, { force: true })
  }
})

test("the stager refuses every pre-existing output without deleting it", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-stager-empty-"))
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-stager-foreign-"))
  temporaryRoots.push(empty, foreign)
  fs.writeFileSync(path.join(foreign, "keep.txt"), "keep")

  await expect(buildStagedPackage({ directory: empty })).rejects.toThrow(/remove it manually/)
  await expect(buildStagedPackage({ directory: foreign })).rejects.toThrow(/remove it manually/)
  expect(fs.readdirSync(empty)).toEqual([])
  expect(fs.readFileSync(path.join(foreign, "keep.txt"), "utf8")).toBe("keep")

  const output = temporaryOutput()
  await buildStagedPackage({ directory: output })
  fs.writeFileSync(path.join(output, "keep.txt"), "keep")
  await expect(buildStagedPackage({ directory: output })).rejects.toThrow(/remove it manually/)
  expect(fs.readFileSync(path.join(output, "keep.txt"), "utf8")).toBe("keep")
  expect(fs.existsSync(path.join(output, "dist/plugin.js"))).toBe(true)
})

test("the stager rejects a symlinked-ancestor alias into the repository without deleting", async () => {
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-stager-alias-"))
  try {
    const packageSource = fs.realpathSync(path.join(repositoryRoot, "packages/superpowers-execution"))
    fs.symlinkSync(packageSource, path.join(aliasRoot, "into-repo"), "dir")
    const target = path.join(aliasRoot, "into-repo", ".stage-alias-guard")

    await expect(buildStagedPackage({ directory: target })).rejects.toThrow(/inside the repository/)
    expect(fs.existsSync(path.join(packageSource, "src/plugin.ts"))).toBe(true)
    expect(fs.existsSync(target)).toBe(false)
  } finally {
    fs.rmSync(aliasRoot, { recursive: true, force: true })
  }
})

test("a symlinked output alias into the repository is rejected without touching its target", async () => {
  const packageDirectory = path.join(repositoryRoot, "packages/superpowers-execution")
  const inside = fs.mkdtempSync(path.join(packageDirectory, ".stage-alias-"))
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-stager-alias-"))
  try {
    fs.writeFileSync(path.join(inside, "keep.txt"), "keep")
    const alias = path.join(aliasRoot, "marked")
    fs.symlinkSync(inside, alias, "dir")

    await expect(buildStagedPackage({ directory: alias })).rejects.toThrow(/inside the repository/)
    expect(fs.readFileSync(path.join(inside, "keep.txt"), "utf8")).toBe("keep")
  } finally {
    fs.rmSync(aliasRoot, { recursive: true, force: true })
    fs.rmSync(inside, { recursive: true, force: true })
  }
})

test("working directory cleanup is bound to the mkdtemp directory identity", async () => {
  const working = await createWorkingDirectory()
  const moved = `${working.directory}-moved`
  try {
    fs.renameSync(working.directory, moved)
    fs.mkdirSync(working.directory)
    fs.writeFileSync(path.join(working.directory, "keep.txt"), "keep")

    await expect(removeWorkingDirectory(working)).rejects.toThrow(/identity changed/)
    expect(fs.readFileSync(path.join(working.directory, "keep.txt"), "utf8")).toBe("keep")
    expect(fs.existsSync(moved)).toBe(true)
  } finally {
    fs.rmSync(working.directory, { recursive: true, force: true })
    fs.rmSync(moved, { recursive: true, force: true })
  }
})

test("the staged package directory entry loads its built plugin and its dist-relative reporting skill", async () => {
  const artifact = await buildStagedPackage({ directory: temporaryOutput() })
  const harness = await pluginHarness({ sessions: [rootSession], plugin: await stagedPlugin(artifact.directory) })

  expect(harness.definition.id).toBe("superpowers.execution.v1")
  expect(harness.registrations()).toEqual({ rpc: 1, toolTransforms: 1, skillTransforms: 1, sessionHooks: 1 })

  const skill = harness.skills()[0]
  expect(skill).toBeDefined()
  expect(String(skill?.id)).toBe("superpowers-execution-reporting")
  expect(String(skill?.path)).toContain(path.join(artifact.directory, "skills"))
  expect((skill?.content ?? "").length).toBeGreaterThan(0)

  await harness.dispose()
})

test("the staged built plugin installs, reports, serves getRun, unloads, reloads, and recovers stored state", async () => {
  const artifact = await buildStagedPackage({ directory: temporaryOutput() })
  const plugin = await stagedPlugin(artifact.directory)
  const storage = memoryStorage()
  const sessions = [rootSession]

  const installed = await pluginHarness({ sessions, storage, plugin })
  const reported = await installed.callTool<{ run: RunSnapshot; appliedRevision: number }>(
    "execution_report",
    fixtureStart(),
    root,
  )
  expect(reported.ok).toBe(true)
  if (!reported.ok) return
  expect(reported.value.run.runID).toBe("run-1")

  const stored = await installed.callRpc<RunSnapshot>("getRun", { rootSessionID: "root", runID: "run-1" })
  expect(stored.ok).toBe(true)
  if (!stored.ok) return
  expect(stored.value.revision).toBe(1)
  expect(installed.storage.writes()).toBe(1)

  await installed.dispose()
  const unloaded = await installed.callRpc("capabilities", {})
  expect(unloaded.ok).toBe(false)
  if (unloaded.ok) return
  expect(unloaded.failure.type).toBe("rpc.method_not_found")

  const reloaded = await pluginHarness({ sessions, storage, plugin })
  const capabilities = await reloaded.callRpc<{ pluginVersion: string }>("capabilities", {})
  expect(capabilities.ok).toBe(true)
  if (!capabilities.ok) return
  expect(capabilities.value.pluginVersion).toBe("0.1.0")

  const recovered = await reloaded.callRpc<RunSnapshot>("getRun", { rootSessionID: "root", runID: "run-1" })
  expect(recovered.ok).toBe(true)
  if (!recovered.ok) return
  expect(recovered.value.rootSessionID).toBe("root")
  expect(recovered.value.status).toBe("active")

  const summaries = await reloaded.callRpc<{ items: RunSummary[] }>("getSummaries", { rootSessionIDs: ["root"] })
  expect(summaries.ok).toBe(true)
  if (!summaries.ok) return
  expect(summaries.value.items.map((item) => item.runID)).toEqual(["run-1"])

  await reloaded.dispose()
})

test.skipIf(process.env.EXECUTION_PACKAGE_HOST_SMOKE !== "1")(
  "the built package directory loads in a disposable 2.0.11 host and survives an isolated restart",
  async () => {
    const artifact = await buildStagedPackage({ directory: temporaryOutput() })
    const result = await runDisposableHostGate(artifact)
    expect(result.first.pluginVersion).toBe("0.1.0")
    expect(result.first.runCount).toBe(0)
    expect(result.restarted.pluginVersion).toBe("0.1.0")
    expect(result.restarted.runCount).toBe(0)
  },
  180_000,
)
