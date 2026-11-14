import { describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs"
import { tmpdir } from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Permission } from "@opencode/core/permission"
import { Sandbox } from "@opencode/core/sandbox"
import { Agent } from "@opencode/schema/agent"
import { Directory, Document, Info } from "@opencode/schema/config"
import { AbsolutePath } from "@opencode/core/schema"
import { ConfigSandbox } from "@opencode/schema/config/sandbox"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { WellKnown } from "@opencode/core/wellknown"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { emptyCredentialNode, emptyWellknownNode } from "./fixture/config-nodes"
import { location as locationFixture } from "./fixture/location"

const command = { program: "/bin/sh", args: ["-c", "echo hi"] }
const input = {
  policy: { mode: "workspace-write", network: "deny" } as const,
  command,
  cwd: "/work/project/sub",
  workspace: "/work/project",
  find: (name: string) => `/usr/bin/${name}`,
}

const wrapped = (override: Partial<Sandbox.WrapInput>) => {
  const result = Sandbox.wrap({ ...input, ...override })
  if (result instanceof Sandbox.UnavailableError) throw result
  return result
}

describe("Sandbox permissions", () => {
  test("the shipped agent defaults ask before leaving the sandbox", () => {
    const rules = Agent.Info.default(Agent.ID.make("build")).permissions
    expect(Permission.evaluate("shell", "ls", rules).effect).toBe("allow")
    expect(Permission.evaluate("shell_unsandboxed", "ls", rules).effect).toBe("ask")
  })
})

describe("Sandbox.resolve", () => {
  test("is off unless enabled, and defaults to the strictest settings", () => {
    expect(Sandbox.resolve(undefined)).toBeUndefined()
    expect(Sandbox.resolve(new ConfigSandbox.Info({ mode: "read-only", network: "allow" }))).toBeUndefined()
    expect(Sandbox.resolve(new ConfigSandbox.Info({ enabled: false }))).toBeUndefined()
    expect(Sandbox.resolve(new ConfigSandbox.Info({ enabled: true }))).toEqual({
      mode: "workspace-write",
      network: "deny",
    })
    expect(Sandbox.resolve(new ConfigSandbox.Info({ enabled: true, mode: "read-only", network: "allow" }))).toEqual({
      mode: "read-only",
      network: "allow",
    })
  })
})

describe("Sandbox.wrap on Linux", () => {
  const linux = { platform: "linux" } as const

  test("wraps the command in bwrap with every namespace unshared, a read-only root and a workspace-only write bind", () => {
    const result = wrapped(linux)
    expect(result.program).toBe("/usr/bin/bwrap")
    expect(result.args).toEqual([
      "--die-with-parent",
      "--new-session",
      "--unshare-all",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
      "--bind",
      "/work/project",
      "/work/project",
      "--chdir",
      "/work/project/sub",
      "--",
      "/bin/sh",
      "-c",
      "echo hi",
    ])
    expect(result.args.filter((arg) => arg === "--bind")).toHaveLength(1)
  })

  test("read-only binds nothing writable from the host", () => {
    const result = wrapped({ ...linux, policy: { mode: "read-only", network: "deny" } })
    expect(result.args).not.toContain("--bind")
    expect(result.args).toContain("--ro-bind")
  })

  test("read-only still binds the real workspace directory after the /tmp tmpfs, so a workspace under /tmp stays reachable", () => {
    // Regression: --tmpfs /tmp replaces everything under /tmp with an empty, private filesystem. Without a bind for
    // the workspace itself afterwards, a workspace located under /tmp (common for tests and some sandboxed runners)
    // would resolve to that empty tmpfs instead of the real directory, breaking --chdir and every file read.
    const result = wrapped({ ...linux, policy: { mode: "read-only", network: "deny" }, workspace: "/tmp/ws" })
    const tmpfs = result.args.indexOf("/tmp")
    const bind = result.args.findIndex(
      (arg, i) => arg === "--ro-bind-try" && result.args[i + 1] === "/tmp/ws" && result.args[i + 2] === "/tmp/ws",
    )
    expect(bind).toBeGreaterThan(tmpfs)
  })

  test("denies the network unless the policy allows it", () => {
    expect(wrapped(linux).args).not.toContain("--share-net")
    expect(wrapped({ ...linux, policy: { mode: "workspace-write", network: "allow" } }).args).toContain("--share-net")
    expect(wrapped({ ...linux, policy: { mode: "workspace-write", network: "allow" } }).args).toContain("--unshare-all")
  })

  test("keeps the command argv intact after the separator, whatever it contains", () => {
    const hostile = { program: "/bin/sh", args: ["-c", "echo '--bind / /'; $(rm -rf /)"] }
    const result = wrapped({ ...linux, command: hostile })
    expect(result.args.slice(result.args.indexOf("--") + 1)).toEqual([hostile.program, ...hostile.args])
  })

  test("fails closed when bwrap is missing", () => {
    const result = Sandbox.wrap({ ...input, ...linux, find: () => undefined })
    expect(result).toBeInstanceOf(Sandbox.UnavailableError)
    expect(String((result as Sandbox.UnavailableError).message)).toContain("bwrap was not found")
  })
})

