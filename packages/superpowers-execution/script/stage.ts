import { cp, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildPackage, packageRoot } from "./build"

export const repositoryRoot = path.resolve(packageRoot, "..", "..")
export const stagedPackageDirectory = path.join(os.tmpdir(), "opencode", "superpowers-execution-package")

export interface StagedManifest {
  readonly name: string
  readonly version: string
  readonly description: string
  readonly type: "module"
  readonly license: string
  readonly main: string
  readonly exports: Record<string, string>
  readonly files: readonly string[]
  readonly dependencies: Record<string, string>
}

export interface StagedPackage {
  readonly directory: string
  readonly manifest: StagedManifest
  readonly dependencyPaths: Record<string, string>
}

export interface WorkingDirectory {
  readonly base: string
  readonly directory: string
  readonly dev: string
  readonly ino: string
}

export async function buildStagedPackage(options: { readonly directory?: string } = {}): Promise<StagedPackage> {
  const requested = path.resolve(options.directory ?? stagedPackageDirectory)
  const output = await availableOutput(requested)
  await buildPackage()
  const working = await createWorkingDirectory()

  try {
    const manifest = await composeManifest()
    await copyPackageFiles(working.directory)
    await writeFile(path.join(working.directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    await installRuntimeDependencies(working.directory)
    await verifySelfContained(working.directory, manifest)
    const current = await availableOutput(requested)
    if (current !== output) throw new Error(`refusing to stage because the output path changed: ${requested}`)
    await publishStagedPackage(working.directory, output)
    const dependencyPaths = await verifyPublishedPackage(output, manifest)
    return { directory: output, manifest, dependencyPaths }
  } finally {
    await removeWorkingDirectory(working)
  }
}

async function physicalPath(target: string): Promise<string> {
  const remainder: string[] = []
  let current = path.resolve(target)
  while (true) {
    try {
      return path.join(await realpath(current), ...remainder)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.join(current, ...remainder)
      remainder.unshift(path.basename(current))
      current = parent
    }
  }
}

async function availableOutput(target: string): Promise<string> {
  const output = await physicalPath(target)
  await assertOutsideRepository(output)
  if ((await lstat(output).catch(notFound)) !== undefined) {
    throw new Error(`refusing to stage to existing output ${output}; remove it manually before retrying`)
  }
  return output
}

async function assertOutsideRepository(target: string): Promise<void> {
  const repository = await realpath(repositoryRoot)
  if (within(repository, target)) throw new Error(`refusing to stage inside the repository: ${target}`)
  if (target === path.parse(target).root) throw new Error(`refusing to stage at the filesystem root: ${target}`)
  if (target === (await realpath(os.homedir()))) {
    throw new Error(`refusing to stage at the home directory root: ${target}`)
  }
}

export async function createWorkingDirectory(): Promise<WorkingDirectory> {
  const base = await trustedTemporaryBase()
  const directory = await realpath(await mkdtemp(path.join(base, "opencode-superpowers-execution-stage-")))
  if (path.dirname(directory) !== base) throw new Error(`working directory escaped the trusted temporary base: ${directory}`)
  const info = await lstat(directory, { bigint: true })
  if (!info.isDirectory()) throw new Error(`working path is not a directory: ${directory}`)
  return { base, directory, dev: String(info.dev), ino: String(info.ino) }
}

export async function removeWorkingDirectory(working: WorkingDirectory): Promise<void> {
  const base = await trustedTemporaryBase()
  const directory = await physicalPath(working.directory)
  await assertOutsideRepository(directory)
  if (base !== working.base || directory !== working.directory || path.dirname(directory) !== base) {
    throw new Error(`refusing to remove a working directory whose identity changed: ${working.directory}`)
  }
  const info = await lstat(directory, { bigint: true }).catch(notFound)
  if (info === undefined) return
  if (!info.isDirectory() || String(info.dev) !== working.dev || String(info.ino) !== working.ino) {
    throw new Error(`refusing to remove a working directory whose identity changed: ${directory}`)
  }
  await rm(directory, { recursive: true })
}

async function trustedTemporaryBase(): Promise<string> {
  const base = await realpath(os.tmpdir())
  await assertOutsideRepository(base)
  const info = await lstat(base)
  if (!info.isDirectory()) throw new Error(`temporary base is not a directory: ${base}`)
  return base
}

async function publishStagedPackage(working: string, output: string): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true })
  const current = await availableOutput(output)
  if (current !== output) throw new Error(`refusing to stage because the output path changed: ${output}`)
  await mkdir(output).catch((error: unknown) => {
    if (errorCode(error) === "EEXIST") {
      throw new Error(`refusing to stage to existing output ${output}; remove it manually before retrying`)
    }
    throw error
  })
  const copied = await Promise.allSettled(
    (await readdir(working)).map((entry) => transferEntry(path.join(working, entry), path.join(output, entry))),
  )
  const failure = copied.find((result) => result.status === "rejected")
  if (failure !== undefined) {
    throw new Error(`staging failed; partial output was left at ${output}; remove it manually before retrying`, {
      cause: failure.reason,
    })
  }
}

