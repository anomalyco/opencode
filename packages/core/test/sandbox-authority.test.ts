import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "../src/location"
import { Reference } from "../src/reference"
import { InstructionBuiltIns } from "../src/instructions/builtins"
import { PluginInternal } from "../src/plugin/internal"
import { Sandbox } from "../src/sandbox"
import { MacSandbox } from "../src/sandbox/macos"
import { AbsolutePath } from "../src/schema"
import { Workspace } from "../src/workspace"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it, testEffect } from "./lib/effect"
import { InternalPluginTestLayer } from "./plugin/fixture"
import { readInitial } from "./lib/instructions"

testEffect(InternalPluginTestLayer).live("the shipped browser plugin is unavailable to sandboxed sessions", () =>
  Effect.gen(function* () {
    const sandbox = yield* Sandbox.Service
    const stock = yield* PluginInternal.list()
    expect(stock.post.some((plugin) => plugin.id === "opencode.browser")).toBe(true)
    const confined = yield* PluginInternal.list().pipe(
      Effect.provideService(Sandbox.Service, { ...sandbox, enabled: true }),
    )
    expect(confined.post.some((plugin) => plugin.id === "opencode.browser")).toBe(false)
    expect(confined.pre.map((plugin) => plugin.id)).toEqual(stock.pre.map((plugin) => plugin.id))
    expect(confined.post.map((plugin) => plugin.id)).toEqual(
      stock.post.filter((plugin) => plugin.id !== "opencode.browser").map((plugin) => plugin.id),
    )
  }),
)

const probe =
  process.platform === "darwin"
    ? Bun.spawnSync([MacSandbox.executable, "-p", "(version 1)(allow default)", "/usr/bin/true"])
    : undefined
const macos = probe?.exitCode === 0 ? it.live : it.live.skip
macos("subagent Location validation pins canonical workspace identity and refuses another execution host", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-sandbox-authority-")
    const root = path.join(tmp.path, "workspace")
    const outside = path.join(tmp.path, "outside")
    const alias = path.join(tmp.path, "alias")
    yield* Effect.promise(async () => {
      await fs.mkdir(root)
      await fs.mkdir(outside)
      await fs.symlink(root, alias)
    })
    yield* Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      yield* sandbox.checkLocation(Location.Ref.make({ directory: AbsolutePath.make(root) }))
      yield* sandbox.checkLocation(Location.Ref.make({ directory: AbsolutePath.make(alias) }))
      expect(
        yield* Effect.flip(sandbox.checkLocation(Location.Ref.make({ directory: AbsolutePath.make(outside) }))),
      ).toBeInstanceOf(Sandbox.UnavailableError)
      expect(
        yield* Effect.flip(
          sandbox.checkLocation(
            Location.Ref.make({ directory: AbsolutePath.make(root), workspaceID: Workspace.ID.create() }),
          ),
        ),
      ).toBeInstanceOf(Sandbox.UnavailableError)
      yield* Effect.promise(async () => {
        await fs.unlink(alias)
        await fs.symlink(outside, alias)
      })
      expect(
        yield* Effect.flip(sandbox.checkLocation(Location.Ref.make({ directory: AbsolutePath.make(alias) }))),
      ).toBeInstanceOf(Sandbox.UnavailableError)
    }).pipe(
      Effect.provide(
        LayerNode.compile(Sandbox.configured({ enabled: true }), {
          replacements: [
            Location.node.replace(
              Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(alias) }))),
            ),
            Global.node.replace(
              Global.layerWith({
                home: tmp.path,
                config: path.join(tmp.path, "config"),
                data: path.join(tmp.path, "data"),
                state: path.join(tmp.path, "state"),
                tmp: path.join(tmp.path, "scratch"),
              }),
            ),
          ],
        }),
      ),
    )
  }),
)

macos("environment instructions name the writable scratch directory used by sandboxed commands", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-sandbox-instructions-")
    const workspace = path.join(tmp.path, "workspace")
    yield* Effect.promise(() => fs.mkdir(workspace))
    yield* Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const builtins = yield* InstructionBuiltIns.Service
      const instructions = yield* readInitial(yield* builtins.load())
      const scratch = sandbox.scratch
      if (!scratch) return yield* Effect.die("Sandbox did not create scratch")
      expect(instructions.text).toContain(`Prefer ${scratch} for temporary files`)
      const command = yield* sandbox.command({
        command: "/bin/sh",
        args: ["-c", 'printf "scratch" > "$TMPDIR/probe"; printf "%s" "$TMPDIR"'],
        env: {},
      })
      const result = Bun.spawnSync([command.command, ...command.args], { env: command.env, cwd: workspace })
      expect(result.exitCode).toBe(0)
      expect(result.stdout.toString()).toBe(scratch)
      expect(yield* Effect.promise(() => fs.readFile(path.join(scratch, "probe"), "utf8"))).toBe("scratch")
    }).pipe(
      Effect.provide(
        LayerNode.compile(LayerNode.group([InstructionBuiltIns.node, Sandbox.node]), {
          replacements: [
            Sandbox.node.replace(Sandbox.configured({ enabled: true })),
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(workspace) })),
              ),
            ),
            Global.node.replace(
              Global.layerWith({
                home: tmp.path,
                config: path.join(tmp.path, "config"),
                data: path.join(tmp.path, "data"),
                state: path.join(tmp.path, "state"),
                tmp: path.join(tmp.path, "scratch"),
              }),
            ),
          ],
        }),
      ),
    )
  }),
)

