import assert from "node:assert/strict"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"
import { Host } from "../src/host.js"

// Every entrypoint throws if evaluated: resolution must never execute plugins.
const source = 'throw new Error("Plugin code must not run during resolution")'
const name = "@fixture/plugin"

async function fixture(files: Record<string, string>, installed = false) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "opencode-host-")))
  const directory = installed ? path.join(root, "node_modules", name) : root
  await Promise.all(
    Object.entries(files).map(async ([file, content]) => {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
      await writeFile(path.join(directory, file), content)
    }),
  )
  return {
    target: { directory, ...(installed ? { name } : {}) },
    url: (file: string) => pathToFileURL(path.join(directory, file)).href,
    [Symbol.asyncDispose]: () => rm(root, { recursive: true, force: true }),
  }
}

describe("Host.resolve", () => {
  it("resolves a local package main without a root shim", async () => {
    await using plugin = await fixture({
      "package.json": JSON.stringify({ name, type: "module", main: "dist/backend.js" }),
      "dist/backend.js": source,
    })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("dist/backend.js"),
      tui: undefined,
      rpc: undefined,
    })
  })

  for (const packageName of [name, undefined]) {
    it(`honors local conditional exports with ${packageName ?? "no package name"}`, async () => {
      await using plugin = await fixture({
        "package.json": JSON.stringify({
          name: packageName,
          exports: {
            ".": "./dist/root.js",
            "./server": { import: "./dist/backend.js", require: "./dist/wrong.cjs" },
            "./tui": "./dist/terminal.js",
            "./rpc": "./dist/contract.js",
          },
        }),
        "dist/root.js": source,
        "dist/backend.js": source,
        "dist/terminal.js": source,
        "dist/contract.js": source,
      })
      assert.deepEqual(Host.resolve(plugin.target), {
        server: plugin.url("dist/backend.js"),
        tui: plugin.url("dist/terminal.js"),
        rpc: plugin.url("dist/contract.js"),
      })
    })
  }

  it("uses a local root export and respects deliberately unexported conventional files", async () => {
    await using plugin = await fixture({
      "package.json": JSON.stringify({ exports: "./dist/backend.js", main: "wrong.js" }),
      "dist/backend.js": source,
      "server.js": source,
      "tui.js": source,
    })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("dist/backend.js"),
      tui: undefined,
      rpc: undefined,
    })
  })

  it("rereads changed manifest entrypoints on reload", async () => {
    await using plugin = await fixture({
      "package.json": JSON.stringify({ main: "dist/first.js" }),
      "dist/first.js": source,
      "dist/next.js": source,
    })
    assert.equal(Host.resolve(plugin.target).server, plugin.url("dist/first.js"))
    await writeFile(path.join(plugin.target.directory, "package.json"), JSON.stringify({ main: "dist/next.js" }))
    assert.equal(Host.resolve(plugin.target).server, plugin.url("dist/next.js"))
  })
  it("resolves conventional entrypoints without package.json", async () => {
    await using plugin = await fixture({ "index.ts": source, "tui.tsx": source, "rpc.ts": source })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("index.ts"),
      tui: plugin.url("tui.tsx"),
      rpc: plugin.url("rpc.ts"),
    })
  })

  it("resolves a TUI-only directory without an index or package.json", async () => {
    await using plugin = await fixture({ "tui.tsx": source })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: undefined,
      tui: plugin.url("tui.tsx"),
      rpc: undefined,
    })
  })

  for (const main of [undefined, "lib/backend.js"]) {
    it(`resolves packages without exports using ${main ?? "the default index"}`, async () => {
      await using plugin = await fixture(
        {
          "package.json": JSON.stringify({ name, main }),
          [main ?? "index.js"]: source,
          "tui.js": source,
          "rpc.js": source,
        },
        true,
      )
      assert.deepEqual(Host.resolve(plugin.target), {
        server: plugin.url(main ?? "index.js"),
        tui: plugin.url("tui.js"),
        rpc: plugin.url("rpc.js"),
      })
    })
  }

  it("resolves local conventional entrypoints with package.json but no exports", async () => {
    await using plugin = await fixture({
      "package.json": JSON.stringify({ name, type: "module" }),
      "index.js": source,
      "tui.js": source,
      "rpc.js": source,
    })
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("index.js"),
      tui: plugin.url("tui.js"),
      rpc: plugin.url("rpc.js"),
    })
  })

  it("honors exports and prefers the explicit server entrypoint over the root", async () => {
    await using plugin = await fixture(
      {
        "package.json": JSON.stringify({
          name,
          exports: {
            ".": "./dist/root.js",
            "./server": "./dist/backend.js",
            "./tui": "./dist/terminal.js",
            "./rpc": "./dist/contract.js",
          },
        }),
        "dist/root.js": source,
        "dist/backend.js": source,
        "dist/terminal.js": source,
        "dist/contract.js": source,
      },
      true,
    )
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("dist/backend.js"),
      tui: plugin.url("dist/terminal.js"),
      rpc: plugin.url("dist/contract.js"),
    })
  })

  it("falls back to the root export and uses import rather than require conditions", async () => {
    await using plugin = await fixture(
      {
        "package.json": JSON.stringify({
          name,
          exports: {
            ".": { import: "./dist/server.mjs", require: "./dist/server.cjs" },
            "./tui": { import: "./dist/tui.mjs", require: "./dist/tui.cjs" },
          },
        }),
        "dist/server.mjs": source,
        "dist/server.cjs": source,
        "dist/tui.mjs": source,
        "dist/tui.cjs": source,
      },
      true,
    )
    assert.deepEqual(Host.resolve(plugin.target), {
      server: plugin.url("dist/server.mjs"),
      tui: plugin.url("dist/tui.mjs"),
      rpc: undefined,
    })
  })

  it("supports TUI-only exports without falling back to unexported files", async () => {
    await using plugin = await fixture(
      {
        "package.json": JSON.stringify({ name, exports: { "./tui": "./dist/terminal.js" } }),
        "dist/terminal.js": source,
        "index.js": source,
        "server.js": source,
        "rpc.js": source,
      },
      true,
    )
    assert.deepEqual(Host.resolve(plugin.target), {
      server: undefined,
      tui: plugin.url("dist/terminal.js"),
      rpc: undefined,
    })
  })

  it("does not return an exported entrypoint whose file is missing", async () => {
    await using plugin = await fixture(
      { "package.json": JSON.stringify({ name, exports: { "./tui": "./missing.js" } }) },
      true,
    )
    assert.deepEqual(Host.resolve(plugin.target), { server: undefined, tui: undefined, rpc: undefined })
  })
})
