import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppProcess } from "@opencode/util/process"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { AgentFiles } from "../src/agent-files"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Environment } from "../src/environment/index"
import { FileAccess } from "../src/file-access"
import { FileMutation } from "../src/file-mutation"
import { Formatter } from "../src/formatter"
import { make } from "../src/formatter/builtins"
import { Location } from "../src/location"
import { Permission } from "../src/permission"
import { Ripgrep } from "../src/ripgrep"
import { RipgrepBinary } from "../src/ripgrep/binary"
import { which } from "../src/util/which"
import { Sandbox } from "../src/sandbox"
import { SandboxFiles } from "../src/sandbox/files"
import { SandboxFileWorker } from "../src/sandbox/file-worker"
import { MacSandbox } from "../src/sandbox/macos"
import { AbsolutePath } from "../src/schema"
import { Session } from "../src/session"
import { SessionInstructions } from "../src/session/instructions"
import { Tool } from "../src/tool"
import { EditTool } from "../src/tool/plugin/edit"
import { GlobTool } from "../src/tool/plugin/glob"
import { GrepTool } from "../src/tool/plugin/grep"
import { PatchTool } from "../src/tool/plugin/patch"
import { ReadTool } from "../src/tool/plugin/read"
import { WriteTool } from "../src/tool/plugin/write"
import { ReadToolFileSystem } from "../src/tool/read-filesystem"
import { FSUtil } from "@opencode/util/fs-util"
import { hostEnvironmentLayer } from "./fixture/environment"
import { location } from "./fixture/location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { it } from "./lib/effect"
import { withEnv } from "./fixture/env"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const toolsNode = makeLocationNode({
  name: "test/sandbox-file-tools",
  layer: Layer.effectDiscard(
    Effect.all([
      registerToolPlugin(ReadTool.Plugin),
      registerToolPlugin(WriteTool.Plugin),
      registerToolPlugin(EditTool.Plugin),
      registerToolPlugin(PatchTool.Plugin),
      registerToolPlugin(GlobTool.Plugin),
      registerToolPlugin(GrepTool.Plugin),
    ]),
  ),
  deps: [
    Tool.node,
    AgentFiles.node,
    FileAccess.node,
    FileMutation.node,
    Formatter.node,
    ReadToolFileSystem.node,
    Ripgrep.agentNode,
    Location.node,
    Permission.node,
    SessionInstructions.node,
    FSUtil.node,
  ],
})

const probe =
  process.platform === "darwin"
    ? Bun.spawnSync([MacSandbox.executable, "-p", "(version 1)(allow default)", "/usr/bin/true"])
    : undefined
const kernel = probe?.exitCode === 0 ? it.live : it.live.skip
const transport = process.platform === "win32" ? it.live.skip : it.live
const sessionID = Session.ID.make("ses_sandbox_file_tools")

