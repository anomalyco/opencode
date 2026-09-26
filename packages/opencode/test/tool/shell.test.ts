import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Effect, Exit, Layer } from "effect"
import type * as Scope from "effect/Scope"
import os from "os"
import { symlink } from "node:fs/promises"
import path from "path"
import { Config } from "@/config/config"
import { Shell } from "@opencode-ai/core/shell"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { ShellTool } from "../../src/tool/shell"
import { Filesystem } from "@/util/filesystem"
import { provideInstance, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Plugin } from "../../src/plugin"
import { testEffect } from "../lib/effect"
import { Tool } from "@/tool/tool"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceStore } from "@/project/instance-store"

const shellLayer = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([
      CrossSpawnSpawner.node,
      FSUtil.node,
      Plugin.node,
      Truncate.node,
      Config.node,
      Agent.node,
      RuntimeFlags.node,
    ]),
  ),
  testInstanceStoreLayer,
)
const it = testEffect(shellLayer)
type ShellTestServices =
  | (typeof shellLayer extends Layer.Layer<infer ROut, infer _E, infer _RIn> ? ROut : never)
  | InstanceStore.Service
  | Scope.Scope

const initShell = Effect.fn("ShellToolTest.init")(function* () {
  const info = yield* ShellTool
  return yield* info.init()
})

const initBash = initShell

const run = Effect.fn("ShellToolTest.run")(function* (
  args: Tool.InferParameters<typeof ShellTool>,
  next: Tool.Context = ctx,
) {
  const bash = yield* initShell()
  return yield* bash.execute(args, next)
})

const runIn = <A, E, R>(directory: string, self: Effect.Effect<A, E, R>) => self.pipe(provideInstance(directory))

const fail = Effect.fn("ShellToolTest.fail")(function* (
  args: Tool.InferParameters<typeof ShellTool>,
  next: Tool.Context = ctx,
) {
  const exit = yield* run(args, next).pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected command to fail")
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

Shell.acceptable.reset()
const quote = (text: string) => `"${text}"`
const squote = (text: string) => `'${text}'`
const projectRoot = path.join(__dirname, "../..")
const bin = quote(process.execPath.replaceAll("\\", "/"))
const bash = (() => {
  const shell = Shell.acceptable()
  if (Shell.name(shell) === "bash") return shell
  return Shell.gitbash()
})()
const shells = (() => {
  if (process.platform !== "win32") {
    const shell = Shell.acceptable()
    return [{ label: Shell.name(shell), shell }]
  }

  const list = [bash, Bun.which("pwsh"), Bun.which("powershell"), process.env.COMSPEC || Bun.which("cmd.exe")]
    .filter((shell): shell is string => Boolean(shell))
    .map((shell) => ({ label: Shell.name(shell), shell }))

  return list.filter(
    (item, i) => list.findIndex((other) => other.shell.toLowerCase() === item.shell.toLowerCase()) === i,
  )
})()
const PS = new Set(["pwsh", "powershell"])
const ps = shells.filter((item) => PS.has(item.label))
const cmdShell = shells.find((item) => item.label === "cmd")

const sh = () => Shell.name(Shell.acceptable())
const evalarg = (text: string) => (sh() === "cmd" ? quote(text) : squote(text))

const fill = (mode: "lines" | "bytes", n: number) => {
  const code =
    mode === "lines"
      ? "console.log(Array.from({length:Number(Bun.argv[1])},(_,i)=>i+1).join(String.fromCharCode(10)))"
      : "process.stdout.write(String.fromCharCode(97).repeat(Number(Bun.argv[1])))"
  const text = `${bin} -e ${evalarg(code)} ${n}`
  if (PS.has(sh())) return `& ${text}`
  return text
}
const glob = (p: string) =>
  process.platform === "win32" ? Filesystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

const forms = (dir: string) => {
  if (process.platform !== "win32") return [dir]
  const full = Filesystem.normalizePath(dir)
  const slash = full.replaceAll("\\", "/")
  const root = slash.replace(/^[A-Za-z]:/, "")
  return Array.from(new Set([full, slash, root, root.toLowerCase()]))
}

const withShell = <A, E, R>(item: { label: string; shell: string }, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.SHELL
      process.env.SHELL = item.shell
      Shell.acceptable.reset()
      Shell.preferred.reset()
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.SHELL
        else process.env.SHELL = prev
        Shell.acceptable.reset()
        Shell.preferred.reset()
      }),
  )

const each = (
  name: string,
  fn: (item: { label: string; shell: string }) => Effect.Effect<void, unknown, ShellTestServices>,
) => {
  for (const item of shells) {
    it.live(`${name} [${item.label}]`, () => withShell(item, fn(item)))
  }
}

const capture = (requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">>, stop?: Error) => ({
  ...ctx,
  ask: (req: Omit<PermissionV1.Request, "id" | "sessionID" | "tool">) =>
    Effect.sync(() => {
      requests.push(req)
      if (stop) throw stop
    }),
})

const mustTruncate = (result: {
  metadata: { truncated?: boolean; exit?: number | null } & Record<string, unknown>
  output: string
}) => {
  if (result.metadata.truncated) return
  throw new Error(
    [`shell: ${process.env.SHELL || ""}`, `exit: ${String(result.metadata.exit)}`, "output:", result.output].join("\n"),
  )
}

describe("tool.shell", () => {
  each("basic", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const result = yield* run({
          command: "echo test",
        })
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      }),
    ),
  )

  it.live("falls back from terminal-only configured shell", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ config: { shell: "fish" } })
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const bash = yield* initBash()
          const fallback = Shell.name(Shell.acceptable("fish"))
          expect(fallback).not.toBe("fish")
          expect(bash.description).toContain(fallback)

          const result = yield* bash.execute(
            {
              command: "echo fallback",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("fallback")
        }),
      )
    }),
  )
})