describe("Sandbox.wrap on macOS", () => {
  const darwin = { platform: "darwin" } as const

  test("wraps the command in sandbox-exec with a deny-default profile and parameterized directories", () => {
    const result = wrapped(darwin)
    expect(result.program).toBe("/usr/bin/sandbox-exec")
    expect(result.args[0]).toBe("-p")
    const profile = result.args[1] ?? ""
    expect(profile.split("\n").slice(0, 2)).toEqual(["(version 1)", "(deny default)"])
    expect(profile).toContain('(subpath (param "WORKSPACE"))')
    expect(result.args).toContain("WORKSPACE=/work/project")
    expect(result.args.slice(result.args.indexOf("--") + 1)).toEqual([command.program, ...command.args])
    // A path never lands in the profile text, so it cannot break out of it.
    expect(profile).not.toContain("/work/project")
  })

  test("allows writes only in workspace-write mode", () => {
    const writable = Sandbox.seatbeltProfile({ mode: "workspace-write", network: "deny" })
    const readonly = Sandbox.seatbeltProfile({ mode: "read-only", network: "deny" })
    expect(writable).toContain('(subpath (param "WORKSPACE"))')
    expect(readonly).not.toContain("WORKSPACE")
    expect(readonly).not.toContain("/private/tmp")
  })

  test("denies the network unless the policy allows it", () => {
    expect(Sandbox.seatbeltProfile({ mode: "workspace-write", network: "deny" })).not.toContain("network")
    expect(Sandbox.seatbeltProfile({ mode: "workspace-write", network: "allow" })).toContain("(allow network*)")
  })

  test("fails closed when sandbox-exec is missing", () => {
    const result = Sandbox.wrap({ ...input, ...darwin, find: () => undefined })
    expect(result).toBeInstanceOf(Sandbox.UnavailableError)
    expect(String((result as Sandbox.UnavailableError).message)).toContain("sandbox-exec was not found")
  })
})

describe("Sandbox.wrap without a backend", () => {
  test("fails closed on platforms without one and for remote workspaces", () => {
    expect(Sandbox.wrap({ ...input, platform: "win32" })).toBeInstanceOf(Sandbox.UnavailableError)
    expect(Sandbox.wrap({ ...input, platform: "linux", remote: true })).toBeInstanceOf(Sandbox.UnavailableError)
  })
})

const layer = (sandbox?: ConstructorParameters<typeof ConfigSandbox.Info>[0], documentPath?: string) =>
  new Document({
    type: "document",
    ...(documentPath ? { path: AbsolutePath.make(documentPath) } : {}),
    info: new Info(sandbox ? { sandbox: new ConfigSandbox.Info(sandbox) } : {}),
  })

describe("Sandbox.merge", () => {
  test("merges layers field by field, so a partial higher layer cannot drop enabled", () => {
    const merged = Sandbox.merge([layer({ enabled: true, mode: "read-only" }), layer(), layer({ network: "allow" })])
    expect(merged).toMatchObject({ enabled: true, mode: "read-only", network: "allow" })
    expect(Sandbox.resolve(merged)).toEqual({ mode: "read-only", network: "allow" })
    expect(Sandbox.resolve(Sandbox.merge([layer({ enabled: true }), layer({ mode: "read-only" })]))).toEqual({
      mode: "read-only",
      network: "deny",
    })
  })

  test("a later layer cannot loosen enabled, read-only or network deny", () => {
    expect(Sandbox.resolve(Sandbox.merge([layer({ enabled: true }), layer({ enabled: false })]))).toEqual({
      mode: "workspace-write",
      network: "deny",
    })
    expect(
      Sandbox.resolve(Sandbox.merge([layer({ enabled: true, mode: "read-only" }), layer({ mode: "workspace-write" })]))
        ?.mode,
    ).toBe("read-only")
    expect(
      Sandbox.resolve(Sandbox.merge([layer({ enabled: true, network: "deny" }), layer({ network: "allow" })]))?.network,
    ).toBe("deny")
    expect(Sandbox.merge([layer()])).toBeUndefined()
    expect(Sandbox.merge([])).toBeUndefined()
  })
})

