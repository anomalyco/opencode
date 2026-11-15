import path from "path"
import os from "os"
import { afterAll, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Document, type Entry, Info } from "@opencode/schema/config"
import { ConfigSandbox } from "@opencode/schema/config/sandbox"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { Sandbox } from "@opencode/core/sandbox"
import { AbsolutePath } from "@opencode/core/schema"
import { Workspace } from "@opencode/core/workspace"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const workspace = AbsolutePath.make(path.resolve("/project"))
const entry = (sandbox: Record<string, unknown>, file?: string) =>
  new Document({
    type: "document",
    info: new Info({ sandbox: new ConfigSandbox.Info(sandbox as never) }),
    ...(file ? { path: AbsolutePath.make(file) } : {}),
  })

const service = (entries: readonly Entry[], ref: Location.Ref) =>
  testEffect(
    AppNodeBuilder.build(LayerNode.group([Sandbox.node]), [
      Config.node.replace(Config.testLayer([...entries])),
      Location.node.replace(Layer.succeed(Location.Service, Location.Service.of(location(ref)))),
    ]),
  )

const execution = {
  command: "echo 'hi there'",
  cwd: workspace,
  shell: "/bin/zsh",
  timeout: 5_000,
  environment: { AGENT: "1" },
  workspace,
  tmpRoots: ["/tmp"],
}

describe("Sandbox.resolve", () => {
  test("is off without any sandbox config, and without an explicit enable", () => {
    expect(Sandbox.resolve([], workspace)).toBeUndefined()
    expect(Sandbox.resolve([entry({ mode: "workspace-write" })], workspace)).toBeUndefined()
  })

  test("enables with the strictest defaults when only enabled is set", () => {
    expect(Sandbox.resolve([entry({ enabled: true })], workspace)).toEqual({
      mode: "read-only",
      network: "deny",
      writableRoots: [],
    })
  })

  test("keeps the strictest mode and network across layers", () => {
    expect(
      Sandbox.resolve(
        [
          entry({ enabled: true, mode: "workspace-write", network: "allow" }),
          entry({ mode: "read-only" }),
          entry({ network: "deny" }),
        ],
        workspace,
      ),
    ).toEqual({ mode: "read-only", network: "deny", writableRoots: [] })
  })

  test("widens only what no layer restricted", () => {
    expect(
      Sandbox.resolve([entry({ enabled: true }), entry({ mode: "workspace-write", network: "allow" })], workspace),
    ).toEqual({ mode: "workspace-write", network: "allow", writableRoots: [] })
  })

  test("resolves writable roots against the workspace and deduplicates them", () => {
    const policy = Sandbox.resolve(
      [entry({ enabled: true, mode: "workspace-write", writable_roots: ["dist", "/tmp/build", "./dist"] })],
      workspace,
    )
    expect(policy?.writableRoots).toEqual([path.join(workspace, "dist"), "/tmp/build"])
  })

  test("ignores repository config inside the workspace and in its ancestors", () => {
    const policy = Sandbox.resolve(
      [
        entry(
          { enabled: true, mode: "workspace-write", network: "allow", writable_roots: ["/"] },
          path.join(workspace, "opencode.json"),
        ),
        entry({ enabled: true, writable_roots: ["/etc"] }, "/opencode.json"),
        entry({ enabled: true }, "/Users/test/.config/opencode/opencode.json"),
      ],
      workspace,
    )
    expect(policy).toEqual({ mode: "read-only", network: "deny", writableRoots: [] })
  })

  test("honors config without a path, such as managed or in-memory config", () => {
    expect(Sandbox.resolve([entry({ enabled: true, mode: "workspace-write" })], workspace)?.mode).toBe(
      "workspace-write",
    )
  })
})

