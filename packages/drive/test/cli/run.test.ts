import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe("opencode-drive run", () => {
  test("type-checks and executes a default-exported Effect", async () => {
    const root = await temporary()
    const marker = join(root, "executed.txt")
    await Bun.write(join(root, "helper.ts"), 'export const value = "yes\\n"\n')
    const program = await writeProgram(
      root,
      "valid.ts",
      `import { Effect } from "effect"\nimport { OpenCodeDriver } from "opencode-drive"\nimport { value } from "./helper.ts"\nvoid OpenCodeDriver\nexport default Effect.promise(() => Bun.write(${JSON.stringify(marker)}, value))\n`,
    )

    const child = spawn(["run", program])
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(status, `${stdout}\n${stderr}`).toBe(0)
    expect(await Bun.file(marker).text()).toBe("yes\n")
    expect(await Bun.file(join(root, "node_modules")).exists()).toBe(false)
  }, 30_000)

  test("rejects a program with unprovided requirements before importing it", async () => {
    const root = await temporary()
    const marker = join(root, "imported.txt")
    const program = await writeProgram(
      root,
      "requirements.ts",
      `import type { Effect } from "effect"\nawait Bun.write(${JSON.stringify(marker)}, "imported\\n")\ndeclare const program: Effect.Effect<void, never, { readonly Missing: unique symbol }>\nexport default program\n`,
    )

    const child = spawn(["run", program])
    const [status, stdout] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ])
    expect(status).toBe(1)
    expect(stdout).toContain("not assignable")
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(await Bun.file(join(root, "node_modules")).exists()).toBe(false)
  }, 30_000)

  test("validates the imported value at runtime", async () => {
    const root = await temporary()
    const program = await writeProgram(
      root,
      "invalid.js",
      'const program = /** @type {import("effect/Effect").Effect<void, never, never>} */ ({})\nexport default program\n',
    )

    const child = spawn(["run", program])
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(status).toBe(1)
    expect(`${stdout}\n${stderr}`).toContain(
      "program must default-export a fully provided Effect",
    )
    expect(await Bun.file(join(root, "node_modules")).exists()).toBe(false)
  }, 30_000)

  test.each([
    [["run", "program.ts", "--command.ui.state"], "command flags"],
    [["run", "program.ts", "--", "argument"], "arguments after --"],
  ] as const)("rejects unsupported invocation %#", async (args, message) => {
    const child = spawn(args)
    const [status, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ])
    expect(status).toBe(1)
    expect(stderr).toContain(message)
  })
})

function spawn(args: ReadonlyArray<string>) {
  return Bun.spawn([process.execPath, resolve("src/cli/index.ts"), ...args], {
    cwd: resolve("."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
}

async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "opencode-drive-run-test-"))
  roots.push(root)
  return root
}

async function writeProgram(root: string, name: string, contents: string) {
  const file = join(root, name)
  await Bun.write(file, contents)
  return file
}
