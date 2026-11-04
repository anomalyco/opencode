import { expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

test("V1 run uses the shell PWD before connecting to the server", async () => {
  await using directory = await tmpdir()
  const work = path.join(directory.path, "work tree")
  await mkdir(work)
  const pwd =
    process.platform === "win32"
      ? work.replaceAll("\\", "/").replace(/^([a-zA-Z]):\//, (_, drive) => `/${drive.toLowerCase()}/`)
      : work
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import { runV1Bridge } from ${JSON.stringify(new URL("../../src/run/v1.ts", import.meta.url).href)}
// An invalid endpoint stops after directory selection without starting a server or calling a model.
await runV1Bridge({ message: ["hello"], format: "json", file: [], server: "http://[" })
console.log("V1_CWD " + JSON.stringify(process.cwd()))`,
    ],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: isolatedEnv(directory.path, { PWD: pwd }),
      signal: AbortSignal.timeout(25_000),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(stderr).toBe("")
  expect(stdout).not.toContain("Failed to change directory")
  const cwd = stdout.split("\n").find((line) => line.startsWith("V1_CWD "))
  if (!cwd) throw new Error(stdout)
  expect(realpathSync.native(JSON.parse(cwd.slice("V1_CWD ".length)))).toBe(realpathSync.native(work))
  expect(code).toBe(1)
})