function fixture(fullDiskRead = false) {
  return Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-sandbox-tools-")
    const host = Object.fromEntries(
      ["workspace", "scratch", "home", "config", "data", "state"].map((key) => [key, path.join(tmp.path, key)]),
    )
    const directory = host.workspace
    yield* Effect.promise(() => Promise.all(Object.values(host).map((value) => fs.mkdir(value))))
    const policy = yield* Effect.promise(() =>
      MacSandbox.policy(
        {
          ...host,
          directory,
          scratch: host.scratch,
          home: host.home,
          config: host.config,
          data: host.data,
          state: host.state,
        },
        { fullDiskRead },
      ),
    )
    const systemRipgrep = process.env.OPENCODE_TEST_RIPGREP ?? which(process.platform === "win32" ? "rg.exe" : "rg")
    if (!systemRipgrep) return yield* Effect.die("Native-tool integration tests require an installed ripgrep")
    const bin = path.join(host.data, "bin")
    yield* Effect.promise(async () => {
      await fs.mkdir(bin)
      await fs.copyFile(systemRipgrep, path.join(bin, "rg"))
      await fs.chmod(path.join(bin, "rg"), 0o500)
    })
    const assertions: Permission.AssertInput[] = []
    const instructions: string[] = []
    const helperRequests: string[] = []
    let denied: string | undefined
    const noHostFiles = Layer.effect(
      Environment.Service,
      Environment.Service.use((environment) =>
        Effect.succeed(
          Environment.Service.of({
            ...environment,
            files: {
              read: () => Effect.die("Native tools must not read host files"),
              stat: () => Effect.die("Native tools must not stat host files"),
              list: () => Effect.die("Native tools must not list host files"),
              write: () => Effect.die("Native tools must not write host files"),
              remove: () => Effect.die("Native tools must not remove host files"),
              move: () => Effect.die("Native tools must not move host files"),
              mkdir: () => Effect.die("Native tools must not mkdir host files"),
            },
          }),
        ),
      ),
    ).pipe(Layer.provide(hostEnvironmentLayer))
    const unconfined = (launch: Sandbox.Launch) => {
      const separator = launch.args.indexOf("--")
      return { ...launch, command: launch.args[separator + 1], args: launch.args.slice(separator + 2) }
    }
    // Explicit transport fixture: real embedded worker and real ripgrep, without Seatbelt.
    // Kernel cases below use the production Sandbox.configured service instead.
    const protocol = Layer.effect(
      Sandbox.Service,
      Effect.gen(function* () {
        const subprocess = yield* AppProcess.Service
        const launch = unconfined(
          MacSandbox.fileLaunch(
            policy,
            yield* Effect.promise(() => fs.realpath(process.execPath)),
            SandboxFileWorker.configured(policy),
          ),
        )
        const files = SandboxFiles.make({
          process: {
            run: (command, options) => {
              helperRequests.push(options?.stdin?.toString() ?? "")
              return subprocess.run(command, options)
            },
          },
          launch,
          directory,
          cwd: host.scratch,
        })
        return Sandbox.Service.of({
          status: () => {
            throw new Error("Sandbox status is not used by this fixture")
          },
          enabled: true,
          checkLocation: () => Effect.void,
          approval: "on-request",
          fullDiskRead,
          command: () => Effect.die("Unconfigured formatter must not execute commands"),
          files: Effect.succeed(files),
          search: (command) =>
            Effect.succeed(
              unconfined(MacSandbox.launch(policy, command, [], { PATH: process.env.PATH, HOME: host.scratch })),
            ),
          prepare: () => Effect.die("Shell is not used in file tool tests"),
        })
      }),
    )
    const protocolLayer = protocol.pipe(Layer.provide(LayerNode.compile(AppProcess.node)))
    const run = <A, E, R>(
      body: (tools: Tool.Interface) => Effect.Effect<A, E, R>,
      mode: "protocol" | "kernel" | "unavailable" = "protocol",
    ) =>
      Effect.gen(function* () {
        return yield* body(yield* Tool.Service)
      }).pipe(
        Effect.provide(
          AppNodeBuilder.build(
            LayerNode.group([Tool.node, toolsNode, Formatter.node, AgentFiles.node, AppProcess.node, Sandbox.node]),
            [
              Location.node.replace(
                Layer.succeed(
                  Location.Service,
                  Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
                ),
              ),
              Environment.node.replace(noHostFiles),
              RipgrepBinary.node.replace(
                Layer.succeed(
                  RipgrepBinary.Service,
                  RipgrepBinary.Service.of({
                    filepath: Effect.die("Confined searches must select standalone ripgrep"),
                    standalone: Effect.succeed(path.join(bin, "rg")),
                  }),
                ),
              ),
              Sandbox.node.replace(
                mode === "kernel"
                  ? Sandbox.configured({ enabled: true, fullDiskRead })
                  : mode === "protocol"
                    ? protocolLayer
                    : Layer.succeed(
                        Sandbox.Service,
                        Sandbox.Service.of({
                          status: () => {
                            throw new Error("Sandbox status is not used by this fixture")
                          },
                          enabled: true,
                          checkLocation: () => Effect.void,
                          approval: "on-request",
                          fullDiskRead,
                          command: () => Effect.fail(new Sandbox.UnavailableError({ message: "Command unavailable" })),
                          files: Effect.fail(new Sandbox.UnavailableError({ message: "Helper unavailable" })),
                          search: () => Effect.fail(new Sandbox.UnavailableError({ message: "Search unavailable" })),
                          prepare: () => Effect.die("unused"),
                        }),
                      ),
              ),
              Global.node.replace(
                Global.layerWith({ home: host.home, config: host.config, data: host.data, state: host.state, bin }),
              ),
              Permission.node.replace(
                permissionLayer({
                  assert: (input) =>
                    Effect.sync(() => assertions.push(input)).pipe(
                      Effect.andThen(
                        input.action === denied
                          ? Effect.fail(
                              new Permission.BlockedError({
                                rules: [],
                                permission: input.action,
                                resources: input.resources,
                              }),
                            )
                          : Effect.void,
                      ),
                    ),
                }),
              ),
              SessionInstructions.node.replace(
                Layer.succeed(
                  SessionInstructions.Service,
                  SessionInstructions.Service.of({
                    load: (input) =>
                      Effect.forEach(
                        input.paths,
                        (file) =>
                          input.read
                            ? input.read(file).pipe(
                                Effect.tap((text) =>
                                  Effect.sync(() => {
                                    if (text) instructions.push(text)
                                  }),
                                ),
                              )
                            : Effect.die("Agent instruction discovery must supply confined reads"),
                        { discard: true },
                      ),
                  }),
                ),
              ),
            ],
          ),
        ),
      )
    const call = (tools: Tool.Interface, name: string, input: unknown) =>
      executeTool(tools, { sessionID, ...toolIdentity, call: { type: "tool-call", id: `call-${name}`, name, input } })
    return {
      directory,
      host,
      assertions,
      instructions,
      helperRequests,
      run,
      call,
      deny: (action: string) => {
        denied = action
      },
    }
  })
}

