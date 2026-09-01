import { expect, test } from "bun:test"
import path from "node:path"

test.each([
  [".", "dev"],
  ["packages/opencode", "dev"],
  ["packages/opencode", "dev:temporary"],
])("%s %s runtime supports Solid and Bedrock", async (directory, script) => {
  const root = path.resolve(import.meta.dir, "../../../..")
  const cwd = path.join(root, directory)
  const pkg = await Bun.file(path.join(cwd, "package.json")).json()
  const command = pkg.scripts[script].split(" ") as string[]
  const entry = command.findIndex((arg) => ["src/index.ts", "./src/index.ts", "./src/temporary.ts"].includes(arg))
  expect(entry).toBeGreaterThan(0)
  // Retain the actual launch flags and bunfig preload, replacing only the CLI entrypoint.
  command[0] = process.execPath
  command[entry] = path.join(import.meta.dir, "fixtures/dev-runtime.ts")
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
  expect(stdout).toContain("Solid reactivity and Bedrock streaming passed")
})
