import { expect, test } from "bun:test"
import semver from "semver"

test("preview builds identify as V2 and satisfy the free tier minimum", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      "const { Script } = await import('./src/index.ts'); console.log('VERSION='+Script.version)",
    ],
    {
      cwd: import.meta.dir + "/..",
      env: {
        ...process.env,
        OPENCODE_VERSION: "",
        OPENCODE_BUMP: "",
        OPENCODE_CHANNEL: "v2-custom",
        GITHUB_RUN_NUMBER: "123",
        GITHUB_RUN_ATTEMPT: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  const version = output.match(/VERSION=(.+)/)?.[1]
  expect(version).toBe("2.0.0-v2-custom-123")
  expect(semver.gte(version!, "1.18.0")).toBe(true)
})
