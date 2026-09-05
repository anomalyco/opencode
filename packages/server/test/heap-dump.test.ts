import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { debugHandler } from "./fixture/debug"

test("heap dumps require authentication and concurrent requests return distinct completed snapshots", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-heap-api-"))
  const transport = debugHandler(directory)
  try {
    const denied = await transport.handler(new Request("http://localhost/api/debug/heap-dump", { method: "POST" }))
    expect(denied.status).toBe(401)
    expect(await readdir(directory)).toEqual([])

    const responses = await Promise.all(
      [0, 1].map(() =>
        transport.handler(
          new Request("http://localhost/api/debug/heap-dump", {
            method: "POST",
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
          }),
        ),
      ),
    )
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const results = await Promise.all(responses.map((response) => response.json()))
    expect(new Set(results.map((result) => result.path)).size).toBe(2)
    const result = results[0]
    expect(result.pid).toBe(process.pid)
    expect(path.dirname(result.path)).toBe(directory)
    expect(path.basename(result.path)).toStartWith(`heap-${process.pid}-`)
    if (process.platform !== "win32") expect((await stat(result.path)).mode & 0o777).toBe(0o600)
    const snapshot = await Bun.file(result.path).json()
    expect(snapshot.snapshot.node_count).toBeGreaterThan(0)
    expect(snapshot.snapshot.edge_count).toBeGreaterThan(0)
    expect(snapshot.snapshot.meta.node_fields).toContain("self_size")
  } finally {
    await transport.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

test("the workerd helper reports unsupported without importing the native heap writer", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-heap-workerd-"))
  try {
    const bundle = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "../../util/src/heap-snapshot.ts")],
      conditions: ["workerd"],
      target: "node",
      outdir: path.join(directory, "bundle"),
    })
    expect(bundle.success).toBe(true)
    const imports = new Bun.Transpiler({ loader: "js" }).scanImports(await bundle.outputs[0].text())
    expect(imports.map((entry) => entry.path)).not.toContain("node:v8")
    const { HeapSnapshot } = await import(pathToFileURL(bundle.outputs[0].path).href)
    expect(HeapSnapshot.supported).toBe(false)
    const error = await Effect.runPromise(HeapSnapshot.write(directory).pipe(Effect.flip))
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain("unsupported")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

test("a failed heap write returns an API error and does not block later captures", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode-heap-api-"))
  const log = path.join(directory, "missing")
  const transport = debugHandler(log)
  const request = () =>
    new Request("http://localhost/api/debug/heap-dump", {
      method: "POST",
      headers: { authorization: `Basic ${btoa("opencode:secret")}` },
    })
  try {
    const failed = await transport.handler(request())
    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({
      _tag: "UnknownError",
      message: expect.stringContaining("Failed to write"),
    })

    await mkdir(log)
    const response = await transport.handler(request())
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(await Bun.file(result.path).exists()).toBe(true)
  } finally {
    await transport.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
