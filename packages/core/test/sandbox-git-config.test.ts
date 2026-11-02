import { expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { SandboxGitConfig } from "../src/sandbox/git-config"
import { MacSandbox } from "../src/sandbox/macos"
import { SandboxPolicy } from "../src/sandbox/policy"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(AppProcess.node))
const probe =
  process.platform === "darwin"
    ? Bun.spawnSync([MacSandbox.executable, "-p", "(version 1)(allow default)", "/usr/bin/true"])
    : undefined
const macos = probe?.exitCode === 0 ? it.live : it.live.skip

macos("discovers trusted Git config origins and permits only those files inside Seatbelt", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-sandbox-git-config-")
    const host = Object.fromEntries(
      ["directory", "scratch", "home", "config", "data", "state"].map((key) => [key, path.join(tmp.path, key)]),
    ) as Record<"directory" | "scratch" | "home" | "config" | "data" | "state", string>
    const system = path.join(tmp.path, "system config")
    const global = path.join(tmp.path, "global config")
    const included = path.join(tmp.path, "included config")
    const secret = path.join(tmp.path, "secret")
    const env = { PATH: process.env.PATH, HOME: host.home, GIT_CONFIG_SYSTEM: system, GIT_CONFIG_GLOBAL: global }
    yield* Effect.promise(async () => {
      await Promise.all(Object.values(host).map((value) => fs.mkdir(value)))
      await fs.writeFile(system, "[core]\n  abbrev = 8\n")
      await fs.writeFile(global, `[include]\n  path = ${included}\n`)
      await fs.writeFile(included, "[user]\n  name = sandbox test\n")
      await fs.writeFile(secret, "[private]\n  key = secret\n")
    })
    const init = Bun.spawnSync(["git", "init", "--quiet", host.directory], { env })
    expect(init.exitCode).toBe(0)
    yield* Effect.promise(() =>
      fs.appendFile(path.join(host.directory, ".git", "config"), `[include]\n  path = ${secret}\n`),
    )
    const files = yield* SandboxGitConfig.discover(host.directory, env)
    expect(files).toEqual([global, included, system].sort())
    expect(files).not.toContain(secret)
    // Remove the untrusted include so Git itself does not fail while trying to read it.
    yield* Effect.promise(() =>
      fs.writeFile(path.join(host.directory, ".git", "config"), "[core]\n  repositoryformatversion = 0\n"),
    )
    const policy = yield* Effect.promise(() => MacSandbox.policy(host, {}, files))
    const launch = MacSandbox.launch(policy, "git", ["status", "--short"], SandboxPolicy.environment(env, host.scratch))
    const status = Bun.spawnSync([launch.command, ...launch.args], { cwd: host.directory, env: launch.env })
    expect({ exit: status.exitCode, stderr: status.stderr.toString() }).toEqual({ exit: 0, stderr: "" })
    const blocked = MacSandbox.launch(policy, "/bin/cat", [secret], SandboxPolicy.environment(env, host.scratch))
    expect(
      Bun.spawnSync([blocked.command, ...blocked.args], { cwd: host.directory, env: blocked.env }).exitCode,
    ).not.toBe(0)
    const write = MacSandbox.launch(
      policy,
      "/bin/sh",
      ["-c", `printf changed > '${global}'`],
      SandboxPolicy.environment(env, host.scratch),
    )
    expect(Bun.spawnSync([write.command, ...write.args], { cwd: host.directory, env: write.env }).exitCode).not.toBe(0)
    const auth = path.join(host.data, "auth.json")
    yield* Effect.promise(() => fs.writeFile(auth, "[private]\n  key = secret\n"))
    const protectedPolicy = yield* Effect.promise(() => MacSandbox.policy(host, {}, [...files, auth]))
    const credential = MacSandbox.launch(
      protectedPolicy,
      "/bin/cat",
      [auth],
      SandboxPolicy.environment(env, host.scratch),
    )
    expect(
      Bun.spawnSync([credential.command, ...credential.args], { cwd: host.directory, env: credential.env }).exitCode,
    ).not.toBe(0)
  }),
)
