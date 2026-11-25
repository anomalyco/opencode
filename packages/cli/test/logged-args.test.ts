import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { loggedArgs } from "../src/logged-args"
import { isolatedEnv } from "./fixture/environment"

const syntheticNpm = "npm_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"
const syntheticGithub = "gho_FAKEFAKE0000111122223333444455556666"

describe("loggedArgs", () => {
  test("redacts known token formats embedded in CLI arguments", () => {
    expect(loggedArgs(["run", `print this: ${syntheticNpm}`])).toEqual(["run", "print this: <redacted>"])
    expect(
      loggedArgs([
        "--standalone",
        "run",
        "--model",
        "test/model",
        `Use bash: export GH_TOKEN=${syntheticGithub} && echo "$GH_TOKEN"`,
      ]),
    ).toEqual([
      "--standalone",
      "run",
      "--model",
      "test/model",
      `Use bash: export GH_TOKEN=<redacted> && echo "$GH_TOKEN"`,
    ])
  })

  test("redacts URL userinfo while keeping flags and host intact", () => {
    expect(loggedArgs(["--server", "https://alice:s3cr3t@example.com/api", "run", "check status"])).toEqual([
      "--server",
      "https://<redacted>@example.com/api",
      "run",
      "check status",
    ])
  })

  test("keeps service set positional redaction intact", () => {
    expect(loggedArgs(["service", "set", "password", "not-in-log"])).toEqual([
      "service",
      "set",
      "password",
      "<redacted>",
    ])
    expect(loggedArgs(["service", "set", "env", "PROVIDER_KEY", "not-in-log"])).toEqual([
      "service",
      "set",
      "env",
      "PROVIDER_KEY",
      "<redacted>",
    ])
  })

  test("passes clean arguments through unchanged", () => {
    const clean = ["--standalone", "run", "--model", "anthropic/claude-sonnet-4-5", "explain src/index.ts"]
    expect(loggedArgs(clean)).toEqual(clean)
  })
})

test("cli starting log redacts synthetic tokens and URL userinfo from argv", async () => {
  await using root = await tmpdir()
  const args = ["--server", "https://alice:s3cr3t@127.0.0.1:9", "run", `print this: ${syntheticNpm}`]
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), ...args], {
    env: isolatedEnv(root.path),
    stdout: "ignore",
    stderr: "ignore",
  })
  await child.exited
  const directory = path.join(root.path, "data", "opencode", "log")
  const log = (
    await Promise.all((await fs.readdir(directory)).map((file) => Bun.file(path.join(directory, file)).text()))
  ).join("")
  const expected = ["--server", "https://<redacted>@127.0.0.1:9", "run", "print this: <redacted>"]
  expect(log).toContain('message="cli starting"')
  expect(log).toContain(`args=${JSON.stringify(JSON.stringify(expected))}`)
  expect(log).not.toContain(syntheticNpm)
  expect(log).not.toContain("s3cr3t")
})