async function transferEntry(source: string, destination: string): Promise<void> {
  const moved = await rename(source, destination)
    .then(() => true)
    .catch((error: unknown) => {
      if (errorCode(error) === "EXDEV") return false
      throw error
    })
  if (moved) return
  await cp(source, destination, {
    errorOnExist: true,
    force: false,
    recursive: true,
    verbatimSymlinks: true,
  })
}

async function verifyPublishedPackage(
  output: string,
  manifest: StagedManifest,
): Promise<Record<string, string>> {
  try {
    return await verifySelfContained(output, manifest)
  } catch (error) {
    throw new Error(`staged output failed verification and was left at ${output}; remove it manually before retrying`, {
      cause: error,
    })
  }
}

function notFound(error: unknown): undefined {
  if (errorCode(error) === "ENOENT") return
  throw error
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") return
  return error.code
}

async function composeManifest(): Promise<StagedManifest> {
  const source = (await Bun.file(path.join(packageRoot, "package.json")).json()) as {
    readonly name: string
    readonly version: string
    readonly description: string
    readonly license: string
    readonly dependencies: Record<string, string>
  }
  return {
    name: source.name,
    version: source.version,
    description: source.description,
    type: "module",
    license: source.license,
    main: "./index.js",
    exports: { ".": "./index.js", "./contract": "./dist/contract.js" },
    files: ["index.js", "dist", "skills", "README.md", "LICENSE", "node_modules"],
    dependencies: await resolveDependencies(source.dependencies),
  }
}

async function resolveDependencies(dependencies: Record<string, string>): Promise<Record<string, string>> {
  const root = (await Bun.file(path.join(repositoryRoot, "package.json")).json()) as {
    readonly workspaces: { readonly catalog: Record<string, string> }
  }
  return Object.fromEntries(
    await Promise.all(
      Object.entries(dependencies).map(async ([name, range]) => {
        if (range.startsWith("catalog:")) {
          const version = root.workspaces.catalog[name]
          if (version === undefined) throw new Error(`catalog entry missing for ${name}`)
          return [name, version]
        }
        if (range.startsWith("workspace:")) return [name, await workspaceVersion(name)]
        return [name, range]
      }),
    ),
  )
}

async function workspaceVersion(name: string): Promise<string> {
  const manifestPath = Bun.resolveSync(`${name}/package.json`, packageRoot)
  const manifest = (await Bun.file(manifestPath).json()) as { readonly version?: string }
  if (manifest.version === undefined) throw new Error(`workspace dependency ${name} has no version`)
  return manifest.version
}

async function copyPackageFiles(directory: string): Promise<void> {
  await cp(path.join(packageRoot, "index.js"), path.join(directory, "index.js"))
  await cp(path.join(packageRoot, "dist"), path.join(directory, "dist"), { recursive: true })
  await cp(path.join(packageRoot, "skills"), path.join(directory, "skills"), { recursive: true })
  await cp(path.join(packageRoot, "README.md"), path.join(directory, "README.md"))
  await cp(path.join(repositoryRoot, "LICENSE"), path.join(directory, "LICENSE"))
}

async function installRuntimeDependencies(directory: string): Promise<void> {
  const install = Bun.spawnSync(
    [process.execPath, "install", "--production", "--ignore-scripts"],
    { cwd: directory, stdout: "pipe", stderr: "pipe" },
  )
  if (install.exitCode !== 0) {
    throw new Error(`staged runtime dependency install failed: ${install.stderr.toString()}`)
  }
}

async function verifySelfContained(directory: string, manifest: StagedManifest): Promise<Record<string, string>> {
  const staged = await realpath(directory)
  const repository = await realpath(repositoryRoot)
  const entries = await Promise.all(
    Object.entries(manifest.dependencies).map(async ([name, expected]) => {
      const link = path.join(directory, "node_modules", name)
      if ((await lstat(link)).isSymbolicLink()) {
        throw new Error(`staged dependency ${name} is a symlink into the repository`)
      }
      const resolved = await realpath(Bun.resolveSync(`${name}/package.json`, directory))
      if (within(repository, resolved)) {
        throw new Error(`staged dependency ${name} resolves inside the repository: ${resolved}`)
      }
      if (!within(staged, resolved)) {
        throw new Error(`staged dependency ${name} resolves outside the staging tree: ${resolved}`)
      }
      const installed = (await Bun.file(resolved).json()) as { readonly version?: string }
      if (installed.version !== expected) {
        throw new Error(`staged dependency ${name} version ${installed.version} does not match ${expected}`)
      }
      return [name, resolved]
    }),
  )
  return Object.fromEntries(entries)
}

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

if (import.meta.main) {
  const staged = await buildStagedPackage({ directory: process.argv[2] })
  console.log(
    JSON.stringify(
      { directory: staged.directory, manifest: staged.manifest, dependencyPaths: staged.dependencyPaths },
      null,
      2,
    ),
  )
}
