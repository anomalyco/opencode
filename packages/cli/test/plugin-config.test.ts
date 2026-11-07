import { expect, test } from "bun:test"
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

test("independent processes retain both plugin config updates", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")
  await Bun.write(file, '{"plugins":[]}')
  const children = ["alpha", "beta"].map((spec) =>
    Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "fixture/plugin-config-worker.ts"), file, spec], {
      env: isolatedEnv(directory.path),
      stdout: "ignore",
      stderr: "pipe",
    }),
  )
  try {
    const results = await Promise.all(
      children.map(async (child) => ({
        error: await new Response(child.stderr).text(),
        code: await child.exited,
      })),
    )
    expect(results).toEqual([
      { error: "", code: 0 },
      { error: "", code: 0 },
    ])
    expect((await Bun.file(file).json()).plugins.toSorted()).toEqual(["alpha", "beta"])
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill()
    await Promise.all(children.map((child) => child.exited))
  }
})