describe("Sandbox.request", () => {
  test("read-only keeps the workspace read-only and denies the network", () => {
    const request = Sandbox.request({ mode: "read-only", network: "deny", writableRoots: [] }, execution)
    expect(request.filesystem).toEqual({ readonlyPaths: [workspace] })
    expect(request.network).toEqual({ egress: { default: "deny" }, ingress: { default: "deny", hostLoopback: "deny" } })
    expect(request.filesystem?.readwritePaths).toBeUndefined()
    expect(request.timeoutMs).toBe(5_000)
    expect(request.environment).toEqual({ AGENT: "1" })
    expect(request.workingDirectory).toBe(workspace)
  })

  test("workspace-write writes the workspace and temp, and carves protected paths read-only", () => {
    const request = Sandbox.request(
      { mode: "workspace-write", network: "allow", writableRoots: ["/tmp/build"] },
      execution,
    )
    expect(request.filesystem).toEqual({
      readwritePaths: [workspace, "/tmp", "/tmp/build"],
      readonlyPaths: ["opencode.json", "opencode.jsonc", ".opencode", ".claude", ".agents"].map((item) =>
        path.join(workspace, item),
      ),
    })
    expect(request.network).toEqual({ egress: { default: "allow" } })
  })

  test("workspace-write denies protected paths on Windows, where read-only carve-outs are not enforced", () => {
    const request = Sandbox.request(
      { mode: "workspace-write", network: "deny", writableRoots: [] },
      execution,
      "win32",
    )
    expect(request.filesystem).toEqual({
      readwritePaths: [workspace, "/tmp"],
      deniedPaths: ["opencode.json", "opencode.jsonc", ".opencode", ".claude", ".agents"].map((item) =>
        path.join(workspace, item),
      ),
    })
  })

  test("quotes the shell and command for POSIX and Windows", () => {
    expect(Sandbox.commandLine("/bin/bash", "echo 'hi'")).toBe(`'/bin/bash' '-c' 'echo '\\''hi'\\'''`)
    expect(Sandbox.commandLine("/bin/zsh", "ls *.txt")).toBe(`'/bin/zsh' '+o' 'nomatch' '-c' 'ls *.txt'`)
    // Plain Windows tokens stay unquoted (cmd.exe rejects a quoted "/c"); only complex values are quoted.
    expect(Sandbox.commandLine("C:\\sh.exe", 'say "hi" there\\', "win32")).toBe(
      `C:\\sh.exe -c "say \\"hi\\" there\\\\"`,
    )
    expect(Sandbox.commandLine("C:\\Program Files\\sh.exe", "echo hi", "win32")).toBe(
      `"C:\\Program Files\\sh.exe" -c "echo hi"`,
    )
  })
})

describe("Sandbox.Service", () => {
  const local = Location.Ref.make({ directory: workspace })
  const it = service([entry({ enabled: true, mode: "workspace-write" })], local)

  it.effect("pins the policy on first use for the process lifetime", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const pinned = yield* sandbox.policy()
      expect(pinned).toEqual({ mode: "workspace-write", network: "deny", writableRoots: [] })
      // The same pinned object comes back on every use; the policy never re-reads config.
      expect(yield* sandbox.policy()).toBe(pinned)
    }),
  )

  const off = service([], local)

  off.effect("fails closed when the sandbox is not enabled", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const failure = yield* sandbox.execute(execution).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(Sandbox.UnavailableError)
      expect(failure.message).toContain("not enabled")
    }),
  )

  const remote = service([entry({ enabled: true })], Location.Ref.make({ directory: workspace, workspaceID: Workspace.ID.make("wrk_sandbox_test") }))

  remote.effect("fails closed for a remote workspace", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const failure = yield* sandbox.execute(execution).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(Sandbox.UnavailableError)
      expect(failure.message).toContain("remote")
    }),
  )
})

// Live enforcement tests: they run only where the MXC backend is available (Seatbelt on macOS, bubblewrap on
// Linux, ProcessContainer on Windows) and prove the generated policy is enforced by the OS, not just built.
const support: { isSupported: boolean } = (() => {
  try {
    return require("@microsoft/mxc-sdk/v1").getPlatformSupport()
  } catch {
    return { isSupported: false }
  }
})()
const live = support.isSupported && process.platform !== "win32" ? describe : describe.skip
const liveWindows = support.isSupported && process.platform === "win32" ? describe : describe.skip

const liveTmp = await tmpdir("opencode-sandbox-test-")
const liveWorkspace = AbsolutePath.make(liveTmp.path)
const liveRef = Location.Ref.make({ directory: liveWorkspace })
const write = service([entry({ enabled: true, mode: "workspace-write" })], liveRef)
const readOnly = service([entry({ enabled: true, mode: "read-only" })], liveRef)
const canary = path.join(os.homedir(), `.opencode-sandbox-live-${process.pid}.txt`)

afterAll(() => {
  require("node:fs").rmSync(canary, { force: true })
})

