import { cp, mkdir, lstat, readdir, realpath, rm, writeFile } from "node:fs/promises"
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

export async function buildStagedPackage(options: { readonly directory?: string } = {}): Promise<StagedPackage> {
  const requested = path.resolve(options.directory ?? stagedPackageDirectory)
  assertSafeStagingTarget(requested)
  await buildPackage()
  const directory = await claimStagingDirectory(requested)

  const manifest = await composeManifest()
  await copyPackageFiles(directory)
  await writeFile(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  await installRuntimeDependencies(directory)
  const dependencyPaths = await verifySelfContained(directory, manifest)
  return { directory, manifest, dependencyPaths }
}

const stagingMarker = ".opencode-superpowers-execution-staging"

function assertSafeStagingTarget(target: string): void {
  if (within(repositoryRoot, target)) {
    throw new Error(`refusing to stage inside the repository: ${target}`)
  }
  if (target === path.parse(target).root) {
    throw new Error(`refusing to stage at the filesystem root: ${target}`)
  }
  if (target === path.resolve(os.homedir())) {
    throw new Error(`refusing to stage at the home directory root: ${target}`)
  }
}

async function claimStagingDirectory(target: string): Promise<string> {
  const existing = await lstat(target).catch(() => undefined)
  if (existing !== undefined) {
    if (existing.isSymbolicLink()) throw new Error(`refusing to replace a symlink: ${target}`)
    if (!existing.isDirectory()) throw new Error(`refusing to replace a non-directory: ${target}`)
    const marker = await lstat(path.join(target, stagingMarker)).catch(() => undefined)
    if (marker === undefined && (await readdir(target)).length > 0) {
      throw new Error(`refusing to replace a directory the stager does not own: ${target}`)
    }
  }
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, stagingMarker), "")
  return target
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