describe("Sandbox.policy", () => {
  // The policy is read once per workspace, before any confined command runs. A config file that a command creates
  // or rewrites later cannot change it, so a workspace-write command cannot grant itself network access or extra
  // roots on its next invocation.
  const document = (sandbox: ConstructorParameters<typeof ConfigSandbox.Info>[0]) => layer(sandbox)
  const workspace = "/work/project"

  test("pins the first policy for a workspace, ignoring later config changes", () => {
    Sandbox.resetPolicies()
    expect(Sandbox.policy([document({ enabled: true, writable_roots: ["/data/a"] })], workspace)).toEqual({
      mode: "workspace-write",
      network: "deny",
      writableRoots: ["/data/a"],
    })
    // What a confined command could have written after the first command started.
    expect(
      Sandbox.policy([document({ enabled: true, writable_roots: ["/home"], network: "allow" })], workspace),
    ).toEqual({
      mode: "workspace-write",
      network: "deny",
      writableRoots: ["/data/a"],
    })
  })

  test("pins disabled too, and keys the policy by workspace", () => {
    Sandbox.resetPolicies()
    expect(Sandbox.policy([document({ network: "allow" })], workspace)).toBeUndefined()
    expect(Sandbox.policy([document({ enabled: true })], "/work/other")).toEqual({
      mode: "workspace-write",
      network: "deny",
    })
    Sandbox.resetPolicies()
    expect(Sandbox.policy([document({ enabled: true })], workspace)).toEqual({
      mode: "workspace-write",
      network: "deny",
    })
  })
})

describe("Sandbox.merge through the config service", () => {
  // The service returns documents lowest priority first, mixed with directory sources that carry no settings.
  const entriesOf = (entries: Parameters<typeof Config.testLayer>[0]) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.entries()
      }).pipe(Effect.provide(Config.testLayer(entries))),
    )

  test("ignores directory entries and keeps the sandbox enabled when a project document sets other fields", async () => {
    const entries = await entriesOf([
      layer({ enabled: true, mode: "read-only", network: "deny", writable_roots: ["/data/a"] }),
      new Directory({ type: "directory", path: AbsolutePath.make("/work/project/.opencode") }),
      layer({ enabled: false, mode: "workspace-write", network: "allow", writable_roots: ["/data/b"] }),
      layer(),
    ])
    expect(entries).toHaveLength(4)
    expect(Sandbox.resolve(Sandbox.merge(entries))).toEqual({
      mode: "read-only",
      network: "deny",
      writableRoots: ["/data/a", "/data/b"],
    })
  })

  test("a lone partial document does not enable anything", async () => {
    const entries = await entriesOf([layer({ network: "allow" }), layer({ mode: "read-only" })])
    expect(Sandbox.resolve(Sandbox.merge(entries))).toBeUndefined()
  })
})

// Boots the real Config service (real discovery walking real directories, real file parsing) instead of
// Config.testLayer's synthetic entries, so the trust boundary in Sandbox.merge is proven against documents the way
// they are actually discovered and ordered in production: see packages/core/test/config/config.test.ts for the
// pattern this mirrors.
function realConfigLayer(directory: string, globalDirectory: string) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(locationFixture({ directory: AbsolutePath.make(directory) })),
  )
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ system: false })),
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: globalDirectory, home: path.join(globalDirectory, "home") })),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
  return Layer.mergeAll(built, Watcher.testLayer)
}