for (const [label, test, mode] of [
  ["protocol routing", transport, "protocol"],
  ["Seatbelt enforcement", kernel, "kernel"],
] as const) {
  test(`${label}: all native tools share the agent file binding`, () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      yield* f.run(
        (tools) =>
          Effect.gen(function* () {
            expect((yield* f.call(tools, "write", { path: "a.txt", content: "before\n" })).status).toBe("completed")
            expect((yield* f.call(tools, "read", { path: "a.txt" })).content).toEqual([
              { type: "text", text: "Read file a.txt, lines 1-1\n1: before" },
            ])
            expect(
              (yield* f.call(tools, "edit", { path: "a.txt", oldString: "before", newString: "after" })).status,
            ).toBe("completed")
            expect(
              (yield* f.call(tools, "patch", {
                patchText:
                  "*** Begin Patch\n*** Update File: a.txt\n*** Move to: nested/b.txt\n@@\n-after\n+needle\n*** End Patch",
              })).status,
            ).toBe("completed")
            const grep = yield* f.call(tools, "grep", { pattern: "needle" })
            expect(grep.status).toBe("completed")
            expect(grep.output).toMatchObject([{ entry: { path: "nested/b.txt" }, text: "needle\n" }])
            expect((yield* f.call(tools, "glob", { pattern: "**/*.txt" })).output).toMatchObject([
              { path: "nested/b.txt" },
            ])
            expect((yield* f.call(tools, "read", { path: "nested" })).status).toBe("completed")
            expect(f.assertions.every((assertion) => assertion.prompt === "skip")).toBe(true)
          }),
        mode,
      )
      expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "nested/b.txt"), "utf8"))).toBe("needle\n")
    }))
}

transport(
  "patch preflight rejects external destinations, protected metadata and symlink aliases before any mutation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      yield* Effect.promise(() => fs.symlink(f.host.home, path.join(f.directory, "alias")))
      for (const target of [path.join(f.host.home, "outside.txt"), ".git/config", "alias/missing/new.txt"]) {
        yield* f.run((tools) =>
          Effect.gen(function* () {
            const result = yield* f.call(tools, "patch", {
              patchText: `*** Begin Patch\n*** Add File: first.txt\n+first\n*** Add File: ${target}\n+second\n*** End Patch`,
            })
            expect(result.status).toBe("error")
          }),
        )
        expect(
          yield* Effect.promise(() =>
            fs.lstat(path.join(f.directory, "first.txt")).then(
              () => true,
              () => false,
            ),
          ),
        ).toBe(false)
      }
      expect(f.helperRequests.some((frame) => JSON.parse(frame).op === "write")).toBe(false)
    }),
)

