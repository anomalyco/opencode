import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const directory = resolve(import.meta.dir, "../..")

test("built Node entrypoint imports and exposes browser registration in Node", async () => {
  await buildClient()
  const output = await Bun.file(join(directory, "dist/node/index.js")).text()
  expect(output).not.toMatch(/(?:from\s+|import\s*)["']\.\.?\//)

  const temporary = await mkdtemp(join(import.meta.dir, ".node-package-"))
  try {
    await Bun.write(join(temporary, "index.mjs"), output)
    await stageWorkspaceDependencies(temporary)
    const child = Bun.spawn(
      ["node", "--input-type=module", "-e", nodeScenario(pathToFileURL(join(temporary, "index.mjs")).href)],
      { cwd: temporary, stdout: "pipe", stderr: "pipe" },
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    if (exitCode !== 0) throw new Error(stderr || stdout)
    expect(stdout.trim()).toBe("ok")
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}, 60_000)

async function buildClient() {
  const child = Bun.spawn([process.execPath, "run", "build"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(stdout + stderr)
}

async function stageWorkspaceDependencies(temporary: string) {
  const schema = join(temporary, "node_modules/@opencode-ai/schema")
  const protocol = join(temporary, "node_modules/@opencode-ai/protocol")
  await Promise.all([mkdir(schema, { recursive: true }), mkdir(protocol, { recursive: true })])

  const schemaEntry = join(temporary, "schema.ts")
  const protocolEntry = join(temporary, "protocol.ts")
  await Promise.all([
    Bun.write(
      schemaEntry,
      [
        `export { Browser } from ${JSON.stringify(importPath(temporary, resolve(directory, "../schema/src/browser.ts")))}`,
        `export { BrowserControl } from ${JSON.stringify(importPath(temporary, resolve(directory, "../schema/src/browser-control.ts")))}`,
        `export { BrowserTunnel } from ${JSON.stringify(importPath(temporary, resolve(directory, "../schema/src/browser-tunnel.ts")))}`,
        `export { Session } from ${JSON.stringify(importPath(temporary, resolve(directory, "../schema/src/session.ts")))}`,
      ].join("\n"),
    ),
    Bun.write(
      protocolEntry,
      [
        `export { BrowserControlProtocol } from ${JSON.stringify(importPath(temporary, resolve(directory, "../protocol/src/browser-control.ts")))}`,
        `export { BrowserTunnelProtocol } from ${JSON.stringify(importPath(temporary, resolve(directory, "../protocol/src/browser-tunnel.ts")))}`,
      ].join("\n"),
    ),
  ])
  const [schemaBuild, protocolBuild] = await Promise.all([
    Bun.build({
      entrypoints: [schemaEntry],
      outdir: schema,
      naming: "index.js",
      target: "node",
      format: "esm",
      packages: "bundle",
    }),
    Bun.build({
      entrypoints: [protocolEntry],
      outdir: protocol,
      naming: "index.js",
      target: "node",
      format: "esm",
      packages: "bundle",
    }),
  ])
  if (!schemaBuild.success) throw new Error(schemaBuild.logs.map((log) => log.message).join("\n"))
  if (!protocolBuild.success) throw new Error(protocolBuild.logs.map((log) => log.message).join("\n"))
  await Promise.all([
    Bun.write(
      join(schema, "package.json"),
      JSON.stringify({
        type: "module",
        exports: {
          "./browser": "./index.js",
          "./browser-control": "./index.js",
          "./browser-tunnel": "./index.js",
          "./session": "./index.js",
        },
      }),
    ),
    Bun.write(
      join(protocol, "package.json"),
      JSON.stringify({
        type: "module",
        exports: {
          "./browser-control": "./index.js",
          "./browser-tunnel": "./index.js",
        },
      }),
    ),
  ])
}

function importPath(from: string, to: string) {
  const path = relative(from, to).replaceAll("\\", "/")
  return path.startsWith(".") ? path : `./${path}`
}

function nodeScenario(moduleURL: string) {
  return `const sdk = await import(${JSON.stringify(moduleURL)})
if (typeof sdk.OpenCode.make !== "function") throw new Error("Missing OpenCode.make")
if (typeof sdk.BrowserDriver.define !== "function") throw new Error("Missing BrowserDriver.define")
if (typeof sdk.BrowserDriver.chromium !== "function") throw new Error("Missing BrowserDriver.chromium")
if (typeof sdk.BrowserDriverError !== "function") throw new Error("Missing BrowserDriverError")
if (!sdk.Browser.State) throw new Error("Missing canonical Browser export")
const client = sdk.OpenCode.make({ baseUrl: "http://127.0.0.1:1" })
if (typeof client.browser.register !== "function") throw new Error("Missing browser.register")
console.log("ok")`
}