describe("Sandbox.merge against a real, on-disk config tree", () => {
  const withRealConfig = (body: (workspace: string, global: string) => Promise<void> | void) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "sandbox-real-config-")))
    const workspace = path.join(root, "workspace")
    const global = path.join(root, "global")
    mkdirSync(workspace, { recursive: true })
    mkdirSync(global, { recursive: true })
    return Promise.resolve(body(workspace, global)).finally(() => rmSync(root, { recursive: true, force: true }))
  }

  const entriesOf = (workspace: string, global: string) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const config = yield* Config.Service
        return yield* config.entries()
      }).pipe(Effect.provide(realConfigLayer(workspace, global))),
    )

  test("a workspace-root opencode.json can add roots, while a global network deny still wins", () =>
    withRealConfig(async (workspace, global) => {
      writeFileSync(
        path.join(global, "opencode.json"),
        JSON.stringify({
          sandbox: { enabled: true, mode: "workspace-write", network: "deny", writable_roots: ["/trusted"] },
        }),
      )
      // What a confined workspace-write command could have written itself, since this file did not yet exist.
      writeFileSync(
        path.join(workspace, "opencode.json"),
        JSON.stringify({ sandbox: { writable_roots: ["/etc"], network: "allow" } }),
      )
      const entries = await entriesOf(workspace, global)
      // The workspace document really is discovered and really does carry its own filesystem path.
      const workspaceDocument = entries.find(
        (entry): entry is Document => entry.type === "document" && entry.path === path.join(workspace, "opencode.json"),
      )
      expect(workspaceDocument).toBeDefined()
      const merged = Sandbox.merge(entries)
      expect(merged?.enabled).toBe(true)
      expect(merged?.writable_roots).toEqual(["/trusted", "/etc"])
      expect(merged?.network).toBe("deny")
    }))

  test("a document in the workspace's own .opencode directory contributes roots and network", () =>
    withRealConfig(async (workspace, global) => {
      writeFileSync(path.join(global, "opencode.json"), JSON.stringify({ sandbox: { enabled: true } }))
      mkdirSync(path.join(workspace, ".opencode"))
      writeFileSync(
        path.join(workspace, ".opencode", "opencode.json"),
        JSON.stringify({ sandbox: { writable_roots: ["/etc"], network: "allow" } }),
      )
      const entries = await entriesOf(workspace, global)
      const merged = Sandbox.merge(entries)
      expect(merged?.writable_roots).toEqual(["/etc"])
      expect(merged?.network).toBe("allow")
    }))

  test("an ancestor directory's config, outside the workspace, is trusted and can widen roots", () =>
    withRealConfig(async (parentWorkspace, global) => {
      // Nest the real workspace one level below the temp root so an ancestor file exists above it; discovery walks
      // upward from location.directory, so this ancestor file is found the same way a real repo root config would be.
      const nested = path.join(parentWorkspace, "nested")
      mkdirSync(nested)
      writeFileSync(
        path.join(parentWorkspace, "opencode.json"),
        JSON.stringify({ sandbox: { enabled: true, writable_roots: ["/trusted"] } }),
      )
      const entries = await entriesOf(nested, global)
      const merged = Sandbox.merge(entries)
      expect(merged?.writable_roots).toEqual(["/trusted"])
    }))
})