transport("explicit read/edit/search denies survive unprompted sandbox execution", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* Effect.promise(() => fs.writeFile(path.join(f.directory, "a.txt"), "before\n"))
    for (const [action, name, input] of [
      ["read", "read", { path: "a.txt" }],
      ["edit", "write", { path: "a.txt", content: "bad" }],
      ["edit", "edit", { path: "a.txt", oldString: "before", newString: "bad" }],
      ["edit", "patch", { patchText: "*** Begin Patch\n*** Delete File: a.txt\n*** End Patch" }],
      ["glob", "glob", { pattern: "**/*" }],
      ["grep", "grep", { pattern: "before" }],
    ] as const) {
      f.deny(action)
      yield* f.run((tools) =>
        f.call(tools, name, input).pipe(Effect.tap((result) => Effect.sync(() => expect(result.status).toBe("error")))),
      )
    }
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "a.txt"), "utf8"))).toBe("before\n")
  }),
)

transport("helper unavailability never falls back to host access for native tools", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* f.run(
      (tools) =>
        Effect.gen(function* () {
          for (const [name, input] of [
            ["read", { path: "a" }],
            ["write", { path: "a", content: "x" }],
            ["edit", { path: "a", oldString: "a", newString: "b" }],
            ["patch", { patchText: "*** Begin Patch\n*** Add File: a\n+x\n*** End Patch" }],
            ["glob", { pattern: "*" }],
            ["grep", { pattern: "x" }],
          ] as const)
            expect((yield* f.call(tools, name, input)).status).toBe("error")
        }),
      "unavailable",
    )
  }),
)

transport("filename recovery, missing-file suggestions, media and discovered instructions use helper bytes", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    )
    yield* Effect.promise(async () => {
      await fs.mkdir(path.join(f.directory, "nested"))
      await fs.writeFile(path.join(f.directory, "nested", "AGENTS.md"), "confined instructions")
      await fs.writeFile(path.join(f.directory, "nested", "text.txt"), "read me\n")
      await fs.writeFile(path.join(f.directory, "image\u202fname.png"), png)
      await fs.writeFile(path.join(f.directory, "paper.pdf"), "%PDF-1.4\nconfined PDF bytes")
    })
    yield* f.run((tools) =>
      Effect.gen(function* () {
        const recovered = yield* f.call(tools, "read", { path: "image name.png" })
        expect(recovered.status).toBe("completed")
        expect(recovered.output).toMatchObject({
          encoding: "base64",
          content: png.toString("base64"),
          mime: "image/png",
        })
        const pdf = yield* f.call(tools, "read", { path: "paper.pdf" })
        expect(pdf.output).toMatchObject({ encoding: "base64", mime: "application/pdf" })
        expect((yield* f.call(tools, "read", { path: "nested/text.txt" })).status).toBe("completed")
        expect(f.instructions).toEqual(["confined instructions"])
        const missing = yield* f.call(tools, "read", { path: "paper" })
        expect(missing.error?.message).toContain("paper.pdf")
        expect(f.helperRequests.filter((frame) => JSON.parse(frame).op === "list").length).toBeGreaterThan(0)
      }),
    )
  }),
)

transport("a patch cannot move protected source metadata into a writable destination", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    yield* Effect.promise(async () => {
      await fs.mkdir(path.join(f.directory, ".git"))
      await fs.writeFile(path.join(f.directory, ".git/config"), "original\n")
    })
    yield* f.run((tools) =>
      Effect.gen(function* () {
        expect(
          (yield* f.call(tools, "patch", {
            patchText:
              "*** Begin Patch\n*** Update File: .git/config\n*** Move to: moved.txt\n@@\n-original\n+changed\n*** End Patch",
          })).status,
        ).toBe("error")
      }),
    )
    expect(
      yield* Effect.promise(() =>
        fs.lstat(path.join(f.directory, "moved.txt")).then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false)
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, ".git/config"), "utf8"))).toBe("original\n")
  }),
)

