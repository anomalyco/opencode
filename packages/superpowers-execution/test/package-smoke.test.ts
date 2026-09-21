import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Plugin } from "@opencode/plugin/promise/plugin"
import {
  buildStagedPackage,
  importStagedContractInBrowser,
  repositoryRoot,
  runDisposableHostGate,
} from "../script/package-smoke"
import type { RunSnapshot, RunSummary } from "../src/schema"
import { fixtureStart, memoryStorage, pluginHarness } from "./fixtures"

const root = { sessionID: "root" }
const rootSession = { id: "root" }

async function stagedPlugin(directory: string): Promise<Plugin> {
  const loaded = await import(pathToFileURL(path.join(directory, "index.js")).href)
  return loaded.default as Plugin
}

test("staged contract is browser-safe and package is self-contained", async () => {
  const artifact = await buildStagedPackage()
  expect(
    Object.values(artifact.manifest.dependencies).some((value) => /^(workspace:|catalog:)/.test(String(value))),
  ).toBe(false)
  const result = await importStagedContractInBrowser(artifact)
  expect(result.rpcID).toBe("superpowers.execution.v1")
  expect(result.serverModulesLoaded).toEqual([])
})

test("staged runtime dependencies are self-contained copies outside the repository", async () => {
  const artifact = await buildStagedPackage()
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

  await expect(buildStagedPackage({ directory: repositoryRoot })).rejects.toThrow(/inside the repository/)
  await expect(buildStagedPackage({ directory: path.dirname(pluginSource) })).rejects.toThrow(/inside the repository/)
  await expect(buildStagedPackage({ directory: nestedTarget })).rejects.toThrow(/inside the repository/)
  await expect(buildStagedPackage({ directory: os.homedir() })).rejects.toThrow(/home directory root/)

  expect(fs.existsSync(pluginSource)).toBe(true)
  expect(fs.existsSync(repositoryManifest)).toBe(true)
  expect(fs.existsSync(nestedTarget)).toBe(false)
})

test("the stager refuses to delete a directory it does not own", async () => {
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-stager-guard-"))
  fs.writeFileSync(path.join(foreign, "keep.txt"), "keep")

  await expect(buildStagedPackage({ directory: foreign })).rejects.toThrow(/does not own/)
  expect(fs.readFileSync(path.join(foreign, "keep.txt"), "utf8")).toBe("keep")

  fs.rmSync(foreign, { recursive: true, force: true })
})

test("the staged package directory entry loads its built plugin and its dist-relative reporting skill", async () => {
  const artifact = await buildStagedPackage()
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
  const artifact = await buildStagedPackage()
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
    const artifact = await buildStagedPackage()
    const result = await runDisposableHostGate(artifact)
    expect(result.first.pluginVersion).toBe("0.1.0")
    expect(result.first.runCount).toBe(0)
    expect(result.restarted.pluginVersion).toBe("0.1.0")
    expect(result.restarted.runCount).toBe(0)
  },
  180_000,
)