describe("Sandbox roots", () => {
  test("writable_roots and readable_roots accumulate across layers and reach the policy", () => {
    const merged = Sandbox.merge([
      layer({ enabled: true, writable_roots: ["/data/a"], readable_roots: ["/opt/r"] }),
      layer({ network: "allow" }),
      layer({ writable_roots: ["/data/b", "/data/a"] }),
    ])
    expect(merged?.writable_roots).toEqual(["/data/a", "/data/b"])
    expect(merged?.readable_roots).toEqual(["/opt/r"])
    expect(Sandbox.resolve(merged)).toEqual({
      mode: "workspace-write",
      network: "allow",
      writableRoots: ["/data/a", "/data/b"],
      readableRoots: ["/opt/r"],
    })
    expect(Sandbox.merge([layer({ enabled: true })])?.writable_roots).toBeUndefined()
  })

  test("bwrap mounts writable roots read-write and readable roots read-only, relative ones against the workspace", () => {
    const policy = {
      mode: "workspace-write",
      network: "deny",
      writableRoots: ["/data/a", "rel"],
      readableRoots: ["/opt/r"],
    } as const
    const args = wrapped({ policy }).args
    const has = (flag: string, target: string) =>
      args.some((arg, i) => arg === flag && args[i + 1] === target && args[i + 2] === target)
    expect(has("--bind-try", "/data/a")).toBe(true)
    expect(has("--bind-try", "/work/project/rel")).toBe(true)
    expect(has("--ro-bind-try", "/opt/r")).toBe(true)
    const readOnly = wrapped({ policy: { ...policy, mode: "read-only" } }).args
    expect(readOnly).not.toContain("--bind-try")
    expect(readOnly).toContain("--ro-bind-try")
  })

  test("seatbelt grants writable roots through parameters and keeps config files read-only", () => {
    const policy = { mode: "workspace-write", network: "deny", writableRoots: ["/data/a"] } as const
    const args = wrapped({ policy, platform: "darwin" }).args
    expect(args).toContain("WRITABLE_0=/data/a")
    const profile = args[args.indexOf("-p") + 1]
    expect(profile).toContain('(allow file-write* (subpath (param "WRITABLE_0")))')
    expect(profile).not.toContain("/data/a")
    const lines = profile.split("\n")
    const deny = lines.findIndex((line) => line.startsWith("(deny file-write*") && line.includes('"WORKSPACE"'))
    expect(deny).toBeGreaterThan(
      lines.findIndex((line) => line.includes('(param "WORKSPACE")) (subpath (param "TMPDIR"))')),
    )
    for (const name of Sandbox.PROTECTED) expect(lines[deny]).toContain(`/${name}`)
    expect(lines.some((line) => line.startsWith("(deny file-write*") && line.includes('"WRITABLE_0"'))).toBe(true)
    expect(wrapped({ policy: { ...policy, mode: "read-only" }, platform: "darwin" }).args.join(" ")).not.toContain(
      "WRITABLE_0",
    )
  })
})

