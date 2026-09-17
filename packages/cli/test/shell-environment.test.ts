import { NodeServices } from "@effect/platform-node"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ShellEnvironment } from "../src/shell-environment"

// A stand-in login shell: it records every invocation, applies "rc file" exports, then runs the
// probe script exactly as `$SHELL -ilc <script>` would.
let root: string
let shell: string
let invocations: string

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shell-env-"))
  shell = path.join(root, "login-shell")
  invocations = path.join(root, "invocations")
  await fs.writeFile(
    shell,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$1" >> '${invocations}'`,
      `[ "$1" = -ilc ] || exit 64`,
      'export PATH="/rc/bin:$PATH"',
      "export FROM_RC=yes",
      "export MULTILINE='first",
      "second'",
      'export SAW_GUARD="${OPENCODE_RESOLVING_SHELL_ENVIRONMENT:-unset}"',
      "export SHLVL=1 PWD=/rc OLDPWD=/rc",
      'eval "$2"',
    ].join("\n"),
    { mode: 0o755 },
  )
})

afterAll(() => fs.rm(root, { recursive: true, force: true }))

const skip = process.platform === "win32"
const launchd = { SHELL: "", HOME: "", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }
const resolve = (env: Record<string, string | undefined>) =>
  Effect.runPromise(
    ShellEnvironment.resolve({ ...launchd, ...env, SHELL: env.SHELL ?? shell, HOME: root }).pipe(
      Effect.provide(NodeServices.layer),
    ),
  )

test.skipIf(skip)("adopts the login shell's exports over a launchd environment", async () => {
  const variables = await resolve({})
  expect(variables?.PATH).toBe("/rc/bin:/usr/bin:/bin:/usr/sbin:/sbin")
  expect(variables?.FROM_RC).toBe("yes")
  expect(variables?.MULTILINE).toBe("first\nsecond")
  expect(variables?.SAW_GUARD).toBe("1")
  for (const key of [ShellEnvironment.RESOLVING, "SHLVL", "PWD", "OLDPWD", "_"])
    expect(variables).not.toHaveProperty(key)
})

test.skipIf(skip)("does not probe when the environment already came from a shell or a probe", async () => {
  const before = await fs.readFile(invocations, "utf8").catch(() => "")
  expect(await resolve({ SHLVL: "1" })).toBeUndefined()
  expect(await resolve({ [ShellEnvironment.RESOLVING]: "1" })).toBeUndefined()
  expect(await fs.readFile(invocations, "utf8").catch(() => "")).toBe(before)
})

test.skipIf(skip)("falls back to the inherited environment when the shell cannot report", async () => {
  expect(await resolve({ SHELL: "/bin/false" })).toBeUndefined()
  expect(await resolve({ SHELL: path.join(root, "missing-shell") })).toBeUndefined()
})
