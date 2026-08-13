import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import * as Effect from "effect/Effect"
import { createScriptFileSystem } from "../script/filesystem.js"
import { commitScriptProject, hasGitMetadata, initializeScriptProject } from "../script/project.js"
import type { OpenCodeConfig, OpenCodeTuiConfig, Project, Setup } from "../project.js"

export function artifactDirectory() {
  return resolve(join(tmpdir(), "opencode-drive"))
}

export async function initializeInstance(name?: string) {
  const artifacts = resolve(join(artifactDirectory(), `run-${crypto.randomUUID()}`))
  const logs = join(artifacts, "logs")
  const drive = join(artifacts, "drive")
  await Promise.all([
    mkdir(logs, { recursive: true }),
    mkdir(drive, { recursive: true }),
    mkdir(join(artifacts, "home", ".cache"), { recursive: true }),
    mkdir(join(artifacts, "home", ".config"), { recursive: true }),
    mkdir(join(artifacts, "home", ".local", "share"), { recursive: true }),
    mkdir(join(artifacts, "home", ".local", "state"), { recursive: true }),
  ])
  const files = join(artifacts, "files")
  const defaultConfig = await Bun.file(new URL("./default-config.jsonc", import.meta.url)).text()
  await Promise.all([
    mkdir(join(files, ".git"), { recursive: true }),
    mkdir(join(files, ".opencode"), { recursive: true }),
    mkdir(join(files, "src"), { recursive: true }),
  ])
  await Promise.all([
    Bun.write(join(files, ".opencode", "opencode.jsonc"), defaultConfig),
    Bun.write(join(files, "src", "garden.js"), "export function greet(name) {\n  return `Hello, ${name}.`\n}\n"),
    ...(name ? [Bun.write(join(drive, "name"), `${name}\n`)] : []),
  ])
  return artifacts
}

export const prepareInstanceProject = Effect.fn("OpenCodeInstance.prepareProject")(function* (options: {
  readonly artifacts: string
  readonly project?: Project
  readonly config?: OpenCodeConfig
  readonly tui?: OpenCodeTuiConfig
  readonly setup?: Setup
}) {
  const files = join(resolve(options.artifacts), "files")
  const configPath = join(files, ".opencode", "opencode.jsonc")
  const tuiPath = join(files, ".opencode", "tui.jsonc")
  const project = options.project
  if (project) yield* promise(() => initializeScriptProject(files, project))
  const [config, tui] = yield* Effect.all(
    [promise(() => readConfig(configPath, "opencode.jsonc")), promise(() => readConfig(tuiPath, "tui.jsonc", {}))],
    { concurrency: "unbounded" },
  )
  deepMerge(config, options.config)
  deepMerge(tui, options.tui)
  if (options.setup !== undefined) {
    const protectGit = Boolean(options.project?.git) || (yield* promise(() => hasGitMetadata(files)))
    const setup: Effect.Effect<void, unknown> = options.setup({
      fs: createScriptFileSystem(files, { git: protectGit }),
      config,
      tuiConfig: tui,
    })
    if (!Effect.isEffect(setup)) return yield* Effect.fail(new Error("setup must return an Effect"))
    yield* setup
  }
  yield* Effect.all(
    [
      promise(() => Bun.write(configPath, `${JSON.stringify(config, undefined, 2)}\n`)),
      promise(() => Bun.write(tuiPath, `${JSON.stringify(tui, undefined, 2)}\n`)),
    ],
    { concurrency: "unbounded" },
  )
  if (options.project?.git) yield* promise(() => commitScriptProject(files))
  return undefined
})

const promise = <A>(evaluate: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })

async function readConfig(path: string, name: string, fallback?: OpenCodeConfig): Promise<OpenCodeConfig> {
  const file = Bun.file(path)
  let value: unknown
  try {
    value = (await file.exists())
      ? Bun.JSONC.parse(await file.text())
      : (fallback ?? Bun.JSONC.parse(await Bun.file(new URL("./default-config.jsonc", import.meta.url)).text()))
  } catch (cause) {
    throw new Error(`invalid .opencode/${name}`, { cause })
  }
  if (!isJsonObject(value)) throw new Error(`invalid .opencode/${name}: expected a JSON object`)
  return value
}

function deepMerge(target: OpenCodeConfig, source: OpenCodeConfig | undefined) {
  if (source === undefined) return target
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key]
    if (isJsonObject(existing) && isJsonObject(value)) {
      deepMerge(existing, value)
    } else {
      target[key] = structuredClone(value)
    }
  }
  return target
}

function isJsonObject(value: unknown): value is OpenCodeConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