describe("Sandbox protected config files", () => {
  test("binds existing config files read-only inside the writable workspace, after the workspace bind", () => {
    const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "sandbox-protect-")))
    try {
      writeFileSync(path.join(workspace, "opencode.json"), "{}")
      writeFileSync(path.join(workspace, "opencode.jsonc"), "{}")
      mkdirSync(path.join(workspace, ".opencode"))
      const args = Sandbox.bwrapArgs(
        { policy: { mode: "workspace-write", network: "deny" }, cwd: workspace },
        workspace,
      )
      const bind = args.indexOf("--bind")
      expect(bind).toBeGreaterThan(-1)
      for (const name of Sandbox.PROTECTED) {
        const target = path.join(workspace, name)
        const at = args.findIndex((arg, i) => arg === target && i > bind)
        expect(at).toBeGreaterThan(bind)
        expect(args[at - 1]).toBe("--ro-bind")
      }
      expect(Sandbox.PROTECTED).toEqual(["opencode.json", "opencode.jsonc", ".opencode"])
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("does not create mount points for config files that do not exist", () => {
    const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "sandbox-protect-")))
    try {
      const args = Sandbox.bwrapArgs(
        { policy: { mode: "workspace-write", network: "deny" }, cwd: workspace },
        workspace,
      )
      for (const name of Sandbox.PROTECTED) {
        expect(args).not.toContain(path.join(workspace, name))
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("a dangling symlink at a protected name is treated like any other absent path, not bound", () => {
    // A dangling symlink is ordinary workspace content a workspace-write command may create freely, like a plain
    // absent file, so it gets no mount point. The policy is pinned before commands run (Sandbox.policy), so config
    // written this way cannot change the running process's sandbox settings.
    const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "sandbox-protect-dangling-")))
    try {
      symlinkSync(path.join(workspace, "does-not-exist"), path.join(workspace, "opencode.json"))
      expect(existsSync(path.join(workspace, "opencode.json"))).toBe(false)
      const args = Sandbox.bwrapArgs(
        { policy: { mode: "workspace-write", network: "deny" }, cwd: workspace },
        workspace,
      )
      expect(args).not.toContain(path.join(workspace, "opencode.json"))
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

// Executes a real bubblewrap. Skipped where bwrap is missing or user namespaces are unavailable.
const bwrap = Bun.which("bwrap")
const usable =
  process.platform === "linux" &&
  bwrap !== null &&
  Bun.spawnSync([bwrap, "--unshare-all", "--ro-bind", "/", "/", "--", "/bin/sh", "-c", "true"]).exitCode === 0
const live = usable ? describe : describe.skip

live("Sandbox on a real bubblewrap", () => {
  const run = (
    workspace: string,
    script: string,
    policy: Sandbox.Policy = { mode: "workspace-write", network: "deny" },
  ) => {
    const result = Sandbox.wrap({
      policy,
      command: { program: "/bin/sh", args: ["-c", script] },
      cwd: workspace,
      workspace,
      platform: "linux",
    })
    if (result instanceof Sandbox.UnavailableError) throw result
    const proc = Bun.spawnSync([result.program, ...result.args], { cwd: workspace })
    return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
  }
  const withWorkspace = (body: (workspace: string, outside: string) => void) => {
    const root = realpathSync(mkdtempSync(path.join(process.env.HOME ?? "/var/tmp", ".sandbox-live-")))
    const workspace = path.join(root, "workspace")
    const outside = path.join(root, "outside")
    mkdirSync(workspace)
    mkdirSync(outside)
    try {
      body(workspace, outside)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  test("writes inside the workspace and is denied everywhere else", () =>
    withWorkspace((workspace, outside) => {
      expect(run(workspace, "echo inside > inside.txt").code).toBe(0)
      expect(readFileSync(path.join(workspace, "inside.txt"), "utf8").trim()).toBe("inside")

      const escaped = run(workspace, `echo escaped > ${outside}/escaped.txt`)
      expect(escaped.code).not.toBe(0)
      expect(Bun.file(path.join(outside, "escaped.txt")).size).toBe(0)
      expect(run(workspace, "echo x > /etc/sandbox-escape").code).not.toBe(0)
      // /tmp is private, so a write there never reaches the host.
      expect(run(workspace, `echo t > /tmp/sandbox-live-${path.basename(outside)}`).code).toBe(0)
      expect(Bun.file(`/tmp/sandbox-live-${path.basename(outside)}`).size).toBe(0)
    }))

  test("read-only mode cannot write even in the workspace", () =>
    withWorkspace((workspace) => {
      const result = run(workspace, "echo no > file.txt", { mode: "read-only", network: "deny" })
      expect(result.code).not.toBe(0)
      expect(Bun.file(path.join(workspace, "file.txt")).size).toBe(0)
    }))

  test("cannot rewrite, replace or delete existing opencode config files", () =>
    withWorkspace((workspace) => {
      const config = path.join(workspace, "opencode.json")
      const configc = path.join(workspace, "opencode.jsonc")
      writeFileSync(config, '{"sandbox":{"enabled":true}}')
      writeFileSync(configc, '{"sandbox":{"network":"deny"}}')
      mkdirSync(path.join(workspace, ".opencode"))
      writeFileSync(path.join(workspace, ".opencode", "keep.txt"), "keep")
      writeFileSync(path.join(workspace, "other.json"), "{}")
      // Control: the same operations on an unprotected sibling succeed, so the failures below come from the protection.
      expect(run(workspace, "echo x >> other.json && mv other.json moved-other.json && rm moved-other.json").code).toBe(
        0,
      )
      for (const script of [
        `echo '{"sandbox":{"enabled":false}}' > opencode.json`,
        `echo x >> opencode.json`,
        `mv opencode.json moved.json`,
        `rm -f opencode.json`,
        `echo x >> opencode.jsonc`,
        `rm -f opencode.jsonc`,
        `echo x > .opencode/file`,
        `mkdir .opencode/sub`,
        `rm -f .opencode/keep.txt`,
        `rm -rf .opencode`,
        `mv .opencode .opencode-moved`,
        // Replace by rename from a fresh file, the usual atomic-write pattern.
        `echo '{}' > replacement.json && mv -f replacement.json opencode.json`,
      ]) {
        const result = run(workspace, script)
        expect(result.code).not.toBe(0)
        expect(result.err).toMatch(/Read-only file system|busy|Device or resource/i)
      }
      expect(readFileSync(config, "utf8")).toBe('{"sandbox":{"enabled":true}}')
      expect(readFileSync(configc, "utf8")).toBe('{"sandbox":{"network":"deny"}}')
      expect(readFileSync(path.join(workspace, ".opencode", "keep.txt"), "utf8")).toBe("keep")
      expect(existsSync(path.join(workspace, ".opencode", "file"))).toBe(false)
      expect(existsSync(path.join(workspace, ".opencode", "sub"))).toBe(false)
      expect(existsSync(path.join(workspace, "moved.json"))).toBe(false)
      expect(existsSync(path.join(workspace, ".opencode-moved"))).toBe(false)
    }))

  test("does not leave config stubs behind in a clean workspace", () =>
    withWorkspace((workspace) => {
      expect(run(workspace, "echo ok > inside.txt").code).toBe(0)
      expect(readdirSync(workspace)).toEqual(["inside.txt"])
    }))

  test("runs with a symlinked config instead of failing to mount, and leaves the link target alone", () =>
    withWorkspace((workspace, outside) => {
      const target = path.join(outside, "real.json")
      writeFileSync(target, '{"x":1}')
      symlinkSync(target, path.join(workspace, "opencode.json"))
      // bubblewrap refuses to mount on a symlink destination, so the path is skipped instead of breaking every command.
      expect(run(workspace, "true").code).toBe(0)
      expect(run(workspace, "echo x > opencode.json").code).not.toBe(0)
      expect(readFileSync(target, "utf8")).toBe('{"x":1}')
    }))

  test("mounts writable_roots read-write and readable_roots, protecting config files inside them", () =>
    withWorkspace((workspace, outside) => {
      const extra = path.join(outside, "extra")
      mkdirSync(extra)
      writeFileSync(path.join(extra, "opencode.json"), "{}")
      writeFileSync(path.join(outside, "note.txt"), "readable")
      const policy = {
        mode: "workspace-write",
        network: "deny",
        writableRoots: [extra],
        readableRoots: [outside],
      } as const
      expect(run(workspace, `echo ok > ${extra}/file.txt`, policy).code).toBe(0)
      expect(readFileSync(path.join(extra, "file.txt"), "utf8").trim()).toBe("ok")
      expect(run(workspace, `cat ${outside}/note.txt`, policy).out.trim()).toBe("readable")
      expect(run(workspace, `echo x > ${outside}/other.txt`, policy).code).not.toBe(0)
      expect(run(workspace, `echo x > ${extra}/opencode.json`, policy).code).not.toBe(0)
      expect(readFileSync(path.join(extra, "opencode.json"), "utf8")).toBe("{}")
    }))

  test("a config document written inside the workspace cannot change the pinned policy", () =>
    withWorkspace((workspace, outside) => {
      // A workspace-write command can create or edit opencode.json inside the workspace it can already write to.
      // The policy was pinned before that command ran, so asking for an extra writable root is too late.
      Sandbox.resetPolicies()
      const configPath = path.join(workspace, "opencode.json")
      const initial = new Document({
        type: "document",
        path: AbsolutePath.make(configPath),
        info: new Info({
          sandbox: new ConfigSandbox.Info({ enabled: true, mode: "workspace-write", network: "deny" }),
        }),
      })
      const pinned = Sandbox.policy([initial], workspace)!
      writeFileSync(configPath, JSON.stringify({ sandbox: { writable_roots: [outside], network: "allow" } }))
      const attacker = new Document({
        type: "document",
        path: AbsolutePath.make(configPath),
        info: new Info({ sandbox: new ConfigSandbox.Info({ writable_roots: [outside], network: "allow" }) }),
      })
      expect(Sandbox.policy([initial, attacker], workspace)).toEqual(pinned)
      expect(pinned.writableRoots).toBeUndefined()
      const result = run(workspace, `echo escaped > ${outside}/escaped.txt`, pinned)
      expect(result.code).not.toBe(0)
      expect(Bun.file(path.join(outside, "escaped.txt")).size).toBe(0)
      Sandbox.resetPolicies()
    }))

  test("read-only mode keeps a workspace located under /tmp reachable", () => {
    const root = realpathSync(mkdtempSync(path.join("/tmp", "sandbox-live-readonly-")))
    try {
      writeFileSync(path.join(root, "marker.txt"), "present")
      const result = run(root, "cat marker.txt", { mode: "read-only", network: "deny" })
      expect(result.code).toBe(0)
      expect(result.out.trim()).toBe("present")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("denies the network by default and shares it only when allowed", () =>
    withWorkspace((workspace) => {
      const denied = run(workspace, "cat /proc/net/dev | tail -n +3 | grep -v '^ *lo:' | wc -l")
      expect(denied.code).toBe(0)
      expect(denied.out.trim()).toBe("0")
      const allowed = run(workspace, "cat /proc/net/dev | tail -n +3 | wc -l", {
        mode: "workspace-write",
        network: "allow",
      })
      expect(Number(allowed.out.trim())).toBe(
        readFileSync("/proc/net/dev", "utf8").split("\n").filter(Boolean).slice(2).length,
      )
    }))
})
