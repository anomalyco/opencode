import { expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

test.each(["run", "mini"])("%s uses the shell PWD before connecting to the server", async (command) => {
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
      `process.once("exit", () => console.log("RUN_CWD " + JSON.stringify(process.cwd())))
${
  command === "mini"
    ? `import { runMini } from ${JSON.stringify(new URL("../../src/mini.ts", import.meta.url).href)}
// Exercise directory selection in an isolated child without opening a terminal or rendering the UI.
Object.defineProperty(process.stdin, "isTTY", { value: true })
Object.defineProperty(process.stdout, "isTTY", { value: true })
// Invalid model syntax stops after directory selection and before any server/model access.
await runMini({ model: "invalid", prompt: "hello", server: { endpoint: { url: "http://127.0.0.1:1" } }, paths: { home: ${JSON.stringify(work)}, state: ${JSON.stringify(work)}, log: ${JSON.stringify(work)} } })`
    : `import { runNonInteractive } from ${JSON.stringify(new URL("../../src/run/run.ts", import.meta.url).href)}
// An invalid endpoint stops after directory selection without starting a server or calling a model.
await runNonInteractive({ message: ["hello"], format: "json", file: [], server: { endpoint: { url: "http://[" } } }, new AbortController().signal)`
}`,
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
  if (command === "mini") expect(stderr).toContain("--model must use the format provider/model[#variant]")
  if (command === "run") expect(stderr).toBe("")
  expect(stderr).not.toContain("Failed to change directory")
  expect(stdout).not.toContain("Failed to change directory")
  const cwd = stdout.split("\n").find((line) => line.startsWith("RUN_CWD "))
  if (!cwd) throw new Error(stdout)
  expect(realpathSync.native(JSON.parse(cwd.slice("RUN_CWD ".length)))).toBe(realpathSync.native(work))
  expect(code).toBe(1)
})
