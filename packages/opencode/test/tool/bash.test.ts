import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Shell } from "../../src/shell/shell"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { Truncate } from "../../src/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
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

const withShell = (item: { label: string; shell: string }, fn: () => Promise<void>) => async () => {
  const prev = process.env.SHELL
  process.env.SHELL = item.shell
  Shell.acceptable.reset()
  Shell.preferred.reset()
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    Shell.acceptable.reset()
    Shell.preferred.reset()
  }
}

const each = (name: string, fn: (item: { label: string; shell: string }) => Promise<void>) => {
  for (const item of shells) {
    test(
      `${name} [${item.label}]`,
      withShell(item, () => fn(item)),
    )
  }
}

const capture = (requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">>, stop?: Error) => ({
  ...ctx,
  ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
    requests.push(req)
    if (stop) throw stop
  },
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

describe("tool.bash", () => {
  each("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo test",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })
})

describe("tool.bash permissions", () => {
  each("asks for bash permission with correct pattern", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          capture(requests),
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo hello")
      },
    })
  })

  each("asks for bash permission with multiple commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await bash.execute(
          {
            command: "echo foo && echo bar",
            description: "Echo twice",
          },
          capture(requests),
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo foo")
        expect(requests[0].patterns).toContain("echo bar")
      },
    })
  })

  for (const item of ps) {
    test(
      `parses PowerShell conditionals for permission prompts [${item.label}]`,
      withShell(item, async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
            await bash.execute(
              {
                command: "Write-Host foo; if ($?) { Write-Host bar }",
                description: "Check PowerShell conditional",
              },
              capture(requests),
            )
            const bashReq = requests.find((r) => r.permission === "bash")
            expect(bashReq).toBeDefined()
            expect(bashReq!.patterns).toContain("Write-Host foo")
            expect(bashReq!.patterns).toContain("Write-Host bar")
            expect(bashReq!.always).toContain("Write-Host *")
          },
        })
      }),
    )
  }

  each("asks for external_directory permission for wildcard external paths", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const file = process.platform === "win32" ? `${process.env.WINDIR!.replaceAll("\\", "/")}/*` : "/etc/*"
        const want = process.platform === "win32" ? glob(path.join(process.env.WINDIR!, "*")) : "/etc/*"
        await expect(
          bash.execute(
            {
              command: `cat ${file}`,
              description: "Read wildcard path",
            },
            capture(requests, err),
          ),
        ).rejects.toThrow(err.message)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(want)
      },
    })
  })

  if (process.platform === "win32") {
    if (bash) {
      test(
        "asks for nested bash command permissions [bash]",
        withShell({ label: "bash", shell: bash }, async () => {
          await using outerTmp = await tmpdir({
            init: async (dir) => {
              await Bun.write(path.join(dir, "outside.txt"), "x")
            },
          })
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const file = path.join(outerTmp.path, "outside.txt").replaceAll("\\", "/")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await bash.execute(
                {
                  command: `echo $(cat "${file}")`,
                  description: "Read nested bash file",
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(outerTmp.path, "*")))
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).toContain(`cat "${file}"`)
            },
          })
        }),
      )
    }
  }

  if (process.platform === "win32") {
    for (const item of ps) {
      test(
        `asks for external_directory permission for PowerShell paths after switches [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                bash.execute(
                  {
                    command: `Copy-Item -PassThru "${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini" ./out`,
                    description: "Copy Windows ini",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for nested PowerShell command permissions [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const file = `${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini`
              await bash.execute(
                {
                  command: `Write-Output $(Get-Content ${file})`,
                  description: "Read nested PowerShell file",
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).toContain(`Get-Content ${file}`)
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for drive-relative PowerShell paths [${item.label}]`,
        withShell(item, async () => {
          await using tmp = await tmpdir()
          await Instance.provide({
            directory: tmp.path,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                bash.execute(
                  {
                    command: 'Get-Content "C:../outside.txt"',
                    description: "Read drive-relative file",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(path.dirname(tmp.path), "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for $HOME PowerShell paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                bash.execute(
                  {
                    command: 'Get-Content "$HOME/.ssh/config"',
                    description: "Read home config",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(os.homedir(), ".ssh", "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for $PWD PowerShell paths [${item.label}]`,
        withShell(item, async () => {
          await using tmp = await tmpdir()
          await Instance.provide({
            directory: tmp.path,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                bash.execute(
                  {
                    command: 'Get-Content "$PWD/../outside.txt"',
                    description: "Read pwd-relative file",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(path.dirname(tmp.path), "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for $PSHOME PowerShell paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                bash.execute(
                  {
                    command: 'Get-Content "$PSHOME/outside.txt"',
                    description: "Read pshome file",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(path.dirname(item.shell), "*")))
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for missing PowerShell env paths [${item.label}]`,
        withShell(item, async () => {
          const key = "OPENCODE_TEST_MISSING"
          const prev = process.env[key]
          delete process.env[key]
          try {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const err = new Error("stop after permission")
                const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
                const root = path.parse(process.env.WINDIR!).root.replace(/[\\/]+$/, "")
                await expect(
                  bash.execute(
                    {
                      command: `Get-Content -Path "${root}$env:${key}\\Windows\\win.ini"`,
                      description: "Read Windows ini with missing env",
                    },
                    capture(requests, err),
                  ),
                ).rejects.toThrow(err.message)
                const extDirReq = requests.find((r) => r.permission === "external_directory")
                expect(extDirReq).toBeDefined()
                expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
              },
            })
          } finally {
            if (prev === undefined) delete process.env[key]
            else process.env[key] = prev
          }
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for PowerShell env paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await bash.execute(
                {
                  command: "Get-Content $env:WINDIR/win.ini",
                  description: "Read Windows ini from env",
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for PowerShell FileSystem paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                bash.execute(
                  {
                    command: `Get-Content -Path FileSystem::${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini`,
                    description: "Read Windows ini from FileSystem provider",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `asks for external_directory permission for braced PowerShell env paths [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await expect(
                bash.execute(
                  {
                    command: "Get-Content ${env:WINDIR}/win.ini",
                    description: "Read Windows ini from braced env",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `treats Set-Location like cd for permissions [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await bash.execute(
                {
                  command: "Set-Location C:/Windows",
                  description: "Change location",
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
            },
          })
        }),
      )
    }

    for (const item of ps) {
      test(
        `does not add nested PowerShell expressions to permission prompts [${item.label}]`,
        withShell(item, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              await bash.execute(
                {
                  command: "Write-Output ('a' * 3)",
                  description: "Write repeated text",
                },
                capture(requests),
              )
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).not.toContain("a * 3")
              expect(bashReq!.always).not.toContain("a *")
            },
          })
        }),
      )
    }
  }

  each("asks for external_directory permission when cd to parent", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await expect(
          bash.execute(
            {
              command: "cd ../",
              description: "Change to parent directory",
            },
            capture(requests, err),
          ),
        ).rejects.toThrow(err.message)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  each("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await expect(
          bash.execute(
            {
              command: "echo ok",
              workdir: os.tmpdir(),
              description: "Echo from temp dir",
            },
            capture(requests, err),
          ),
        ).rejects.toThrow(err.message)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(glob(path.join(os.tmpdir(), "*")))
      },
    })
  })

  if (process.platform === "win32") {
    test("normalizes external_directory workdir variants on Windows", async () => {
      const err = new Error("stop after permission")
      await using outerTmp = await tmpdir()
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const want = Filesystem.normalizePathPattern(path.join(outerTmp.path, "*"))

          for (const dir of forms(outerTmp.path)) {
            const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
            await expect(
              bash.execute(
                {
                  command: "echo ok",
                  workdir: dir,
                  description: "Echo from external dir",
                },
                capture(requests, err),
              ),
            ).rejects.toThrow(err.message)

            const extDirReq = requests.find((r) => r.permission === "external_directory")
            expect({ dir, patterns: extDirReq?.patterns, always: extDirReq?.always }).toEqual({
              dir,
              patterns: [want],
              always: [want],
            })
          }
        },
      })
    })

    if (bash) {
      test(
        "uses Git Bash /tmp semantics for external workdir",
        withShell({ label: "bash", shell: bash }, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const want = glob(path.join(os.tmpdir(), "*"))
              await expect(
                bash.execute(
                  {
                    command: "echo ok",
                    workdir: "/tmp",
                    description: "Echo from Git Bash tmp",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]).toMatchObject({
                permission: "external_directory",
                patterns: [want],
                always: [want],
              })
            },
          })
        }),
      )

      test(
        "uses Git Bash /tmp semantics for external file paths",
        withShell({ label: "bash", shell: bash }, async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const want = glob(path.join(os.tmpdir(), "*"))
              await expect(
                bash.execute(
                  {
                    command: "cat /tmp/opencode-does-not-exist",
                    description: "Read Git Bash tmp file",
                  },
                  capture(requests, err),
                ),
              ).rejects.toThrow(err.message)
              expect(requests[0]).toMatchObject({
                permission: "external_directory",
                patterns: [want],
                always: [want],
              })
            },
          })
        }),
      )
    }
  }

  each("asks for external_directory permission when file arg is outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "outside.txt"), "x")
      },
    })
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const filepath = path.join(outerTmp.path, "outside.txt")
        await expect(
          bash.execute(
            {
              command: `cat ${filepath}`,
              description: "Read external file",
            },
            capture(requests, err),
          ),
        ).rejects.toThrow(err.message)
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        const expected = glob(path.join(outerTmp.path, "*"))
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(expected)
        expect(extDirReq!.always).toContain(expected)
      },
    })
  })

  each("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "tmpfile"), "x")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await bash.execute(
          {
            command: `rm -rf ${path.join(tmp.path, "nested")}`,
            description: "Remove nested dir",
          },
          capture(requests),
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  each("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await bash.execute(
          {
            command: "git log --oneline -5",
            description: "Git log",
          },
          capture(requests),
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
        expect(requests[0].always.some((item) => item.endsWith("*"))).toBe(true)
      },
    })
  })

  each("does not ask for bash permission when command is cd only", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await bash.execute(
          {
            command: "cd .",
            description: "Stay in current directory",
          },
          capture(requests),
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeUndefined()
      },
    })
  })

  each("matches redirects in permission pattern", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await expect(
          bash.execute(
            { command: "echo test > output.txt", description: "Redirect test output" },
            capture(requests, err),
          ),
        ).rejects.toThrow(err.message)
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.patterns).toContain("echo test > output.txt")
      },
    })
  })

  each("always pattern has space before wildcard to not include different commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        await bash.execute({ command: "ls -la", description: "List" }, capture(requests))
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeDefined()
        expect(bashReq!.always[0]).toBe("ls *")
      },
    })
  })
})

describe("tool.bash truncation", () => {
  test("truncates output exceeding line limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 500
        const result = await bash.execute(
          {
            command: fill("lines", lineCount),
            description: "Generate lines exceeding limit",
          },
          ctx,
        )
        mustTruncate(result)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("truncates output exceeding byte limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = await bash.execute(
          {
            command: fill("bytes", byteCount),
            description: "Generate bytes exceeding limit",
          },
          ctx,
        )
        mustTruncate(result)
        expect(result.output).toContain("truncated")
        expect(result.output).toContain("The tool call succeeded but the output was truncated")
      },
    })
  })

  test("does not truncate small output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          ctx,
        )
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(false)
        expect(result.output).toContain("hello")
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const lineCount = Truncate.MAX_LINES + 100
        const result = await bash.execute(
          {
            command: fill("lines", lineCount),
            description: "Generate lines for file check",
          },
          ctx,
        )
        mustTruncate(result)

        const filepath = (result.metadata as { outputPath?: string }).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Filesystem.readText(filepath!)
        const lines = saved.trim().split(/\r?\n/)
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  })
})