for (const fullDiskRead of [false, true]) {
  kernel(`native tools enforce aliases, credentials and protected writes with fullDiskRead=${fullDiskRead}`, () =>
    Effect.gen(function* () {
      const f = yield* fixture(fullDiskRead)
      yield* Effect.promise(async () => {
        await fs.writeFile(path.join(f.host.home, "external.txt"), "outside-needle\n")
        await fs.mkdir(path.join(f.directory, ".ssh"))
        await fs.writeFile(path.join(f.directory, ".ssh", "key"), "credential-needle\n")
        await fs.symlink(f.host.home, path.join(f.directory, "alias"))
      })
      yield* f.run(
        (tools) =>
          Effect.gen(function* () {
            expect((yield* f.call(tools, "read", { path: "alias/external.txt" })).status).toBe(
              fullDiskRead ? "completed" : "error",
            )
            expect(
              (yield* f.call(tools, "grep", { path: "alias/external.txt", pattern: "outside-needle" })).status,
            ).toBe(fullDiskRead ? "completed" : "error")
            expect((yield* f.call(tools, "read", { path: ".ssh/key" })).status).toBe("error")
            expect((yield* f.call(tools, "grep", { pattern: "credential-needle" })).output ?? []).toEqual([])
            for (const target of ["alias/new.txt", ".git/config", ".opencode/plugin.js", "opencode.json"]) {
              expect((yield* f.call(tools, "write", { path: target, content: "bad" })).status).toBe("error")
              expect(
                (yield* f.call(tools, "patch", {
                  patchText: `*** Begin Patch\n*** Add File: ${target}\n+bad\n*** End Patch`,
                })).status,
              ).toBe("error")
            }
          }),
        "kernel",
      )
    }),
  )
}

kernel("automatic write/edit/patch formatters and their descendants keep the shell sandbox boundary", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const requests: string[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            requests.push(request.url)
            return new Response("reachable")
          },
        }),
      ),
      (server) => Effect.sync(() => server.stop(true)),
    )
    yield* Effect.promise(async () => {
      await fs.writeFile(path.join(f.host.home, "secret"), "outside")
      await fs.mkdir(path.join(f.directory, ".git"))
      await fs.writeFile(path.join(f.directory, ".git/config"), "protected")
      await fs.writeFile(
        path.join(f.directory, "formatter.sh"),
        `set -eu
test -z "\${API_KEY:-}"
test -z "\${OPENCODE_TEST_SECRET:-}"
test -z "\${BASH_ENV:-}"
test "$NORMAL" = kept
if [ "\${1##*.}" = blocked ]; then echo bad > "$OUTSIDE/new"; fi
if /bin/cat "$OUTSIDE/secret" >/dev/null 2>&1; then exit 41; fi
if /bin/sh -c 'echo bad > "$OUTSIDE/new"' 2>/dev/null; then exit 42; fi
if /bin/sh -c 'echo bad > .git/config' 2>/dev/null; then exit 43; fi
if /usr/bin/curl --silent --max-time 2 "$URL" >/dev/null 2>&1; then exit 44; fi
/usr/bin/tr '[:lower:]' '[:upper:]' < "$1" > "$1.tmp"
/bin/mv "$1.tmp" "$1"
echo formatted >> formats.log
`,
      )
    })
    yield* f.run(
      (tools) =>
        Effect.gen(function* () {
          const formatter = yield* Formatter.Service
          yield* formatter.transform((editor) =>
            editor.set({
              name: "confined",
              extensions: [".txt", ".blocked"],
              enabled: Effect.succeed(["/bin/sh", "formatter.sh", "$FILE"]),
              environment: {
                OUTSIDE: f.host.home,
                URL: `http://127.0.0.1:${server.port}`,
                NORMAL: "kept",
                API_KEY: "must-be-removed",
                OPENCODE_TEST_SECRET: "must-be-removed",
                BASH_ENV: "must-be-removed",
              },
            }),
          )
          expect((yield* f.call(tools, "write", { path: "a.txt", content: "\uFEFFbefore\n" })).status).toBe("completed")
          expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "a.txt"), "utf8"))).toBe(
            "\uFEFFBEFORE\n",
          )
          expect(
            (yield* f.call(tools, "edit", { path: "a.txt", oldString: "BEFORE", newString: "after" })).status,
          ).toBe("completed")
          expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "a.txt"), "utf8"))).toBe(
            "\uFEFFAFTER\n",
          )
          const patched = yield* f.call(tools, "patch", {
            patchText: "*** Begin Patch\n*** Update File: a.txt\n@@\n-AFTER\n+patched\n*** End Patch",
          })
          expect(patched.status).toBe("completed")
          expect(patched.output).toMatchObject({ files: [{ patch: expect.stringContaining("+PATCHED") }] })
          expect(
            (yield* f.call(tools, "write", { path: "a.blocked", content: "edit survives formatter failure" })).status,
          ).toBe("completed")
        }),
      "kernel",
    )
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "a.txt"), "utf8"))).toBe("\uFEFFPATCHED\n")
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "a.blocked"), "utf8"))).toBe(
      "edit survives formatter failure",
    )
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "formats.log"), "utf8"))).toBe(
      "formatted\n".repeat(3),
    )
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, ".git/config"), "utf8"))).toBe("protected")
    expect(yield* Effect.promise(() => Bun.file(path.join(f.host.home, "new")).exists())).toBe(false)
    expect(requests).toEqual([])
  }),
)

