import { chromium } from "@playwright/test"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildPackage, packageRoot } from "./build"

export const repositoryRoot = path.resolve(packageRoot, "..", "..")
export const stagedPackageDirectory = path.join(os.tmpdir(), "opencode-superpowers-execution-package")

const runtimeDependencies = ["@opencode/plugin", "@opencode/schema", "zod"]

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
}

export interface BrowserContractResult {
  readonly rpcID: string
  readonly serverModulesLoaded: readonly string[]
}

export interface HostProbe {
  readonly pluginVersion: string | undefined
  readonly runCount: number
}

export interface HostGateResult {
  readonly directory: string
  readonly port: number
  readonly first: HostProbe
  readonly restarted: HostProbe
}

export async function buildStagedPackage(options: { readonly directory?: string } = {}): Promise<StagedPackage> {
  await buildPackage()
  const directory = options.directory ?? stagedPackageDirectory
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })

  const manifest = await composeManifest()
  await copyPackageFiles(directory)
  await linkRuntimeDependencies(directory)
  await writeFile(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return { directory, manifest }
}

export async function importStagedContractInBrowser(staged: StagedPackage): Promise<BrowserContractResult> {
  const browserDirectory = path.join(staged.directory, ".browser")
  await rm(browserDirectory, { recursive: true, force: true })
  const bundle = await Bun.build({
    entrypoints: [path.join(staged.directory, "dist/contract.js")],
    outdir: browserDirectory,
    target: "browser",
    format: "esm",
    packages: "bundle",
    metafile: true,
  })
  if (!bundle.success) throw new AggregateError(bundle.logs, "staged contract browser bundle failed")
  const output = bundle.outputs[0]
  if (output === undefined) throw new Error("staged contract browser bundle produced no output")
  if (bundle.metafile === undefined) throw new Error("staged contract browser bundle produced no metafile")

  const serverModulesLoaded = serverModules(bundle.metafile.inputs)
  const source = await Bun.file(output.path).text()
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/contract.js") {
        return new Response(source, { headers: { "content-type": "text/javascript" } })
      }
      return new Response(browserPage, { headers: { "content-type": "text/html" } })
    },
  })

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const failures: string[] = []
    page.on("pageerror", (error) => failures.push(String(error)))
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(message.text())
    })
    await page.goto(`http://127.0.0.1:${server.port}/`)
    await page.waitForFunction(() => (globalThis as unknown as BrowserWindow).__executionContract !== undefined)
    const result = await page.evaluate(() => (globalThis as unknown as BrowserWindow).__executionContract)
    if (result === undefined) throw new Error("browser contract import produced no result")
    if (failures.length > 0) throw new Error(`browser contract import failed: ${failures.join(" | ")}`)
    return { rpcID: result.rpcID, serverModulesLoaded }
  } finally {
    await browser.close()
    server.stop(true)
  }
}

export async function runDisposableHostGate(
  staged: StagedPackage,
  options: { readonly password?: string } = {},
): Promise<HostGateResult> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "opencode-superpowers-execution-host-"))
  const password = options.password ?? crypto.randomUUID()
  const port = freePort()
  await mkdir(path.join(workspace, "config/opencode"), { recursive: true })
  await mkdir(path.join(workspace, "data"), { recursive: true })
  await mkdir(path.join(workspace, "cache"), { recursive: true })
  await mkdir(path.join(workspace, "state"), { recursive: true })
  await writeFile(
    path.join(workspace, "config/opencode/opencode.json"),
    `${JSON.stringify({ plugins: [staged.directory] }, null, 2)}\n`,
  )

  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(workspace, "config"),
    XDG_DATA_HOME: path.join(workspace, "data"),
    XDG_CACHE_HOME: path.join(workspace, "cache"),
    XDG_STATE_HOME: path.join(workspace, "state"),
    OPENCODE_PASSWORD: password,
  }

  const first = await withDisposableHost(env, port, password)
  const restarted = await withDisposableHost(env, port, password)
  return { directory: staged.directory, port, first, restarted }
}

const browserPage = `<!doctype html>
<html>
  <body>
    <script type="module">
      import { ExecutionRpc } from "/contract.js"
      globalThis.__executionContract = { rpcID: ExecutionRpc.id }
    </script>
  </body>
</html>
`

interface BrowserWindow {
  readonly __executionContract?: { readonly rpcID: string }
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
    files: ["index.js", "dist", "skills", "README.md", "LICENSE"],
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

async function linkRuntimeDependencies(directory: string): Promise<void> {
  const modules = path.join(directory, "node_modules")
  await mkdir(path.join(modules, "@opencode"), { recursive: true })
  for (const name of runtimeDependencies) {
    const source = path.dirname(Bun.resolveSync(`${name}/package.json`, packageRoot))
    await symlink(source, path.join(modules, name), "dir")
  }
}

function serverModules(inputs: Record<string, unknown>): string[] {
  return [
    ...new Set(
      Object.keys(inputs)
        .map((input) => input.replace(/\\/g, "/"))
        .filter(
          (input) =>
            /(^|\/)(plugin|repository|principal|reporting|reducer)\.(ts|js)$/.test(input) ||
            /^(node:|crypto$|path$|fs$|os$)/.test(input),
        ),
    ),
  ].sort()
}

function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") })
  const port = server.port
  server.stop(true)
  if (port === undefined) throw new Error("failed to allocate a free port for the disposable host")
  return port
}

async function withDisposableHost(
  env: Record<string, string | undefined>,
  port: number,
  password: string,
): Promise<HostProbe> {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "--cwd",
      "packages/cli",
      "src/index.ts",
      "serve",
      "--port",
      String(port),
      "--hostname",
      "127.0.0.1",
    ],
    { cwd: repositoryRoot, env, stdout: "pipe", stderr: "pipe" },
  )
  try {
    await waitForHost(port, password, child)
    const capabilities = await hostRpc<{ pluginVersion: string }>(port, password, "capabilities", {})
    const list = await hostRpc<{ items: readonly unknown[] }>(port, password, "listRuns", {
      rootSessionID: "host-gate-root",
    })
    return { pluginVersion: capabilities.pluginVersion, runCount: list.items.length }
  } finally {
    child.kill()
    await child.exited
  }
}

async function waitForHost(port: number, password: string, child: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<void> {
  const deadline = Date.now() + 90_000
  let lastFailure: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const stderr = await new Response(child.stderr).text()
      throw new Error(`disposable host exited with code ${child.exitCode}: ${stderr.slice(-2_000)}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/session`, { headers: authorization(password) })
      if (response.ok) return
      lastFailure = new Error(`host responded ${response.status}`)
    } catch (error) {
      lastFailure = error
    }
    await Bun.sleep(500)
  }
  throw new Error(`disposable host on port ${port} did not become ready: ${String(lastFailure)}`)
}

async function hostRpc<T>(port: number, password: string, method: string, input: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/api/rpc/superpowers.execution.v1/${method}`, {
    method: "POST",
    headers: { ...authorization(password), "content-type": "application/json" },
    body: JSON.stringify({ input }),
  })
  const body = (await response.json()) as { readonly output?: T; readonly message?: string }
  if (!response.ok || body.output === undefined) {
    throw new Error(`host rpc ${method} failed: ${response.status} ${body.message ?? JSON.stringify(body)}`)
  }
  return body.output
}

function authorization(password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
}