live("Sandbox enforcement", () => {
  write.live("captures output and the exit code of a sandboxed command", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const result = yield* sandbox.execute({
        command: "printf out; printf 'to stderr' >&2; exit 7",
        cwd: liveWorkspace,
        shell: "/bin/sh",
        timeout: 15_000,
        environment: {},
      })
      expect(result.exitCode).toBe(7)
      expect(result.stdout).toBe("out")
      expect(result.stderr).toBe("to stderr")
      expect(result.timedOut).toBe(false)
    }),
  )

  write.live("allows writes inside the workspace in workspace-write mode", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const result = yield* sandbox.execute({
        command: `echo hi > ${path.join(liveWorkspace, "inside.txt")}`,
        cwd: liveWorkspace,
        shell: "/bin/sh",
        timeout: 15_000,
        environment: {},
      })
      expect(result.exitCode).toBe(0)
      expect(yield* Effect.promise(() => Bun.file(path.join(liveWorkspace, "inside.txt")).text())).toBe("hi\n")
    }),
  )

  write.live("denies writes outside the workspace and the temp roots", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const result = yield* sandbox.execute({
        command: `echo pwned > ${canary}`,
        cwd: liveWorkspace,
        shell: "/bin/sh",
        timeout: 15_000,
        environment: {},
      })
      expect(result.exitCode).not.toBe(0)
      expect(yield* Effect.promise(() => Bun.file(canary).exists())).toBe(false)
    }),
  )

  write.live("denies planting a protected config file, and planting plugin directories", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      for (const target of ["opencode.json", ".opencode/plugins/evil.ts"]) {
        const result = yield* sandbox.execute({
          command: `mkdir -p ${path.join(liveWorkspace, path.dirname(target))} && echo evil > ${path.join(liveWorkspace, target)}`,
          cwd: liveWorkspace,
          shell: "/bin/sh",
          timeout: 15_000,
          environment: {},
        })
        expect(result.exitCode).not.toBe(0)
        expect(yield* Effect.promise(() => Bun.file(path.join(liveWorkspace, target)).exists())).toBe(false)
      }
    }),
  )

  write.live("denies network egress", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const result = yield* sandbox.execute({
        // 42 marks a host without curl, which says nothing about enforcement.
        command: "command -v curl >/dev/null || exit 42; curl -m 3 -s https://example.com >/dev/null; echo CURL=$?",
        cwd: liveWorkspace,
        shell: "/bin/sh",
        timeout: 15_000,
        environment: {},
      })
      if (result.exitCode === 42) return
      expect(result.exitCode).toBe(0)
      expect(result.stdout).not.toContain("CURL=0")
    }),
  )

  readOnly.live("denies writes inside the workspace in read-only mode", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const result = yield* sandbox.execute({
        command: `echo no > ${path.join(liveWorkspace, "denied.txt")}`,
        cwd: liveWorkspace,
        shell: "/bin/sh",
        timeout: 15_000,
        environment: {},
      })
      expect(result.exitCode).not.toBe(0)
      expect(yield* Effect.promise(() => Bun.file(path.join(liveWorkspace, "denied.txt")).exists())).toBe(false)
    }),
  )

  write.live("stops a command at its timeout", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const result = yield* sandbox.execute({
        command: "sleep 30",
        cwd: liveWorkspace,
        shell: "/bin/sh",
        timeout: 1_500,
        environment: {},
      })
      expect(result.timedOut).toBe(true)
    }),
  )
})

liveWindows("Sandbox enforcement on Windows", () => {
  write.live("captures output and allows writes inside the workspace", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const result = yield* sandbox.execute({
        command: `echo hi> ${path.join(liveWorkspace, "inside.txt")}`,
        cwd: liveWorkspace,
        shell: process.env.COMSPEC || "cmd.exe",
        timeout: 15_000,
        environment: {},
      })
      expect(result.exitCode).toBe(0)
      expect(yield* Effect.promise(() => Bun.file(path.join(liveWorkspace, "inside.txt")).text())).toContain("hi")
    }),
  )

  write.live("denies writes outside the workspace", () =>
    Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const result = yield* sandbox.execute({
        command: `echo pwned> ${canary}`,
        cwd: liveWorkspace,
        shell: process.env.COMSPEC || "cmd.exe",
        timeout: 15_000,
        environment: {},
      })
      expect(result.exitCode).not.toBe(0)
      expect(yield* Effect.promise(() => Bun.file(canary).exists())).toBe(false)
    }),
  )
})