describe("tool.shell permissions", () => {
  each("asks for bash permission with correct pattern", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "echo hello",
            },
            capture(requests),
          )
          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("bash")
          expect(requests[0].patterns).toContain("echo hello")
        }),
      )
    }),
  )

  each("asks for bash permission with multiple commands", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "echo foo && echo bar",
            },
            capture(requests),
          )
          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("bash")
          expect(requests[0].patterns).toContain("echo foo")
          expect(requests[0].patterns).toContain("echo bar")
        }),
      )
    }),
  )

  for (const item of ps) {
    it.live(`parses PowerShell conditionals for permission prompts [${item.label}]`, () =>
      withShell(
        item,
        runIn(
          projectRoot,
          Effect.gen(function* () {
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run(
              {
                command: "Write-Host foo; if ($?) { Write-Host bar }",
              },
              capture(requests),
            )
            const bashReq = requests.find((r) => r.permission === "bash")
            expect(bashReq).toBeDefined()
            expect(bashReq!.patterns).toContain("Write-Host foo")
            expect(bashReq!.patterns).toContain("Write-Host bar")
            expect(bashReq!.always).toContain("Write-Host *")
          }),
        ),
      ),
    )
  }

  for (const item of ps) {
    it.live(`uses PowerShell cmdlet prefixes for always-allow prompts [${item.label}]`, () =>
      withShell(
        item,
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          yield* runIn(
            tmp,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: "Remove-Item -Recurse tmp",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(bashReq).toBeDefined()
              expect(bashReq!.always).toContain("Remove-Item *")
              expect(bashReq!.always).not.toContain("Remove-Item -Recurse *")
            }),
          )
        }),
      ),
    )
  }

  each("asks for external_directory permission for wildcard external paths", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const err = new Error("stop after permission")
        const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
        const file = process.platform === "win32" ? `${process.env.WINDIR!.replaceAll("\\", "/")}/*` : "/etc/*"
        const want = process.platform === "win32" ? glob(path.join(process.env.WINDIR!, "*")) : "/etc/*"
        expect(
          yield* fail(
            {
              command: `cat ${file}`,
            },
            capture(requests, err),
          ),
        ).toMatchObject({ message: err.message })
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(want)
      }),
    ),
  )

  each("offers no always grant for glob-bearing arguments", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          yield* run({ command: "cat *" }, capture(requests))
          const bashReq = requests.find((r) => r.permission === "bash")
          expect(bashReq).toBeDefined()
          expect(bashReq!.patterns).toContain("cat *")
          expect(bashReq!.always).not.toContain("cat *")
        }),
      )
    }),
  )

  each("offers an always grant for literal arguments", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          yield* run({ command: "cat file.txt" }, capture(requests))
          const bashReq = requests.find((r) => r.permission === "bash")
          expect(bashReq).toBeDefined()
          expect(bashReq!.always).toContain("cat *")
        }),
      )
    }),
  )

  each("scans external directories for a leading-glob traversal argument", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          expect(
            yield* fail({ command: "cat */../../../../../../../../etc/passwd" }, capture(requests, err)),
          ).toMatchObject({ message: err.message })
          expect(requests.find((r) => r.permission === "external_directory")).toBeDefined()
        }),
      )
    }),
  )

  if (process.platform !== "win32") {
    each("scans externally and offers no always grant for a tilde-user expansion", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run({ command: "cat ~root/opencode-missing-file" }, capture(requests))
            expect(requests.find((r) => r.permission === "external_directory")).toBeDefined()
            const bashReq = requests.find((r) => r.permission === "bash")
            expect(bashReq).toBeDefined()
            expect(bashReq!.always).not.toContain("cat *")
          }),
        )
      }),
    )

    each("scans externally and offers no always grant for a ~+ expansion", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run({ command: "cat ~+/../../../../../etc/opencode-missing" }, capture(requests))
            expect(requests.find((r) => r.permission === "external_directory")).toBeDefined()
            const bashReq = requests.find((r) => r.permission === "bash")
            expect(bashReq).toBeDefined()
            expect(bashReq!.always).not.toContain("cat *")
          }),
        )
      }),
    )

    each("asks for external_directory when a symlink plus .. escapes the project", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => symlink("/", path.join(tmp, "link"), "dir"))
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const err = new Error("stop after permission")
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            expect(yield* fail({ command: "cat link/../etc/opencode-missing" }, capture(requests, err))).toMatchObject({
              message: err.message,
            })
            expect(requests.find((r) => r.permission === "external_directory")).toBeDefined()
          }),
        )
      }),
    )

    each("asks for external_directory when a ~+ expansion traverses a symlink with ..", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => symlink("/", path.join(tmp, "linkroot"), "dir"))
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run({ command: "cat ~+/linkroot/../etc/opencode-missing" }, capture(requests))
            const ext = requests.find((r) => r.permission === "external_directory")
            expect(ext).toBeDefined()
            expect(ext!.patterns).toContain("/etc/*")
            const bashReq = requests.find((r) => r.permission === "bash")
            expect(bashReq).toBeDefined()
            expect(bashReq!.always).not.toContain("cat *")
          }),
        )
      }),
    )

    each("asks for external_directory when a leading glob traverses a symlink with ..", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => symlink("/", path.join(tmp, "linkroot"), "dir"))
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run({ command: "cat */../linkroot/../etc/opencode-missing" }, capture(requests))
            expect(requests.find((r) => r.permission === "external_directory")).toBeDefined()
          }),
        )
      }),
    )

    each("asks for external_directory when a backslash-escaped traversal escapes the project", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run({ command: "cat \\../etc/opencode-missing" }, capture(requests))
            expect(requests.find((r) => r.permission === "external_directory")).toBeDefined()

            const requests2: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run({ command: "cat \\.\\./etc/opencode-missing" }, capture(requests2))
            expect(requests2.find((r) => r.permission === "external_directory")).toBeDefined()
          }),
        )
      }),
    )

    each("asks for external_directory when cd has an unresolvable target", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            for (const command of ["cd $HOME && cat secret.txt", "cd - && cat secret.txt", "cd && cat secret.txt"]) {
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              yield* run({ command }, capture(requests))
              const ext = requests.find((r) => r.permission === "external_directory")
              expect({ command, ext: ext !== undefined }).toEqual({ command, ext: true })
              const bashReq = requests.find((r) => r.permission === "bash")
              expect({ command, always: bashReq?.always ?? [] }).toEqual({ command, always: [] })
            }
          }),
        )
      }),
    )

    each("resolves a dirstack tilde to the worktree instead of prompting root", () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run({ command: "cat ~0/notes.txt" }, capture(requests))
            expect(requests.find((r) => r.permission === "external_directory")).toBeUndefined()
          }),
        )
      }),
    )
  }

  if (process.platform === "win32") {
    if (bash) {
      it.live("asks for nested bash command permissions [bash]", () =>
        withShell(
          { label: "bash", shell: bash },
          Effect.gen(function* () {
            const outerTmp = yield* tmpdirScoped()
            yield* Effect.promise(() => Bun.write(path.join(outerTmp, "outside.txt"), "x"))
            yield* runIn(
              projectRoot,
              Effect.gen(function* () {
                const file = path.join(outerTmp, "outside.txt").replaceAll("\\", "/")
                const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
                yield* run(
                  {
                    command: `echo $(cat "${file}")`,
                  },
                  capture(requests),
                )
                const extDirReq = requests.find((r) => r.permission === "external_directory")
                const bashReq = requests.find((r) => r.permission === "bash")
                expect(extDirReq).toBeDefined()
                expect(extDirReq!.patterns).toContain(glob(path.join(outerTmp, "*")))
                expect(bashReq).toBeDefined()
                expect(bashReq!.patterns).toContain(`cat "${file}"`)
              }),
            )
          }),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for PowerShell paths after switches [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: `Copy-Item -PassThru "${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini" ./out`,
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for nested PowerShell command permissions [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              const file = `${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini`
              yield* run(
                {
                  command: `Write-Output $(Get-Content ${file})`,
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).toContain(`Get-Content ${file}`)
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for drive-relative PowerShell paths [${item.label}]`, () =>
        withShell(
          item,
          Effect.gen(function* () {
            const tmp = yield* tmpdirScoped()
            yield* runIn(
              tmp,
              Effect.gen(function* () {
                const err = new Error("stop after permission")
                const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
                expect(
                  yield* fail(
                    {
                      command: 'Get-Content "C:../outside.txt"',
                    },
                    capture(requests, err),
                  ),
                ).toMatchObject({ message: err.message })
                expect(requests[0]?.permission).toBe("external_directory")
                if (requests[0]?.permission !== "external_directory") return
                expect(requests[0].patterns).toContain(glob(path.join(path.dirname(tmp), "*")))
              }),
            )
          }),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for $HOME PowerShell paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: 'Get-Content "$HOME/.ssh/config"',
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(os.homedir(), ".ssh", "*")))
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for $PWD PowerShell paths [${item.label}]`, () =>
        withShell(
          item,
          Effect.gen(function* () {
            const tmp = yield* tmpdirScoped()
            yield* runIn(
              tmp,
              Effect.gen(function* () {
                const err = new Error("stop after permission")
                const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
                expect(
                  yield* fail(
                    {
                      command: 'Get-Content "$PWD/../outside.txt"',
                    },
                    capture(requests, err),
                  ),
                ).toMatchObject({ message: err.message })
                expect(requests[0]?.permission).toBe("external_directory")
                if (requests[0]?.permission !== "external_directory") return
                expect(requests[0].patterns).toContain(glob(path.join(path.dirname(tmp), "*")))
              }),
            )
          }),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for $PSHOME PowerShell paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: 'Get-Content "$PSHOME/outside.txt"',
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(path.dirname(item.shell), "*")))
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for missing PowerShell env paths [${item.label}]`, () =>
        withShell(
          item,
          Effect.acquireUseRelease(
            Effect.sync(() => {
              const key = "OPENCODE_TEST_MISSING"
              const prev = process.env[key]
              delete process.env[key]
              return { key, prev }
            }),
            ({ key }) =>
              runIn(
                projectRoot,
                Effect.gen(function* () {
                  const err = new Error("stop after permission")
                  const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
                  const root = path.parse(process.env.WINDIR!).root.replace(/[\\/]+$/, "")
                  expect(
                    yield* fail(
                      {
                        command: `Get-Content -Path "${root}$env:${key}\\Windows\\win.ini"`,
                      },
                      capture(requests, err),
                    ),
                  ).toMatchObject({ message: err.message })
                  const extDirReq = requests.find((r) => r.permission === "external_directory")
                  expect(extDirReq).toBeDefined()
                  expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
                }),
              ),
            ({ key, prev }) =>
              Effect.sync(() => {
                if (prev === undefined) delete process.env[key]
                else process.env[key] = prev
              }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for PowerShell env paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              yield* run(
                {
                  command: "Get-Content $env:WINDIR/win.ini",
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for PowerShell FileSystem paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: `Get-Content -Path FileSystem::${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini`,
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for braced PowerShell env paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: "Get-Content ${env:WINDIR}/win.ini",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`treats Set-Location like cd for permissions [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              yield* run(
                {
                  command: "Set-Location C:/Windows",
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
              expect(bashReq).toBeUndefined()
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`does not add nested PowerShell expressions to permission prompts [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              yield* run(
                {
                  command: "Write-Output ('a' * 3)",
                },
                capture(requests),
              )
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).not.toContain("a * 3")
              expect(bashReq!.always).not.toContain("a *")
            }),
          ),
        ),
      )
    }
  }

  if (process.platform === "win32" && cmdShell) {
    it.live("asks for external_directory permission for cmd file commands [cmd]", () =>
      withShell(
        cmdShell,
        runIn(
          projectRoot,
          Effect.gen(function* () {
            const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
            yield* run(
              {
                command: `TYPE "${path.join(process.env.WINDIR!, "win.ini")}"`,
              },
              capture(requests),
            )
            const extDirReq = requests.find((r) => r.permission === "external_directory")
            expect(extDirReq).toBeDefined()
            expect(extDirReq!.patterns).toContain(Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")))
          }),
        ),
      ),
    )
  }

  each("asks for external_directory permission when cd to parent", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          expect(
            yield* fail(
              {
                command: "cd ../",
              },
              capture(requests, err),
            ),
          ).toMatchObject({ message: err.message })
          const extDirReq = requests.find((r) => r.permission === "external_directory")
          expect(extDirReq).toBeDefined()
        }),
      )
    }),
  )

  each("asks for external_directory permission when workdir is outside project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          expect(
            yield* fail(
              {
                command: "echo ok",
                workdir: os.tmpdir(),
              },
              capture(requests, err),
            ),
          ).toMatchObject({ message: err.message })
          const extDirReq = requests.find((r) => r.permission === "external_directory")
          expect(extDirReq).toBeDefined()
          expect(extDirReq!.patterns).toContain(glob(path.join(os.tmpdir(), "*")))
        }),
      )
    }),
  )

  each("asks for external_directory permission when workdir is a symlink escaping the project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(() => symlink(outside, path.join(tmp, "link"), "dir"))
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          expect(
            yield* fail(
              {
                command: "echo ok",
                workdir: path.join(tmp, "link"),
              },
              capture(requests, err),
            ),
          ).toMatchObject({ message: err.message })
          expect(requests.find((r) => r.permission === "external_directory")).toBeDefined()
        }),
      )
    }),
  )

  each("asks for external_directory permission when a file arg is under a symlink escaping the project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const outside = yield* tmpdirScoped()
      yield* Effect.promise(() => symlink(outside, path.join(tmp, "link"), "dir"))
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          expect(yield* fail({ command: "rm link/f" }, capture(requests, err))).toMatchObject({
            message: err.message,
          })
          expect(requests.find((r) => r.permission === "external_directory")).toBeDefined()
        }),
      )
    }),
  )

  if (process.platform === "win32") {
    it.live("normalizes external_directory workdir variants on Windows", () =>
      Effect.gen(function* () {
        const err = new Error("stop after permission")
        const outerTmp = yield* tmpdirScoped()
        const tmp = yield* tmpdirScoped()
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const want = Filesystem.normalizePathPattern(path.join(outerTmp, "*"))

            for (const dir of forms(outerTmp)) {
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: "echo ok",
                    workdir: dir,
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })

              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect({ dir, patterns: extDirReq?.patterns, always: extDirReq?.always }).toEqual({
                dir,
                patterns: [want],
                always: [want],
              })
            }
          }),
        )
      }),
    )

    if (bash) {
      it.live("uses Git Bash /tmp semantics for external workdir", () =>
        withShell(
          { label: "bash", shell: bash },
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              const want = glob(path.join(os.tmpdir(), "*"))
              expect(
                yield* fail(
                  {
                    command: "echo ok",
                    workdir: "/tmp",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]).toMatchObject({
                permission: "external_directory",
                patterns: [want],
                always: [want],
              })
            }),
          ),
        ),
      )

      it.live("uses Git Bash /tmp semantics for external file paths", () =>
        withShell(
          { label: "bash", shell: bash },
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
              const want = glob(path.join(os.tmpdir(), "*"))
              expect(
                yield* fail(
                  {
                    command: "cat /tmp/opencode-does-not-exist",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]).toMatchObject({
                permission: "external_directory",
                patterns: [want],
                always: [want],
              })
            }),
          ),
        ),
      )
    }
  }

  each("asks for external_directory permission when file arg is outside project", () =>
    Effect.gen(function* () {
      const outerTmp = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(outerTmp, "outside.txt"), "x"))
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          const filepath = path.join(outerTmp, "outside.txt")
          expect(
            yield* fail(
              {
                command: `cat ${filepath}`,
              },
              capture(requests, err),
            ),
          ).toMatchObject({ message: err.message })
          const extDirReq = requests.find((r) => r.permission === "external_directory")
          const expected = glob(path.join(outerTmp, "*"))
          expect(extDirReq).toBeDefined()
          expect(extDirReq!.patterns).toContain(expected)
          expect(extDirReq!.always).toContain(expected)
          expect(extDirReq!.metadata).toMatchObject({
            command: `cat ${filepath}`,
            directories: [outerTmp],
            patterns: [expected],
          })
        }),
      )
    }),
  )

  each("does not ask for external_directory permission when rm inside project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(tmp, "tmpfile"), "x"))
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: `rm -rf ${path.join(tmp, "nested")}`,
            },
            capture(requests),
          )
          const extDirReq = requests.find((r) => r.permission === "external_directory")
          expect(extDirReq).toBeUndefined()
        }),
      )
    }),
  )

  each("includes always patterns for auto-approval", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "git log --oneline -5",
            },
            capture(requests),
          )
          expect(requests.length).toBe(1)
          expect(requests[0].always.length).toBeGreaterThan(0)
          expect(requests[0].always.some((item) => item.endsWith("*"))).toBe(true)
        }),
      )
    }),
  )

  each("does not ask for bash permission when command is cd only", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "cd .",
            },
            capture(requests),
          )
          const bashReq = requests.find((r) => r.permission === "bash")
          expect(bashReq).toBeUndefined()
        }),
      )
    }),
  )

  each("matches redirects in permission pattern", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          expect(yield* fail({ command: "echo test > output.txt" }, capture(requests, err))).toMatchObject({
            message: err.message,
          })
          const bashReq = requests.find((r) => r.permission === "bash")
          expect(bashReq).toBeDefined()
          expect(bashReq!.patterns).toContain("echo test > output.txt")
        }),
      )
    }),
  )

  each("always pattern has space before wildcard to not include different commands", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          yield* run({ command: "ls -la" }, capture(requests))
          const bashReq = requests.find((r) => r.permission === "bash")
          expect(bashReq).toBeDefined()
          expect(bashReq!.always[0]).toBe("ls *")
        }),
      )
    }),
  )
})

describe("tool.shell wave HA classification", () => {
  if (process.platform === "win32") return

  const requests = (command: string, directory: string, stop: boolean) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      if (stop) {
        yield* runIn(directory, fail({ command }, capture(list, new Error("stop after permission"))))
      } else {
        yield* runIn(directory, run({ command }, capture(list)))
      }
      return list
    })

  const expectExternal = (command: string, directory: string, stop = false) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, stop)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
    })

  const expectDynamic = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      const bash = list.find((item) => item.permission === "bash")
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
      expect({ command, always: bash?.always ?? [] }).toEqual({ command, always: [] })
    })

  it.live(
    "scans quote-obfuscated cat command names as file reads",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          'cat"" /etc/hostname',
          '"cat" /etc/hostname',
          "'cat' /etc/hostname",
          'ca"t" /etc/hostname',
          "c'a't /etc/hostname",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "scans a quote-obfuscated rm before an external delete",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const marker = path.join(path.dirname(tmp), `ha-marker-${path.basename(tmp)}.txt`)
        yield* Effect.promise(() => Bun.write(marker, "M"))
        yield* expectExternal(`rm"" ${marker}`, tmp, true)
      }),
    30_000,
  )

  it.live(
    "treats wrapper-prefixed cd forms as dynamic cwd",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "command cd $HOME && cat secret.txt",
          "builtin cd $HOME && cat secret.txt",
          "\\cd $HOME && cat secret.txt",
          '"cd" $HOME && cat secret.txt',
          "env -C $HOME cat secret.txt",
          'eval "cd $HOME" && cat secret.txt',
        ]) {
          yield* expectDynamic(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "classifies wrapper-prefixed file commands",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "command cat /etc/hostname",
          "\\cat /etc/hostname",
          "exec cat /etc/hostname",
          "time cat /etc/hostname",
          "env cat /etc/hostname",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "scans quote-split traversal arguments",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const name = `ha-marker-${path.basename(tmp)}.txt`
        yield* Effect.promise(() => Bun.write(path.join(path.dirname(tmp), name), "M"))
        for (const command of [`cat ".."/${name}`, `cat '..'/${name}`, `cat .""./${name}`, `cat ""../${name}`]) {
          yield* expectExternal(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "scans dynamic path arguments that carry traversal",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "cat $HOME/../opencode-missing",
          "cat ${HOME}/../opencode-missing",
          "cat $PWD/../opencode-missing",
          "cat ${PWD}/../opencode-missing",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "forces the external scan when a persisted grant matches an obfuscated name",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const approved = [{ permission: "bash", pattern: "cat *" }]
        const seen: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
        const next: Tool.Context = {
          ...ctx,
          ask: (req) =>
            Effect.sync(() => {
              const allowed = req.patterns.every((pattern) =>
                approved.some(
                  (rule) =>
                    Wildcard.matchStrict(req.permission, rule.permission) &&
                    Wildcard.matchStrict(pattern, rule.pattern),
                ),
              )
              if (!allowed) seen.push(req)
            }),
        }
        yield* runIn(tmp, run({ command: 'cat"" /etc/hostname' }, next))
        expect(seen.some((item) => item.permission === "external_directory")).toBe(true)
      }),
    30_000,
  )

  it.live(
    "keeps normal quoted and wrapper arguments prompt-free",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "file name.txt"), "x"))
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          'cat "file name.txt"',
          "cat notes.txt",
          "cat 'notes.txt'",
          "command cat notes.txt",
          "env cat notes.txt",
        ]) {
          const list = yield* requests(command, tmp, false)
          expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
            command,
            external: false,
          })
        }
      }),
    30_000,
  )
})

describe("tool.shell wave IA classification", () => {
  if (process.platform === "win32") return

  const requests = (command: string, directory: string, stop: boolean) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      if (stop) {
        yield* runIn(directory, fail({ command }, capture(list, new Error("stop after permission"))))
      } else {
        yield* runIn(directory, run({ command }, capture(list)))
      }
      return list
    })

  const expectScanned = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      const bashReq = list.find((item) => item.permission === "bash")
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
      expect({ command, always: bashReq?.always ?? [] }).toEqual({ command, always: [] })
    })

  const expectExternal = (command: string, directory: string, stop = false) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, stop)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
    })

  const expectClean = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: false,
      })
    })

  const expectNoPersist = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      const bashReq = list.find((item) => item.permission === "bash")
      expect({ command, always: bashReq?.always ?? [] }).toEqual({ command, always: [] })
    })

  it.live(
    "scans brace-list command forms instead of running them unprompted",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "{cat,/etc/hostname}",
          "{cat,/etc/hostname,}",
          "{cat,/etc/hostname} ",
          "{cat,/etc/hostname}; echo done",
          "{cat,/etc/hostname} | head -1",
        ]) {
          yield* expectScanned(command, tmp)
        }
        yield* expectExternal("{ cat /etc/hostname; }", tmp)
        yield* expectExternal("( cat /etc/hostname )", tmp)
      }),
    30_000,
  )

  it.live(
    "scans a brace-list rm before an external delete",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const marker = path.join(path.dirname(tmp), `ia-marker-${path.basename(tmp)}.txt`)
        yield* Effect.promise(() => Bun.write(marker, "M"))
        yield* expectExternal(`{rm,${marker}}`, tmp, true)
      }),
    30_000,
  )

  it.live(
    "handles nested and degenerate brace lists without a zero-prompt absorb",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* expectNoPersist("{a,{b,c}} /etc/hostname", tmp)
        for (const command of ["{,cat} /etc/hostname", "{cat}", "{cd,$HOME}; cat secret.txt"]) {
          yield* expectScanned(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "scans the extended wrapper family and offers no absorbing always",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "nice cat /etc/hostname",
          "nice -n 5 cat /etc/hostname",
          "setsid cat /etc/hostname",
          "xargs cat /etc/hostname",
          "xargs -n1 cat /etc/hostname",
          "timeout 5 cat /etc/hostname",
          "timeout -s KILL 5 cat /etc/hostname",
          "stdbuf cat /etc/hostname",
          "ionice cat /etc/hostname",
          "taskset 1 cat /etc/hostname",
          "chrt 0 cat /etc/hostname",
          "flock /tmp cat /etc/hostname",
          "watch cat /etc/hostname",
          "sudo cat /etc/hostname",
          "doas cat /etc/hostname",
        ]) {
          yield* expectScanned(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "scans a wrapper-prefixed rm before an external delete",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const marker = path.join(path.dirname(tmp), `ia-wrap-${path.basename(tmp)}.txt`)
        yield* Effect.promise(() => Bun.write(marker, "M"))
        for (const command of [`timeout 5 rm ${marker}`, `nice rm ${marker}`, `setsid rm ${marker}`]) {
          yield* expectExternal(command, tmp, true)
        }
      }),
    30_000,
  )

  it.live(
    "a persisted wrapper-name grant cannot absorb the external request",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const [rule, command] of [
          ["nice *", "nice cat /etc/hostname"],
          ["timeout *", "timeout 5 cat /etc/hostname"],
          ["setsid *", "setsid cat /etc/hostname"],
          ["xargs *", "xargs cat /etc/hostname"],
        ]) {
          const approved = [{ permission: "bash", pattern: rule }]
          const seen: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          const next: Tool.Context = {
            ...ctx,
            ask: (req) =>
              Effect.sync(() => {
                const allowed = req.patterns.every((pattern) =>
                  approved.some(
                    (item) =>
                      Wildcard.matchStrict(req.permission, item.permission) &&
                      Wildcard.matchStrict(pattern, item.pattern),
                  ),
                )
                if (!allowed) seen.push(req)
              }),
          }
          yield* runIn(tmp, run({ command }, next))
          expect({ rule, external: seen.some((item) => item.permission === "external_directory") }).toEqual({
            rule,
            external: true,
          })
        }
      }),
    30_000,
  )

  it.live(
    "resolves deep wrapper chains instead of capping the effective command",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const depth of [9, 20]) {
          yield* expectScanned(`${Array.from({ length: depth }, () => "command").join(" ")} cat /etc/hostname`, tmp)
        }
        yield* expectScanned(`${Array.from({ length: 9 }, () => "builtin").join(" ")} cat /etc/hostname`, tmp)
      }),
    30_000,
  )

  it.live(
    "classifies wrapper-prefixed commands nested in eval",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          'eval "env cat /etc/hostname"',
          'eval "command cat /etc/hostname"',
          'eval "timeout 5 cat /etc/hostname"',
        ]) {
          yield* expectScanned(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "resolves env attached options and split strings",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          `env -C${os.homedir()} cat opencode-missing`,
          "env -C/etc cat hostname",
          "env --chdir=/etc cat hostname",
          "env -S 'cat /etc/hostname'",
        ]) {
          yield* expectScanned(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "recognizes a line-continuation command name",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* expectExternal("ca\\\nt /etc/hostname", tmp)
      }),
    30_000,
  )

  it.live(
    "classifies ANSI-C, IFS-in-name and resolvable-variable path shapes",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of ["$'cat' /etc/hostname", "cat $'\\057etc\\057hostname'"]) {
          yield* expectExternal(command, tmp)
        }
        const marker = `ia-traverse-${path.basename(tmp)}.txt`
        yield* Effect.promise(() => Bun.write(path.join(path.dirname(tmp), marker), "M"))
        yield* expectExternal(`cat "."\\./${marker}`, tmp)
        yield* expectScanned("cd${IFS}$HOME && cat secret.txt", tmp)
        yield* expectScanned("c$'d' $HOME && cat secret.txt", tmp)
        yield* expectScanned("cat ${IFS}/etc/hostname", tmp)
        yield* expectScanned("cat $HOME/opencode-missing", tmp)
      }),
    30_000,
  )

  it.live(
    "keeps normal wrapper and brace controls prompt-free",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "nice cat notes.txt",
          "setsid cat notes.txt",
          "xargs echo notes.txt",
          "timeout 5 cat notes.txt",
          "command cat notes.txt",
          "echo {a,b}",
          "cat $PWD/notes.txt",
        ]) {
          yield* expectClean(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "classifies absolute-path commands instead of bypassing the scan",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of ["/usr/bin/cat /etc/hostname", "/bin/cat /etc/hostname", "/usr/bin/env cat /etc/hostname"]) {
          yield* expectScanned(command, tmp)
        }
        const marker = path.join(path.dirname(tmp), `ja-abs-${path.basename(tmp)}.txt`)
        yield* Effect.promise(() => Bun.write(marker, "M"))
        yield* expectExternal(`/usr/bin/timeout 5 rm ${marker}`, tmp, true)
      }),
    30_000,
  )

  it.live(
    "treats unmodelled exec wrappers as conservative",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "zzz cat /etc/hostname",
          "parallel cat /etc/hostname",
          "busybox cat /etc/hostname",
          "fakeroot cat /etc/hostname",
          "unshare cat /etc/hostname",
          "ssh-agent cat /etc/hostname",
          "dbus-run-session cat /etc/hostname",
          "systemd-inhibit cat /etc/hostname",
        ]) {
          yield* expectScanned(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "scans redirection targets",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const marker = path.join(path.dirname(tmp), `ja-redir-${path.basename(tmp)}.txt`)
        yield* Effect.promise(() => Bun.write(marker, "M"))
        yield* expectExternal("cat < /etc/hostname", tmp)
        yield* expectExternal("cat 0< /etc/hostname", tmp)
        yield* expectExternal(`cat > ${marker}`, tmp)
        yield* expectExternal(`cat >> ${marker}`, tmp)
      }),
    30_000,
  )

  it.live(
    "scans adjacent brace concatenations",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* expectScanned("ca{t,} /etc/hostname", tmp)
        yield* expectScanned("{c,}at /etc/hostname", tmp)
        const marker = path.join(path.dirname(tmp), `ja-brace-${path.basename(tmp)}.txt`)
        yield* Effect.promise(() => Bun.write(marker, "M"))
        yield* expectExternal(`r{m,} ${marker}`, tmp, true)
      }),
    30_000,
  )

  it.live(
    "scans file args supplied through wrapper options",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* expectExternal("xargs -a /etc/hostname cat", tmp)
        yield* expectExternal("xargs --arg-file /etc/hostname cat", tmp)
        yield* expectExternal("parallel -a /etc/hostname cat", tmp)
      }),
    30_000,
  )

  it.live(
    "classifies read-capable commands against external paths",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "head /etc/hostname",
          "tail /etc/hostname",
          "grep root /etc/hostname",
          "awk 1 /etc/hostname",
          "sed -n 1p /etc/hostname",
          "sort /etc/hostname",
          "egrep root /etc/hostname",
          "fgrep root /etc/hostname",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "decodes ANSI-C unicode escapes before classifying",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* expectExternal("cat $'\\U0000002Fetc\\U0000002Fhostname'", tmp)
      }),
    30_000,
  )

  it.live(
    "keeps the new classifier paths prompt-free for in-tree controls",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "head notes.txt",
          "tail -1 notes.txt",
          "grep x notes.txt",
          "awk 1 notes.txt",
          "sed -n 1p notes.txt",
          "ca{t,} notes.txt",
          "xargs -a notes.txt echo",
          "cat < notes.txt",
          `cat > ${path.join(tmp, "out.txt")}`,
        ]) {
          yield* expectClean(command, tmp)
        }
      }),
    30_000,
  )
})

describe("tool.shell abort", () => {
  it.live(
    "preserves output when aborted",
    () =>
      runIn(
        projectRoot,
        Effect.gen(function* () {
          const controller = new AbortController()
          const collected: string[] = []
          const res = yield* run(
            {
              command: `echo before && sleep 30`,
            },
            {
              ...ctx,
              abort: controller.signal,
              metadata: (input) =>
                Effect.sync(() => {
                  const output = (input.metadata as { output?: string })?.output
                  if (output && output.includes("before") && !controller.signal.aborted) {
                    collected.push(output)
                    controller.abort()
                  }
                }),
            },
          )
          expect(res.output).toContain("before")
          expect(res.output).toContain("User aborted the command")
          expect(collected.length).toBeGreaterThan(0)
        }),
      ),
    15_000,
  )

  it.live(
    "terminates command on timeout",
    () =>
      runIn(
        projectRoot,
        Effect.gen(function* () {
          const result = yield* run({
            command: `sleep 60`,
            timeout: 500,
          })
          expect(result.output).toContain("shell tool terminated command after exceeding timeout")
          expect(result.output).toContain("retry with a larger timeout value in milliseconds")
        }),
      ),
    15_000,
  )

  it.live(
    "uses RuntimeFlags bashDefaultTimeoutMs when timeout is omitted",
    () =>
      runIn(
        projectRoot,
        Effect.gen(function* () {
          const tool = yield* initShell()
          expect(tool.description).toContain("commands will time out after 500ms")
          const result = yield* tool.execute(
            {
              command: `sleep 60`,
            },
            ctx,
          )
          expect(result.output).toContain("exceeding timeout 500 ms")
        }),
      ).pipe(Effect.provide(RuntimeFlags.layer({ bashDefaultTimeoutMs: 500 }))),
    15_000,
  )

  if (process.platform !== "win32") {
    it.live("captures stderr in output", () =>
      runIn(
        projectRoot,
        Effect.gen(function* () {
          const result = yield* run({
            command: `echo stdout_msg && echo stderr_msg >&2`,
          })
          expect(result.output).toContain("stdout_msg")
          expect(result.output).toContain("stderr_msg")
          expect(result.metadata.exit).toBe(0)
        }),
      ),
    )
  }

  it.live("returns non-zero exit code", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const result = yield* run({
          command: `exit 42`,
        })
        expect(result.metadata.exit).toBe(42)
      }),
    ),
  )

  it.live("streams metadata updates progressively", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const updates: string[] = []
        const result = yield* run(
          {
            command: `echo first && sleep 0.1 && echo second`,
          },
          {
            ...ctx,
            metadata: (input) =>
              Effect.sync(() => {
                const output = (input.metadata as { output?: string })?.output
                if (output) updates.push(output)
              }),
          },
        )
        expect(result.output).toContain("first")
        expect(result.output).toContain("second")
        expect(updates.length).toBeGreaterThan(1)
      }),
    ),
  )
})

describe("tool.shell truncation", () => {
  it.live("truncates output exceeding line limit", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const lineCount = Truncate.MAX_LINES + 500
        const result = yield* run({
          command: fill("lines", lineCount),
        })
        mustTruncate(result)
        expect(result.output).toMatch(/\.\.\.output truncated\.\.\./)
        expect(result.output).toMatch(/Full output saved to:\s+\S+/)
      }),
    ),
  )

  it.live("truncates output exceeding byte limit", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = yield* run({
          command: fill("bytes", byteCount),
        })
        mustTruncate(result)
        expect(result.output).toMatch(/\.\.\.output truncated\.\.\./)
        expect(result.output).toMatch(/Full output saved to:\s+\S+/)
      }),
    ),
  )

  it.live("does not truncate small output", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const result = yield* run({
          command: fill("lines", 1),
        })
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(false)
        expect(result.output).toContain("1")
      }),
    ),
  )

  it.live("full output is saved to file when truncated", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const lineCount = Truncate.MAX_LINES + 100
        const result = yield* run({
          command: fill("lines", lineCount),
        })
        mustTruncate(result)

        const filepath = (result.metadata as { outputPath?: string }).outputPath
        expect(filepath).toBeTruthy()

        const saved = yield* (yield* FSUtil.Service).readFileString(filepath!)
        const lines = saved.trim().split(/\r?\n/)
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      }),
    ),
  )
})

describe("tool.shell wave KA classification", () => {
  if (process.platform === "win32") return

  const requests = (command: string, directory: string, stop: boolean) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      if (stop) {
        yield* runIn(directory, fail({ command }, capture(list, new Error("stop after permission"))))
      } else {
        yield* runIn(directory, run({ command }, capture(list)))
      }
      return list
    })

  const expectExternal = (command: string, directory: string, stop = false) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, stop)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
    })

  const expectScanned = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      const bash = list.find((item) => item.permission === "bash")
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
      expect({ command, always: bash?.always ?? [] }).toEqual({ command, always: [] })
    })

  const expectClean = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: false,
      })
    })

  // Classification-only: stop at the first permission request so a command with a slow or
  // side-effecting execution is never spawned.
  const expectCleanStopped = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* runIn(directory, run({ command }, capture(list, new Error("stop after permission"))).pipe(Effect.exit))
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: false,
      })
    })

  it.live(
    "scans read-capable commands outside FILES and refuses their always grant",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "strings /etc/hostname",
          "base64 /etc/hostname",
          "nl /etc/hostname",
          "tac /etc/hostname",
          "rev /etc/hostname",
          "stat /etc/hostname",
          "ls /etc",
        ]) {
          yield* expectScanned(command, tmp)
        }
        const out = path.join(path.dirname(tmp), `ka-out-${path.basename(tmp)}.txt`)
        yield* expectScanned(`tar cf ${out} /etc/hostname`, tmp)
        yield* expectScanned(`dd if=/etc/hostname of=${out}`, tmp)
        yield* expectScanned("zzz strings /etc/hostname", tmp)
        yield* expectScanned("nice strings /etc/hostname", tmp)
        yield* expectScanned("nice zzz cat /etc/hostname", tmp)
        yield* expectScanned("timeout 5 setarch x86_64 cat /etc/hostname", tmp)
      }),
    90_000,
  )

  it.live(
    "keeps /dev/null-class redirects prompt-free",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "ls notes.txt 2>/dev/null",
          "grep root notes.txt 2>/dev/null",
          "command -v zzz >/dev/null 2>&1",
          "echo hi > /dev/null",
          "cat notes.txt 2> /dev/null",
          "git status 2>/dev/null",
          "ls 2>/dev/null || true",
          "diff notes.txt notes.txt > /dev/null 2>&1",
          "read x < /dev/stdin",
          "exec 2>/dev/null",
          "tail -n 1 /dev/null",
          "echo hi 2> /dev/stderr",
          "echo hi > /dev/fd/1",
          "cat notes.txt 2>&1",
        ]) {
          yield* expectClean(command, tmp)
        }
      }),
    60_000,
  )

  it.live(
    "keeps remote and containerized exec prompt-free",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "ssh host cat /etc/hostname",
          "docker run --rm alpine cat /etc/hostname",
          "kubectl exec pod -- cat /etc/hostname",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    60_000,
  )

  it.live(
    "keeps echo and printf data arguments prompt-free",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of ["echo cat /etc/hostname", "printf cat /etc/hostname"]) {
          yield* expectClean(command, tmp)
        }
      }),
    30_000,
  )

  it.live(
    "scans quote-adjacent and nested brace concatenations",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "c'a't{,} /etc/hostname",
          '"ca"{t,} /etc/hostname',
          "'ca'{t,} /etc/hostname",
          "$'ca'{t,} /etc/hostname",
          'ca{"t",} /etc/hostname',
          "c{a{t,},} /etc/hostname",
          "{c,d}{at,} /etc/hostname",
          "c{a,}{t,} /etc/hostname",
          "ca{t,} /etc/hostname",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    60_000,
  )

  it.live(
    "scans a quote-adjacent or nested brace rm before an external delete",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const marker = path.join(path.dirname(tmp), `ka-brace-${path.basename(tmp)}.txt`)
        yield* Effect.promise(() => Bun.write(marker, "M"))
        for (const command of [`"r"{m,} ${marker}`, `r{m{,},} ${marker}`, `{r,m}{m,} ${marker}`, `r{m,} ${marker}`]) {
          yield* expectExternal(command, tmp, true)
        }
      }),
    60_000,
  )

  it.live(
    "scans attached --arg-file=<path> wrapper options",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "xargs --arg-file=/etc/hostname cat",
          "xargs --arg-file=/etc/hostname -n1 cat",
          "parallel --arg-file=/etc/hostname cat",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    60_000,
  )

  it.live(
    "fails closed on an overflowing ANSI-C unicode escape",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of ["cat $'\\UFFFFFFFF/etc/hostname'", "cat $'\\U00110000/etc/hostname'"]) {
          yield* expectScanned(command, tmp)
        }
      }),
    60_000,
  )

  it.live(
    "extracts a nested -c shell string after an unmodelled wrapper",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "busybox sh -c 'cat /etc/hostname'",
          "bash -c 'cat /etc/hostname'",
          "sh -c 'cat /etc/hostname'",
          "busybox sh -lc 'cat /etc/hostname'",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    60_000,
  )

  it.live(
    "a stored grant cannot absorb a non-FILES or nested-wrapper external read",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const [rule, command] of [
          ["strings *", "strings /etc/hostname"],
          ["ls *", "ls /etc"],
          ["zzz *", "zzz strings /etc/hostname"],
          ["nice *", "nice zzz cat /etc/hostname"],
          ["nice *", "nice setarch x86_64 cat /etc/hostname"],
          ["xargs *", "xargs --arg-file=/etc/hostname cat"],
        ] as const) {
          const approved = [{ permission: "bash", pattern: rule }]
          const seen: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
          const next: Tool.Context = {
            ...ctx,
            ask: (req) =>
              Effect.sync(() => {
                const allowed = req.patterns.every((pattern) =>
                  approved.some(
                    (item) =>
                      Wildcard.matchStrict(req.permission, item.permission) &&
                      Wildcard.matchStrict(pattern, item.pattern),
                  ),
                )
                if (!allowed) seen.push(req)
              }),
          }
          yield* runIn(tmp, run({ command }, next))
          expect({ rule, command, external: seen.some((item) => item.permission === "external_directory") }).toEqual({
            rule,
            command,
            external: true,
          })
        }
      }),
    90_000,
  )
})

describe("tool.shell wave LA classification", () => {
  if (process.platform === "win32") return

  const requests = (command: string, directory: string, stop: boolean) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      if (stop) {
        yield* runIn(directory, fail({ command }, capture(list, new Error("stop after permission"))))
      } else {
        yield* runIn(directory, run({ command }, capture(list)))
      }
      return list
    })

  const expectExternal = (command: string, directory: string, stop = false) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, stop)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
    })

  const expectScanned = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      const bash = list.find((item) => item.permission === "bash")
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
      expect({ command, always: bash?.always ?? [] }).toEqual({ command, always: [] })
    })

  const expectCleanStopped = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* runIn(directory, run({ command }, capture(list, new Error("stop after permission"))).pipe(Effect.exit))
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: false,
      })
    })

  // A stored grant of the shape the tool itself offers (or a config rule) silences every
  // request the run makes. An `external_directory` request it cannot cover keeps the
  // local-path read visible.
  const expectNotAbsorbed = (rule: string, command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, true)
      const approved = [{ permission: "bash", pattern: rule }]
      const uncovered = list.filter(
        (req) =>
          !req.patterns.every((pattern) =>
            approved.some(
              (item) =>
                Wildcard.matchStrict(req.permission, item.permission) &&
                Wildcard.matchStrict(pattern, item.pattern),
            ),
          ),
      )
      expect({
        rule,
        command,
        external: uncovered.some((item) => item.permission === "external_directory"),
      }).toEqual({ rule, command, external: true })
    })

  it.live(
    "scans local-path operands of remote runtimes and keeps remote operands prompt-free",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "docker cp /etc/hostname cid:/x",
          "docker cp cid:/etc/passwd /tmp/la-outside/stolen",
          "docker build -f /etc/hostname .",
          "docker build --file /etc/hostname .",
          "docker run -v /etc:/host alpine cat /host/passwd",
          "docker run --volume /etc:/host alpine true",
          "docker run --mount type=bind,source=/etc,target=/host alpine true",
          "kubectl apply -f /etc/hostname",
          "kubectl --kubeconfig /etc/hostname get pods",
          "kubectl cp /etc/passwd pod:/tmp/x",
          "ssh -i /etc/hostname host true",
          "ssh -F /etc/hostname host true",
          "ssh -i/etc/hostname host true",
          "podman cp /etc/hostname cid:/x",
          "podman run -v /etc:/host alpine true",
          "podman build -f /etc/hostname .",
        ]) {
          yield* expectExternal(command, tmp, true)
        }
        for (const command of [
          "ssh host cat /etc/passwd",
          "docker run --rm alpine cat /etc/hostname",
          "docker run -it alpine cat /etc/hostname",
          "docker run -e FOO=/etc/x alpine true",
          "docker run -w /app alpine true",
          "kubectl exec pod -- cat /etc/hostname",
          "kubectl get pods",
          "kubectl -n kube-system get pods",
          "docker ps -a",
          "podman run alpine cat /etc/hostname",
          "ssh -p 2222 host true",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "scans paths attached to options before the dash-skip",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "tar --files-from=/etc/hostname -cf /dev/null",
          "tar -T/etc/hostname -cf /dev/null",
          "file --files-from=/etc/hostname",
          "zzz --file=/etc/hostname",
          "zzz -f/etc/hostname",
          "zzz --output=/etc/v15probe",
          "zzz --file=~/x",
          "zzz -f../x",
          "zzz -f/",
          "grep --file=/etc/hostname notes.txt",
        ]) {
          yield* expectExternal(command, tmp, true)
        }
        const outside = path.join(path.dirname(tmp), `la-out-${path.basename(tmp)}.tar`)
        yield* expectScanned(`tar -cf${outside} notes.txt`, tmp)
        yield* expectScanned(`tar --file=${outside} -c notes.txt`, tmp)
        for (const command of [
          "tar -cf notes.tar notes.txt",
          "tar --file=notes.tar -c notes.txt",
          "zzz --color=auto notes.txt",
          "ls -la notes.txt",
          "grep -n foo notes.txt",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "does not exempt a command substitution inside an extracted shell string as data",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          'sh -c "$(echo cat /etc/hostname)"',
          'bash -c "$(echo cat /etc/hostname)"',
          'bash -c "`echo cat /etc/hostname`"',
          'eval "$(echo cat /etc/hostname)"',
        ]) {
          yield* expectExternal(command, tmp, true)
        }
        for (const command of [
          'bash -c "echo cat /etc/hostname"',
          'bash -c "echo hi"',
          'echo "$(echo /etc/hostname)"',
          "echo $(date)",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "scans time output targets and variable or substitution redirect targets",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        const parent = path.dirname(tmp)
        const at = (name: string) => path.join(parent, `la-${path.basename(tmp)}-${name}`)
        for (const command of [
          `time -o ${at("t.log")} ls`,
          `/usr/bin/time -o ${at("t2.log")} ls`,
          `time --output=${at("t3.log")} ls`,
          `O=${at("var")}; echo hi > $O`,
          `echo hi > $(echo ${at("subst")})`,
          `out=${at("app")}; echo hi >> $out`,
          `echo hi > \`echo ${at("tick")}\``,
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectExternal("echo hi > $LA_PROBE_UNDEFINED", tmp, true)
        for (const command of ["time ls", "time -p ls", "out=notes.txt; echo hi > $out", "echo hi > notes.txt"]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "a stored remote or self-offered grant cannot absorb a local-path request",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        const offer = yield* requests("docker cp notes.txt cid:/x", tmp, false).pipe(
          Effect.map((list) => list.find((item) => item.permission === "bash")?.always ?? []),
        )
        for (const rule of offer) {
          yield* expectNotAbsorbed(rule, "docker cp /etc/hostname cid:/x", tmp)
        }
        for (const [rule, command] of [
          ["ssh *", "ssh -i /etc/hostname host true"],
          ["kubectl *", "kubectl -f /etc/hostname"],
          ["docker cp *", "docker cp /etc/hostname cid:/x"],
        ] as const) {
          yield* expectNotAbsorbed(rule, command, tmp)
        }
      }),
    120_000,
  )
})

describe("tool.shell wave MA classification", () => {
  if (process.platform === "win32") return

  const requests = (command: string, directory: string, stop: boolean) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      if (stop) {
        yield* runIn(directory, fail({ command }, capture(list, new Error("stop after permission"))))
      } else {
        yield* runIn(directory, run({ command }, capture(list)))
      }
      return list
    })

  const expectExternal = (command: string, directory: string, stop = true) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, stop)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
    })

  const expectCleanStopped = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* runIn(directory, run({ command }, capture(list, new Error("stop after permission"))).pipe(Effect.exit))
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: false,
      })
    })

  const expectNotAbsorbed = (rule: string, command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, true)
      const approved = [{ permission: "bash", pattern: rule }]
      const uncovered = list.filter(
        (req) =>
          !req.patterns.every((pattern) =>
            approved.some(
              (item) =>
                Wildcard.matchStrict(req.permission, item.permission) &&
                Wildcard.matchStrict(pattern, item.pattern),
            ),
          ),
      )
      expect({
        rule,
        command,
        external: uncovered.some((item) => item.permission === "external_directory"),
      }).toEqual({ rule, command, external: true })
    })

  it.live(
    "parses the remote subcommand past global value-options",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "docker --log-level debug cp /etc/hostname cid:/x",
          "docker -l debug cp /etc/hostname cid:/x",
          "docker --context default cp /etc/hostname cid:/x",
          "docker -H unix:///var/run/docker.sock cp /etc/hostname cid:/x",
          "kubectl -n default cp /etc/passwd pod:/tmp/x",
          "kubectl --namespace default cp /etc/passwd pod:/tmp/x",
          "kubectl -v 5 cp /etc/passwd pod:/tmp/x",
          "podman --log-level debug cp /etc/hostname cid:/x",
          "docker --log-level debug build /etc/ssl",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const [rule, command] of [
          ["docker --log-level *", "docker --log-level debug cp /etc/hostname cid:/x"],
          ["kubectl -n *", "kubectl -n default cp /etc/passwd pod:/tmp/x"],
          ["docker --context *", "docker --context default cp /etc/hostname cid:/x"],
          ["podman --log-level *", "podman --log-level debug cp /etc/hostname cid:/x"],
        ] as const) {
          yield* expectNotAbsorbed(rule, command, tmp)
        }
        for (const command of [
          "docker --log-level debug ps",
          "kubectl -n default get pods",
          "kubectl --namespace kube-system get pods",
          "podman --log-level debug ps",
          "docker --context default ps",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "gates podman local-file subcommands and path-bearing options",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.tar"), "x"))
        for (const command of [
          "podman load -i /etc/hostname",
          "podman import /etc/hostname",
          "podman play kube /etc/hostname",
          "podman kube play /etc/hostname",
          "docker load -i /etc/hostname",
          "docker import /etc/hostname",
          "podman run --security-opt seccomp=/etc/hostname alpine true",
          "podman create --security-opt seccomp=/etc/hostname alpine",
          "podman run --device /etc/hostname alpine true",
          "podman build --iidfile /etc/hostname .",
          "podman build --build-arg X=/etc/hostname .",
          "docker run --security-opt seccomp=/etc/hostname alpine true",
          "docker build --iidfile /etc/hostname .",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const [rule, command] of [
          ["podman import *", "podman import /etc/hostname"],
          ["podman play *", "podman play kube /etc/hostname"],
          ["podman run *", "podman run --device /etc/hostname alpine true"],
        ] as const) {
          yield* expectNotAbsorbed(rule, command, tmp)
        }
        for (const command of [
          "podman load -i notes.tar",
          "podman import notes.tar",
          "podman run --security-opt label=disable alpine true",
          "docker build --build-arg VERSION=1 .",
          "podman run -v notes.tar:/data alpine true",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "does not exempt a quoted command-substitution payload",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          'sh -c "$(echo \'cat /etc/hostname\')"',
          'bash -c "$(printf %s \'cat /etc/hostname\')"',
          'eval "$(printf %s \'cat /etc/hostname\')"',
          'bash -c "$(echo -n \'cat /etc/hostname\')"',
          'sh -c "$(printf \'cat /etc/hostname\')"',
          'bash -c "$(echo \'docker run -v /etc:/h alpine ls /h\')"',
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const [rule, command] of [
          ["echo *", 'sh -c "$(echo \'cat /etc/hostname\')"'],
          ["printf *", 'bash -c "$(printf %s \'cat /etc/hostname\')"'],
        ] as const) {
          yield* expectNotAbsorbed(rule, command, tmp)
        }
        for (const command of ['bash -c "$(echo \'hello world\')"', 'sh -c "$(echo hi)"']) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "does not prompt on non-path attached option values while scanning real ones",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "awk -F/ '{print $1}' notes.txt",
          "cut -d/ -f1 notes.txt",
          "sort -t/ notes.txt",
          "tr -d/ < notes.txt",
          "grep -e/etc/hostname notes.txt",
          "sed -e/etc/x notes.txt",
          "ls -d/etc",
          "gcc -Iinclude/sub -o out main.c",
          "cc -Lbuild/lib -lfoo main.c",
          "java -Dlog.dir=logs/app -jar app.jar",
          "grep --regexp=/etc/passwd notes.txt",
          "zzz -Dfoo=bar/baz",
          "zzz -x2/3",
          "zzz -Wl,-rpath,lib/x",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
        for (const command of [
          "tar -T/etc/hostname -cf /dev/null",
          "grep -f/etc/hostname notes.txt",
          "sed -f/etc/x notes.txt",
          `sort -o${path.join(path.dirname(tmp), "ma-sort-out")} notes.txt`,
          "gcc -o/etc/ma-gcc-out main.c",
          "zzz -f/etc/hostname",
          "zzz -T/etc/hostname",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "keeps relative unresolved redirects prompt-free but anchors unknown variables",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of ["echo hi > out-$$.log", "echo hi > $RANDOM.log", "echo hi > notes.txt"]) {
          yield* expectCleanStopped(command, tmp)
        }
        for (const command of [
          "O=/etc/hostname; echo hi > $O",
          "echo hi > $MA_PROBE_UNDEFINED",
          "echo hi > $MA_PROBE_UNDEFINED.out",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "resolves variables in source order including chains, substitutions and loops",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "O=/etc/hostname; strings $O; O=notes.txt",
          "B=/etc/hostname; A=$B; cat $A",
          "O=$(echo /etc/hostname); cat $O",
          "for f in /etc/hostname; do cat $f; done",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of [
          "O=notes.txt; strings $O; O=/etc/hostname",
          "B=notes.txt; A=$B; cat $A",
          "for f in notes.txt; do cat $f; done",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  // The offered `always` grant is what turns a single approval into a standing
  // zero-prompt channel, so the repaired attack shapes must withdraw it.
  it.live(
    "offers no absorbing always grant on the repaired attack shapes",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "docker --log-level debug cp /etc/hostname cid:/x",
          "kubectl -n default cp /etc/passwd pod:/tmp/x",
          "podman load -i /etc/hostname",
          "podman play kube /etc/hostname",
          "O=/etc/hostname; strings $O; O=notes.txt",
          "for f in /etc/hostname; do cat $f; done",
        ]) {
          const list = yield* requests(command, tmp, false)
          const bash = list.find((item) => item.permission === "bash")
          expect({
            command,
            external: list.some((item) => item.permission === "external_directory"),
            always: bash?.always ?? [],
          }).toEqual({ command, external: true, always: [] })
        }
      }),
    120_000,
  )
})

describe("tool.shell wave N classification", () => {
  if (process.platform === "win32") return

  const requests = (command: string, directory: string, stop: boolean) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      if (stop) {
        yield* runIn(directory, fail({ command }, capture(list, new Error("stop after permission"))))
      } else {
        yield* runIn(directory, run({ command }, capture(list)))
      }
      return list
    })

  const expectExternal = (command: string, directory: string, stop = true) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, stop)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
    })

  const expectCleanStopped = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* runIn(directory, run({ command }, capture(list, new Error("stop after permission"))).pipe(Effect.exit))
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: false,
      })
    })

  const expectNotAbsorbed = (rule: string, command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, true)
      const approved = [{ permission: "bash", pattern: rule }]
      const uncovered = list.filter(
        (req) =>
          !req.patterns.every((pattern) =>
            approved.some(
              (item) =>
                Wildcard.matchStrict(req.permission, item.permission) && Wildcard.matchStrict(pattern, item.pattern),
            ),
          ),
      )
      expect({
        rule,
        command,
        external: uncovered.some((item) => item.permission === "external_directory"),
      }).toEqual({ rule, command, external: true })
    })

  const expectNoAlways = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      const bash = list.find((item) => item.permission === "bash")
      expect({
        command,
        external: list.some((item) => item.permission === "external_directory"),
        always: bash?.always ?? [],
      }).toEqual({ command, external: true, always: [] })
    })

  it.live(
    "classifies variable-held program text consumed as a -c/eval operand",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "C='cat /etc/hostname'; bash -c \"$C\"",
          "C='cat /etc/hostname'; sh -c \"$C\"",
          "C='cat /etc/hostname'; eval \"$C\"",
          "C='cat /etc/hostname'; eval $C",
          "C='cat /etc/hostname'; bash -c $C",
          "C='cat /etc/hostname'; bash -c \"$C\" ; true",
          "C='strings /etc/hostname'; bash -c \"$C\"",
          "C='docker run -v /etc:/h alpine ls /h'; bash -c \"$C\"",
          'A=cat; B=/etc/hostname; bash -c "$A $B"',
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNoAlways("C='cat /etc/hostname'; bash -c \"$C\"", tmp)
        yield* expectNotAbsorbed("bash *", "C='cat /etc/hostname'; sh -c \"$C\"", tmp)
        for (const command of [
          "C='cat notes.txt'; bash -c \"$C\"",
          "C='echo hi'; bash -c \"$C\"",
          "C='ls notes.txt'; sh -c \"$C\"",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "finds the remote subcommand past unlisted global value-options",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "docker --tlscacert /tmp/ca.pem cp /etc/hostname cid:/x",
          "docker --tlscert /tmp/c.pem cp /etc/hostname cid:/x",
          "docker --tlskey /tmp/k.pem cp /etc/hostname cid:/x",
          "docker --log-driver json cp /etc/hostname cid:/x",
          "podman --connection foo cp /etc/hostname cid:/x",
          "docker --tlscacert /tmp/ca.pem build /etc/ssl",
          "docker --tlscacert=/tmp/ca.pem cp /etc/hostname cid:/x",
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNotAbsorbed("docker --tlscacert *", "docker --tlscacert /tmp/ca.pem cp /etc/hostname cid:/x", tmp)
        yield* expectNotAbsorbed("docker *", "docker --tlscert /tmp/c.pem cp /etc/hostname cid:/x", tmp)
        for (const command of [
          "docker --log-level debug cp /etc/hostname cid:/x",
          "kubectl -n default cp /etc/passwd pod:/tmp/x",
          "podman --log-level debug cp /etc/hostname cid:/x",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of [
          "docker --log-level debug ps",
          "kubectl -n default get pods",
          "docker --context default ps",
          "podman --log-level debug ps",
          "docker run --rm alpine cat /etc/hostname",
          "kubectl exec pod -- cat /etc/hostname",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "falls back to the generic scan for unmodelled short options of modelled commands",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "gcc -I/etc/hostname -c main.c",
          "gcc -include/etc/hostname -E main.c",
          "gcc -imacros/etc/hostname -E main.c",
          "gcc -idirafter/etc/hostname -c main.c",
          "gcc -isystem/etc/hostname -c main.c",
          "gcc -Wl,/etc/hostname -o /dev/null main.c",
          "gcc -D/etc/hostname -E main.c",
          "gcc -U/etc/hostname -E main.c",
          "cc -I/etc/hostname -c main.c",
          "javac -d/etc/hostname Foo.java",
          "javac -cp/etc/hostname Foo.java",
          "java -cp/etc/hostname Foo",
          "gawk -i/etc/hostname 'BEGIN{}' notes.txt",
          "gcc -o/etc/hostname main.c",
          "gcc -L/etc/hostname main.c",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of [
          "awk -F/ '{print $1}' notes.txt",
          "cut -d/ -f1 notes.txt",
          "sort -t/ notes.txt",
          "tr -d/ < notes.txt",
          "grep -e/etc/hostname notes.txt",
          "sed -e/etc/x notes.txt",
          "ls -d/etc",
          "gcc -Iinclude/sub -o out main.c",
          "cc -Lbuild/lib -lfoo main.c",
          "java -Dlog.dir=logs/app -jar app.jar",
          "grep --regexp=/etc/passwd notes.txt",
          "gawk -F/ 'BEGIN{}' notes.txt",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "scopes a re-parsed substitution payload's own assignments",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "sh -c \"$(echo 'x=/etc/hostname;cat $x')\"",
          "sh -c \"$(echo 'x=/etc/hostname; cat $x')\"",
          "sh -c \"$(echo 'x=/etc/hostname; cat ${x}')\"",
          "sh -c \"$(printf %s 'x=/etc/hostname; cat $x')\"",
          "eval \"$(echo 'x=/etc/hostname; cat $x')\"",
          "sh -c \"$(echo 'export x=/etc/hostname; cat $x')\"",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of ["sh -c \"$(echo 'x=notes.txt; cat $x')\"", "sh -c \"$(echo 'x=notes.txt;cat $x')\""]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "scans =/, attached external option values on unmodelled commands",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "zzz -X=/etc/hostname",
          "zzz -Wl,/etc/hostname",
          "gcc -Wl,-rpath,/etc",
          "gcc -Wl,/etc/hostname -o /dev/null main.c",
          "zzz -Wl,-rpath,/etc",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of [
          "zzz -Dfoo=bar/baz",
          "zzz -x2/3",
          "zzz -Wl,-rpath,lib/x",
          "gcc -Wl,-rpath,lib/x -o /dev/null main.c",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "parses no-whitespace substitution payloads",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "sh -c \"$(echo 'cat</etc/hostname')\"",
          "sh -c \"$(echo 'wc</etc/hostname')\"",
          "sh -c \"$(echo 'head</etc/hostname')\"",
          "sh -c \"$(printf %s 'cat</etc/hostname')\"",
          "eval \"$(echo 'cat</etc/hostname')\"",
          "sh -c \"$(echo 'cat /etc/hostname>/tmp/opencode-wave-n-n6')\"",
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectCleanStopped("sh -c \"$(echo 'cat<notes.txt')\"", tmp)
      }),
    120_000,
  )

  it.live(
    "scans redirect destinations inside a re-parsed payload",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "sh -c \"$(echo 'true > /tmp/opencode-wave-n-n7')\"",
          "sh -c \"$(echo 'true>/tmp/opencode-wave-n-n7b')\"",
          "sh -c \"$(echo 'echo hi > /tmp/opencode-wave-n-n7c')\"",
          "sh -c \"$(printf %s 'touch>/tmp/opencode-wave-n-n7d')\"",
          "eval \"$(echo 'true > /tmp/opencode-wave-n-n7e')\"",
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectCleanStopped("sh -c \"$(echo 'true > notes.txt')\"", tmp)
      }),
    120_000,
  )

  it.live(
    "gates remote local-file options and shell default-value expansions",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "podman context import x /etc/hostname",
          "docker load --input=/etc/hostname",
          "podman load --input=/etc/hostname",
          "kubectl --client-certificate /etc/hostname get pods",
          "kubectl --client-key /etc/hostname get pods",
          "kubectl --certificate-authority /etc/hostname get pods",
          "kubectl --token-file /etc/hostname get pods",
          "docker run --secret id=x,src=/etc/hostname alpine true",
          "ssh -o IdentityFile=/etc/hostname host true",
          "ssh -E /etc/hostname host true",
          "cat ${O:-/etc/hostname}",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of ["cat ${O:-notes.txt}", "kubectl --client-certificate=notes.txt get pods"]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "keeps the wider benign corpus prompt-free while the M-A closes hold",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.tar"), "x"))
        for (const command of [
          "awk -F/ '{print $1}' notes.txt",
          "cut -d/ -f1 notes.txt",
          "sort -t/ notes.txt",
          "tr -d/ < notes.txt",
          "grep -e/etc/hostname notes.txt",
          "sed -e/etc/x notes.txt",
          "ls -d/etc",
          "gcc -Iinclude/sub -o out main.c",
          "cc -Lbuild/lib -lfoo main.c",
          "java -Dlog.dir=logs/app -jar app.jar",
          "grep --regexp=/etc/passwd notes.txt",
          "zzz -Dfoo=bar/baz",
          "zzz -x2/3",
          "zzz -Wl,-rpath,lib/x",
          "echo hi > out-$$.log",
          "echo hi > $RANDOM.log",
          "echo hi > notes.txt",
          "O=notes.txt; strings $O; O=/etc/hostname",
          "B=notes.txt; A=$B; cat $A",
          "for f in notes.txt; do cat $f; done",
          "podman load -i notes.tar",
          "podman import notes.tar",
          "podman run --security-opt label=disable alpine true",
          "docker build --build-arg VERSION=1 .",
          "docker --log-level debug ps",
          "kubectl -n default get pods",
          "kubectl --namespace kube-system get pods",
          "podman --log-level debug ps",
          "docker --context default ps",
          "docker run --rm alpine cat /etc/hostname",
          "kubectl exec pod -- cat /etc/hostname",
          "ssh host cat /etc/hostname",
          'bash -c "$(echo \'hello world\')"',
          'sh -c "$(echo hi)"',
          "cat notes.txt",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
        for (const command of [
          "docker --log-level debug cp /etc/hostname cid:/x",
          "kubectl -n default cp /etc/passwd pod:/tmp/x",
          "podman load -i /etc/hostname",
          "podman play kube /etc/hostname",
          'sh -c "$(echo \'cat /etc/hostname\')"',
          "O=/etc/hostname; strings $O; O=notes.txt",
          "for f in /etc/hostname; do cat $f; done",
          "tar -T/etc/hostname -cf /dev/null",
          "grep -f/etc/hostname notes.txt",
          "sed -f/etc/hostname notes.txt",
          "gcc -o/etc/hostname main.c",
          "zzz -f/etc/hostname",
          "cat /etc/hostname",
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    120_000,
  )
})

describe("tool.shell wave O classification", () => {
  if (process.platform === "win32") return

  const requests = (command: string, directory: string, stop: boolean) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      if (stop) {
        yield* runIn(directory, fail({ command }, capture(list, new Error("stop after permission"))))
      } else {
        yield* runIn(directory, run({ command }, capture(list)))
      }
      return list
    })

  const expectExternal = (command: string, directory: string, stop = true) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, stop)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
    })

  const expectCleanStopped = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* runIn(directory, run({ command }, capture(list, new Error("stop after permission"))).pipe(Effect.exit))
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: false,
      })
    })

  const expectNotAbsorbed = (rule: string, command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, true)
      const approved = [{ permission: "bash", pattern: rule }]
      const uncovered = list.filter(
        (req) =>
          !req.patterns.every((pattern) =>
            approved.some(
              (item) =>
                Wildcard.matchStrict(req.permission, item.permission) && Wildcard.matchStrict(pattern, item.pattern),
            ),
          ),
      )
      expect({
        rule,
        command,
        external: uncovered.some((item) => item.permission === "external_directory"),
      }).toEqual({ rule, command, external: true })
    })

  const expectNoAlways = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      const bash = list.find((item) => item.permission === "bash")
      expect({
        command,
        external: list.some((item) => item.permission === "external_directory"),
        always: bash?.always ?? [],
      }).toEqual({ command, external: true, always: [] })
    })

  it.live(
    "fails closed on an eval script whose commands are all dynamic-named or unresolvable",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          'bash -c "$UNSET_V18 cat /etc/hostname"',
          'sh -c "$UNSET_V18 cat /etc/hostname"',
          'eval "$UNSET_V18 cat /etc/hostname"',
          'bash -c "${UNSET_V18} cat /etc/hostname"',
          'bash -c "$UNSET_V18cat /etc/hostname"',
          'bash -c "${X:-cat /etc/hostname}"',
          'eval "${X:-cat /etc/hostname}"',
          'sh -c "${X:=cat /etc/hostname}"',
          'bash -c "${X-cat /etc/hostname}"',
          'C="${X:-cat /etc/hostname}"; bash -c "$C"',
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNoAlways('bash -c "$UNSET_V18 cat /etc/hostname"', tmp)
        for (const command of ['bash -c "${X:-cat notes.txt}"', 'sh -c "${X:-echo hi}"']) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "scopes an eval script's re-parsed program text with its own assignments",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "C='x=/etc/hostname; cat $x'; bash -c \"$C\"",
          "C='x=/etc/hostname; cat ${x}'; bash -c \"$C\"",
          "C='x=/etc/hostname; cat $x'; sh -c \"$C\"",
          "C='x=/etc/hostname; cat $x'; eval \"$C\"",
          "C='x=/etc; cat $x/hostname'; bash -c \"$C\"",
          "C='for f in /etc/hostname; do cat $f; done'; bash -c \"$C\"",
          "C='x=/etc/hostname; cat $x'; bash -c \"$C\" ; true",
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNoAlways("C='x=/etc/hostname; cat $x'; bash -c \"$C\"", tmp)
        for (const command of [
          "C='x=notes.txt; cat $x'; bash -c \"$C\"",
          "C='x=notes.txt; cat $x'; sh -c \"$C\"",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "finds the remote subcommand past a global option whose value is a subcommand word",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "docker --tlscacert ps cp /etc/hostname cid:/x",
          "docker --tlscert logs cp /etc/hostname cid:/x",
          "docker --tlskey info cp /etc/hostname cid:/x",
          "docker --tlsverify ps cp /etc/hostname cid:/x",
          "podman --connection version cp /etc/hostname cid:/x",
          "podman --cgroup-manager ps cp /etc/hostname cid:/x",
          "podman --tmpdir ps load -i /etc/hostname",
          "kubectl --insecure-skip-tls-verify get cp /etc/passwd pod:/x",
          "docker --tlscacert ps build /etc/ssl",
          "docker --tlscacert ps context import x /etc/hostname",
          "docker --tlscacert ps play kube /etc/hostname",
          "podman --connection ps kube play /etc/hostname",
          "docker --tlscacert ps -- cp /etc/hostname cid:/x",
          "docker --tlscacert ps cp cid:/x /etc/v18out",
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNotAbsorbed("docker --tlscacert *", "docker --tlscacert ps cp /etc/hostname cid:/x", tmp)
        yield* expectNotAbsorbed("docker --tlskey *", "docker --tlskey info cp /etc/hostname cid:/x", tmp)
        yield* expectNotAbsorbed("podman --connection *", "podman --connection version cp /etc/hostname cid:/x", tmp)
        for (const command of [
          "docker --tlscacert /tmp/ca.pem cp /etc/hostname cid:/x",
          "docker --config ps cp /etc/hostname cid:/x",
          "docker --unknown-flag-xyz cp /etc/hostname cid:/x",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of [
          "docker --log-level debug ps",
          "kubectl -n default get pods",
          "docker --context default ps",
          "docker --config ~/.docker ps",
          "docker --tlsverify ps",
          "docker run --rm alpine cat /etc/hostname",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "strips quotes before inspecting an attached option value",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          'gcc "-I/etc" -c main.c',
          "gcc '-include/etc' -E main.c",
          'gcc "-Wl,/etc/hostname" -o /dev/null main.c',
          'zzz "-X=/etc"',
          "zzz '-Wl,/etc/hostname'",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of [
          'gcc "-Iinclude" -o out main.c',
          'zzz "-Dfoo=bar/baz"',
          "gawk \"-F/\" 'BEGIN{}' notes.txt",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "resolves the alternate ${VAR:+word} expansion",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "O=notes.txt; cat ${O:+/etc/hostname}",
          "O=1; cat ${O:+/etc/hostname}",
          'O=notes.txt; bash -c "${O:+cat /etc/hostname}"',
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of ["O=notes.txt; cat ${O:+notes.txt}", "cat ${O:+notes.txt}"]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "scans the attached docker --config= value",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        yield* expectExternal("docker --config=/etc/hostname ps", tmp)
        yield* expectNoAlways("docker --config=/etc/hostname ps", tmp)
        yield* expectNotAbsorbed("docker --config=/etc/hostname *", "docker --config=/etc/hostname ps", tmp)
        for (const command of [
          "docker --config notes.txt ps",
          "docker --config=notes.txt ps",
          "docker --config ~/.docker ps",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "classifies a function body with the fully-merged scope",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "f(){ cat $x; }; x=/etc/hostname; f",
          "bash -c 'f(){ cat $x; }; x=/etc/hostname; f'",
          "sh -c \"$(echo 'f(){ cat $x; }; x=/etc/hostname; f')\"",
        ]) {
          yield* expectExternal(command, tmp)
        }
        for (const command of [
          "bash -c 'f(){ cat notes.txt; }; f'",
          "bash -c 'f(){ cat $x; }; x=notes.txt; f'",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )
})

describe("tool.shell wave P classification", () => {
  if (process.platform === "win32") return

  const requests = (command: string, directory: string, stop: boolean) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      if (stop) {
        yield* runIn(directory, fail({ command }, capture(list, new Error("stop after permission"))))
      } else {
        yield* runIn(directory, run({ command }, capture(list)))
      }
      return list
    })

  const expectExternal = (command: string, directory: string, stop = true) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, stop)
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: true,
      })
    })

  const expectCleanStopped = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list: Array<Omit<PermissionV1.Request, "id" | "sessionID" | "tool">> = []
      yield* runIn(directory, run({ command }, capture(list, new Error("stop after permission"))).pipe(Effect.exit))
      expect({ command, external: list.some((item) => item.permission === "external_directory") }).toEqual({
        command,
        external: false,
      })
    })

  const expectNotAbsorbed = (rule: string, command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, true)
      const approved = [{ permission: "bash", pattern: rule }]
      const uncovered = list.filter(
        (req) =>
          !req.patterns.every((pattern) =>
            approved.some(
              (item) =>
                Wildcard.matchStrict(req.permission, item.permission) && Wildcard.matchStrict(pattern, item.pattern),
            ),
          ),
      )
      expect({
        rule,
        command,
        external: uncovered.some((item) => item.permission === "external_directory"),
      }).toEqual({ rule, command, external: true })
    })

  const expectNoAlways = (command: string, directory: string) =>
    Effect.gen(function* () {
      const list = yield* requests(command, directory, false)
      const bash = list.find((item) => item.permission === "bash")
      expect({
        command,
        external: list.some((item) => item.permission === "external_directory"),
        always: bash?.always ?? [],
      }).toEqual({ command, external: true, always: [] })
    })

  it.live(
    "wave P: scopes a function-body redirect destination with the fully-merged scope",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          "x=notes.txt; f(){ cat < $x; }; x=/etc/hostname; f",
          "x=notes.txt; f(){ echo hi > $x; }; x=/etc/hostname; f",
          "x=notes.txt; f(){ cat >> $x; }; x=/etc/hostname; f",
          "function f { cat < $x; }; x=/etc/hostname; f",
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNotAbsorbed("f *", "x=notes.txt; f(){ echo hi > $x; }; x=/etc/hostname; f", tmp)
        for (const command of [
          "x=notes.txt; f(){ cat < $x; }; f",
          "f(){ echo hi > $x; }; x=dist/o.txt; f",
          "x=notes.txt; f(){ echo hi > $x; }; f",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "wave P: anchors an eval script when a dynamic-named command is dropped beside a classifiable one",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of [
          'bash -c "$Q cat /etc/hostname; true"',
          'bash -c "$Q cat /etc/hostname; cat notes.txt"',
          'bash -c "true; $Q cat /etc/hostname"',
          'bash -c "$Q cat /etc/hostname && true"',
          'bash -c "$Q cat /etc/hostname; echo hi"',
          'sh -c "$Q cat /etc/hostname; true"',
          'eval "$Q cat /etc/hostname; true"',
          'bash -c "$Q cat /etc/hostname | cat"',
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNoAlways('bash -c "$Q cat /etc/hostname; true"', tmp)
        yield* expectNotAbsorbed("bash *", 'bash -c "$Q cat /etc/hostname; true"', tmp)
        for (const command of [
          'bash -c "echo hi; true"',
          'bash -c "set -e; npm ci; npm test"',
          'bash -c "cat notes.txt; true"',
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "wave P: strips quotes from a remote option name before inspecting it",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          'docker "--tlscacert" ps cp /etc/hostname cid:/x',
          "docker '--tlscacert' ps cp /etc/hostname cid:/x",
          'docker "--config=/etc/hostname" ps',
          "docker '--config=/etc/hostname' ps",
          'podman "--connection" ps cp /etc/hostname cid:/x',
          'docker "--tlscacert=ps" cp /etc/hostname cid:/x',
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNoAlways('docker "--tlscacert" ps cp /etc/hostname cid:/x', tmp)
        yield* expectNotAbsorbed('docker "--tlscacert" *', 'docker "--tlscacert" ps cp /etc/hostname cid:/x', tmp)
        yield* expectNotAbsorbed('docker "--config=/etc/hostname" *', 'docker "--config=/etc/hostname" ps', tmp)
        for (const command of ['docker "--log-level" debug ps', 'docker "--context" default ps', 'docker "--config" ~/.docker ps']) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "wave P: scans the attached value of an unmodelled remote global option",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "docker --tlscacert=/etc/hostname ps",
          "docker --data-root=/etc/hostname ps",
          "podman --root=/etc/hostname ps",
          "docker --tlscacert=../etc/hostname ps",
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectNoAlways("docker --tlscacert=/etc/hostname ps", tmp)
        yield* expectNotAbsorbed("docker --tlscacert *", "docker --tlscacert=/etc/hostname ps", tmp)
        yield* expectNotAbsorbed("docker --config *", "docker --tlscacert=/etc/hostname ps", tmp)
        for (const command of [
          "docker --log-level=debug ps",
          "docker --context=default ps",
          "docker --host=tcp://127.0.0.1:2375 ps",
          "docker --config=.docker ps",
        ]) {
          yield* expectCleanStopped(command, tmp)
        }
      }),
    120_000,
  )

  it.live(
    "wave P: bounds a self-referential expansion and fails closed",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        for (const command of [
          "A='$A$A$A$A$A$A$A$A'; cat $A",
          "A='$A$A$A$A$A$A$A$A$A$A$A$A'; cat $A",
          "bash -c \"A='$A$A$A$A$A$A$A$A'; cat \\$A\"",
        ]) {
          yield* expectExternal(command, tmp)
        }
        yield* expectExternal('cat "${X:-${Y:-/etc/hostname}}"', tmp)
      }),
    120_000,
  )

  it.live(
    "wave P: resolves the alternate ${VAR:+word} expansion in an eval script",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        yield* Effect.promise(() => Bun.write(path.join(tmp, "notes.txt"), "x"))
        for (const command of ['bash -c "${PAGER:+cat} notes.txt"', 'bash -c "${X:+echo hi}"']) {
          yield* expectCleanStopped(command, tmp)
        }
        for (const command of [
          'bash -c "${X:+cat /etc/hostname}"',
          'X=1; bash -c "${X:+cat /etc/hostname}"',
        ]) {
          yield* expectExternal(command, tmp)
        }
      }),
    120_000,
  )
})
