import { expect, test } from "bun:test"
import { Flock } from "@opencode/util/flock"
import { parse } from "jsonc-parser"
import path from "node:path"
import { writePluginConfig } from "../src/commands/handlers/plugin/add"
import { removePluginConfig } from "../src/commands/handlers/plugin/remove"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

const cases = [
  {
    name: "add/add",
    initial: [],
    operations: [
      ["add", "alpha"],
      ["add", "beta"],
    ],
    expected: ["alpha", "beta"],
  },
  {
    name: "remove/remove",
    initial: ["alpha", "beta"],
    operations: [
      ["remove", "alpha"],
      ["remove", "beta"],
    ],
    expected: [],
  },
  {
    name: "add/remove",
    initial: ["alpha"],
    operations: [
      ["add", "beta"],
      ["remove", "alpha"],
    ],
    expected: ["beta"],
  },
] as const

for (const input of cases) {
  for (const concurrent of [false, true]) {
    test(`${concurrent ? "concurrent" : "sequential"} plugin ${input.name} preserves both edits`, async () => {
      await using directory = await tmpdir()
      const file = path.join(directory.path, "opencode.json")
      await Bun.write(file, JSON.stringify({ plugins: input.initial, marker: "keep" }))
      const update = (operation: (typeof input.operations)[number]) =>
        operation[0] === "add" ? writePluginConfig(file, operation[1]) : removePluginConfig(file, operation[1])
      const results = concurrent
        ? await Promise.all(input.operations.map(update))
        : [await update(input.operations[0]), await update(input.operations[1])]
      expect(results).toEqual([true, true])
      const config = await Bun.file(file).json()
      expect(config.plugins.toSorted()).toEqual(input.expected.toSorted())
      expect(config.marker).toBe("keep")
    })
  }
}

test("plugin writers preserve JSONC comments and unrelated configuration", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.jsonc")
  await Bun.write(file, '// keep this comment\n{"plugins": ["alpha"], "marker": "keep",}\n')
  await Promise.all([writePluginConfig(file, "beta"), removePluginConfig(file, "alpha")])
  const text = await Bun.file(file).text()
  expect(text).toContain("// keep this comment")
  expect(parse(text)).toEqual({ plugins: ["beta"], marker: "keep" })
})

test("plugin config parse failures release the lock without changing the file", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")
  await Bun.write(file, "{")
  await expect(writePluginConfig(file, "alpha")).rejects.toThrow("Invalid global configuration")
  expect(await Bun.file(file).text()).toBe("{")
  await Bun.write(file, '{"plugins":["alpha"]}')
  expect(await removePluginConfig(file, "alpha")).toBe(true)
  expect(await Bun.file(file).json()).toEqual({ plugins: [] })
})

test("concurrent additions of the same plugin only change the config once", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")
  const results = await Promise.all([writePluginConfig(file, "alpha"), writePluginConfig(file, "alpha")])
  expect(results.toSorted()).toEqual([false, true])
  expect(await Bun.file(file).json()).toEqual({ plugins: ["alpha"] })
})

test("unchanged plugin configuration releases the lock without rewriting the file", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.jsonc")
  const text = '// keep formatting\n{"plugins": [{"package":"alpha","options":{"enabled":true}}]}\n'
  await Bun.write(file, text)
  expect(await writePluginConfig(file, "alpha")).toBe(false)
  expect(await removePluginConfig(file, "missing")).toBe(false)
  expect(await Bun.file(file).text()).toBe(text)
  expect(await writePluginConfig(file, "beta")).toBe(true)
})

test("removing from a missing config does not create it or block a later addition", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "nested", "opencode.json")
  expect(await removePluginConfig(file, "alpha")).toBe(false)
  expect(await Bun.file(file).exists()).toBe(false)
  expect(await writePluginConfig(file, "alpha")).toBe(true)
  expect(await Bun.file(file).json()).toEqual({ plugins: ["alpha"] })
})

for (const operation of [writePluginConfig, removePluginConfig]) {
  test(`${operation.name} can be cancelled while waiting for another config writer`, async () => {
    await using directory = await tmpdir()
    const file = path.join(directory.path, "opencode.json")
    const text = '{"plugins":["alpha"]}'
    await Bun.write(file, text)
    await using _ = await Flock.acquire(file)
    const controller = new AbortController()
    const pending = operation(file, "alpha", controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(await Bun.file(file).text()).toBe(text)
  })
}

test("independent processes retain both plugin config updates", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")
  await Bun.write(file, JSON.stringify({ plugins: [], marker: "keep", padding: "x".repeat(262144) }))
  const children = ["alpha", "beta"].map((spec) =>
    Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "fixture/plugin-config-worker.ts"), file, spec], {
      env: isolatedEnv(directory.path),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
  const readers = children.map((child) => child.stdout.getReader())
  try {
    await Promise.all(
      readers.map(async (reader) => {
        const ready = await reader.read()
        expect(new TextDecoder().decode(ready.value).trim()).toBe("ready")
      }),
    )
    for (const child of children) child.stdin.end()
    const results = await Promise.all(
      children.map(async (child, index) => ({
        code: await child.exited,
        output: await readOutput(readers[index]!),
        error: await new Response(child.stderr).text(),
      })),
    )
    expect(results).toEqual([
      { code: 0, output: "true", error: "" },
      { code: 0, output: "true", error: "" },
    ])
    const config = await Bun.file(file).json()
    expect(config.plugins.toSorted()).toEqual(["alpha", "beta"])
    expect(config.marker).toBe("keep")
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill()
    await Promise.all(children.map((child) => child.exited))
  }
})

async function readOutput(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let text = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) return (text + decoder.decode()).trim()
    text += decoder.decode(chunk.value, { stream: true })
  }
}
