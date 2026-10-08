import { expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "./fixture/tmpdir"

test("loads compatible provider packages from a standalone binary", async () => {
  await using tmp = await tmpdir()
  const binary = path.join(tmp.path, process.platform === "win32" ? "provider.exe" : "provider")
  const build = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      path.join(import.meta.dir, "fixture/provider-package.ts"),
      "--outfile",
      binary,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const output = await new Response(build.stderr).text()
  expect(await build.exited, output).toBe(0)

  for (const specifier of [
    "@opencode/ai/providers/anthropic-compatible",
    "@opencode/ai/providers/openai-compatible/responses",
    "@opencode/ai/providers/openai-compatible-responses",
    "@opencode-ai/ai/providers/anthropic-compatible",
    "@opencode-ai/ai/providers/openai-compatible/responses",
    "@opencode-ai/ai/providers/openai-compatible-responses",
  ]) {
    // Run outside the workspace so installed source packages cannot mask missing bundled imports.
    const run = Bun.spawn([binary, specifier], { cwd: tmp.path, stdout: "pipe", stderr: "pipe" })
    const error = await new Response(run.stderr).text()
    expect(await run.exited, `${specifier}: ${error}`).toBe(0)
    expect(await new Response(run.stdout).text()).toBe("test-model\n")
  }
}, 60_000)