kernel("built-in formatter discovery confines probes and config reads and uses installed workspace packages", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const bin = path.join(f.directory, "bin")
    yield* Effect.promise(async () => {
      await fs.mkdir(bin)
      await fs.mkdir(path.join(f.directory, "node_modules/.bin"), { recursive: true })
      await fs.writeFile(path.join(f.directory, "package.json"), JSON.stringify({ devDependencies: { prettier: "*" } }))
      await fs.writeFile(path.join(f.directory, "node_modules/.bin/prettier"), '#!/bin/sh\necho prettier >> "$2"\n', {
        mode: 0o755,
      })
      await fs.writeFile(
        path.join(bin, "uv"),
        `#!/bin/sh
if /bin/sh -c 'echo bad > "$OUTSIDE/probe"' 2>/dev/null; then exit 41; fi
echo "$*" >> "$PROBES"
if [ "$2" = --help ]; then exit 0; fi
echo uv >> "$3"
`,
        { mode: 0o755 },
      )
      await fs.writeFile(path.join(f.directory, "a.py"), "")
      await fs.writeFile(path.join(f.directory, "a.js"), "")
      await fs.writeFile(path.join(f.host.home, "package.json"), JSON.stringify({ devDependencies: { prettier: "*" } }))
    })
    yield* withEnv({ PATH: bin, OUTSIDE: f.host.home, PROBES: path.join(f.directory, "probes.log") }, () =>
      f.run(
        () =>
          Effect.gen(function* () {
            const formatter = yield* Formatter.Service
            const environment = yield* AgentFiles.Service
            const input = {
              directory: f.directory,
              worktree: f.directory,
              bin,
              processes: yield* AppProcess.Service,
              sandbox: yield* Sandbox.Service,
              files: environment.files,
              fs: {
                findUp: () => Effect.die("Sandbox discovery must not scan with host FSUtil"),
                readJson: () => Effect.die("Sandbox discovery must not read host JSON"),
                readFileString: () => Effect.die("Sandbox discovery must not read host strings"),
              },
              npm: { which: () => Effect.die("Sandbox discovery must not install formatter packages") },
            }
            yield* formatter.transform((editor) => make(input).forEach(editor.set))
            expect(yield* formatter.file(path.join(f.directory, "a.py"))).toBe(true)
            expect(yield* formatter.file(path.join(f.directory, "a.js"))).toBe(true)
            yield* Effect.promise(async () => {
              await fs.unlink(path.join(f.directory, "package.json"))
              await fs.symlink(path.join(f.host.home, "package.json"), path.join(f.directory, "package.json"))
            })
            yield* formatter.reload()
            expect(yield* formatter.file(path.join(f.directory, "a.js"))).toBe(false)
          }),
        "kernel",
      ),
    )
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "a.py"), "utf8"))).toBe("uv\n")
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "a.js"), "utf8"))).toBe("prettier\n")
    expect(yield* Effect.promise(() => fs.readFile(path.join(f.directory, "probes.log"), "utf8"))).toContain(
      "format --help\n",
    )
    expect(yield* Effect.promise(() => Bun.file(path.join(f.host.home, "probe")).exists())).toBe(false)
  }),
)

transport("formatter sandbox unavailability never retries on the host", () =>
  Effect.gen(function* () {
    const f = yield* fixture()
    const target = path.join(f.directory, "a.txt")
    yield* Effect.promise(() => fs.writeFile(target, "before"))
    yield* f.run(
      () =>
        Effect.gen(function* () {
          const formatter = yield* Formatter.Service
          yield* formatter.transform((editor) =>
            editor.set({
              name: "no-fallback",
              extensions: [".txt"],
              enabled: Effect.succeed(["/bin/sh", "-c", 'echo escaped > "$1"', "formatter", "$FILE"]),
            }),
          )
          expect(yield* formatter.file(target)).toBe(false)
        }),
      "unavailable",
    )
    expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("before")
  }),
)