macos("reference changes grant read-only shell, file, and search access without exposing host data", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-sandbox-references-")
    const workspace = path.join(tmp.path, "workspace")
    const external = path.join(tmp.path, "reference")
    const data = path.join(tmp.path, "data")
    const repo = path.join(data, "repos", "owner", "repo")
    const missing = path.join(tmp.path, "not-yet-cloned")
    const untrusted = path.join(workspace, "missing-reference")
    const privateDir = path.join(tmp.path, "private")
    const alias = path.join(tmp.path, "reference-alias")
    yield* Effect.promise(async () => {
      await fs.mkdir(workspace)
      await fs.mkdir(external)
      await fs.mkdir(privateDir)
      await fs.mkdir(repo, { recursive: true })
      await fs.writeFile(path.join(external, "readme"), "external-reference")
      await fs.writeFile(path.join(privateDir, "secret"), "private-canary")
      await fs.writeFile(path.join(repo, "readme"), "cached-reference")
      await fs.writeFile(path.join(data, "auth.json"), "private-auth")
      await fs.writeFile(path.join(data, "opencode.db"), "private-database")
      await fs.symlink(external, alias, "dir")
    })
    let paths: string[] = []
    const referenceLayer = Layer.mock(Reference.Service, {
      list: () =>
        Effect.sync(() =>
          paths.map((value, index) => {
            const target = AbsolutePath.make(value)
            return Reference.Info.make({
              name: `ref-${index}`,
              path: target,
              source: Reference.LocalSource.make({ type: "local", path: target }),
            })
          }),
        ),
    })
    yield* Effect.gen(function* () {
      const sandbox = yield* Sandbox.Service
      const run = Effect.fnUntraced(function* (command: string) {
        const launch = yield* sandbox.command({ command: "/bin/sh", args: ["-c", command], env: {} })
        return Bun.spawnSync([launch.command, ...launch.args], { cwd: workspace, env: launch.env })
      })
      expect((yield* run(`cat '${external}/readme'`)).exitCode).not.toBe(0)
      paths = [alias, repo, missing, untrusted]
      expect((yield* sandbox.status()).readableRoots).toContain(external)
      expect((yield* run(`cat '${alias}/readme'`)).stdout.toString()).toBe("external-reference")
      expect((yield* run(`cat '${repo}/readme'`)).stdout.toString()).toBe("cached-reference")
      const files = yield* sandbox.files
      expect((yield* files.read(path.join(repo, "readme"))).bytes.toString()).toBe("cached-reference")
      const search = yield* sandbox.search(process.env.OPENCODE_TEST_RIPGREP ?? Bun.which("rg")!)
      const found = Bun.spawnSync([search.command, ...search.args, "external", path.join(external, "readme")], {
        cwd: workspace,
        env: search.env,
      })
      expect({ exit: found.exitCode, stderr: found.stderr.toString(), stdout: found.stdout.toString() }).toMatchObject({
        exit: 0,
        stdout: expect.stringContaining("external-reference"),
      })
      expect((yield* run(`printf no > '${external}/new'`)).exitCode).not.toBe(0)
      expect((yield* run(`ln -s '${privateDir}' '${untrusted}'`)).exitCode).toBe(0)
      expect((yield* run(`cat '${untrusted}/secret'`)).exitCode).not.toBe(0)
      yield* Effect.promise(async () => {
        await fs.mkdir(missing)
        await fs.writeFile(path.join(missing, "readme"), "now-available")
      })
      expect((yield* run(`cat '${missing}/readme'`)).stdout.toString()).toBe("now-available")
      paths = [data]
      expect((yield* run(`cat '${repo}/readme'`)).stdout.toString()).toBe("cached-reference")
      expect((yield* run(`cat '${data}/auth.json'`)).exitCode).not.toBe(0)
      expect((yield* run(`cat '${data}/opencode.db'`)).exitCode).not.toBe(0)
      expect((yield* Effect.exit((yield* sandbox.files).read(path.join(data, "auth.json"))))._tag).toBe("Failure")
      paths = []
      expect((yield* run(`cat '${external}/readme'`)).exitCode).not.toBe(0)
      expect((yield* run(`cat '${repo}/readme'`)).exitCode).not.toBe(0)
      const revoked = yield* sandbox.search(process.env.OPENCODE_TEST_RIPGREP ?? Bun.which("rg")!)
      expect(
        Bun.spawnSync([revoked.command, ...revoked.args, "external", path.join(external, "readme")], {
          cwd: workspace,
          env: revoked.env,
        }).exitCode,
      ).not.toBe(0)
      paths = [alias]
      yield* Effect.promise(async () => {
        await fs.unlink(alias)
        await fs.symlink(data, alias, "dir")
      })
      expect((yield* Effect.exit(sandbox.command({ command: "/bin/true", args: [], env: {} })))._tag).toBe("Failure")
    }).pipe(
      Effect.provide(
        LayerNode.compile(Sandbox.configured({ enabled: true }), {
          replacements: [
            Reference.node.replace(referenceLayer),
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(workspace) })),
              ),
            ),
            Global.node.replace(
              Global.layerWith({
                home: tmp.path,
                config: path.join(tmp.path, "config"),
                data,
                state: path.join(tmp.path, "state"),
                tmp: path.join(tmp.path, "scratch"),
              }),
            ),
          ],
        }),
      ),
    )
  }),
)
