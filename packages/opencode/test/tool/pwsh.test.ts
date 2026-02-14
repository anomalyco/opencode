// ┌──────────────────────────────────────────────────────────────────────┐
// │ WARNING: Do NOT add per-test tmpdir() calls here.                  │
// │                                                                    │
// │ Bun 1.3.9 on Windows segfaults during process cleanup when a      │
// │ single test file accumulates too many child_process.spawn() calls. │
// │ All tests share a single tmpdir created in beforeAll via the       │
// │ shared() helper. The pwsh tool only needs Instance.directory and   │
// │ Instance.containsPath(); it does not require git, so the shared   │
// │ tmpdir is created WITHOUT { git: true } to avoid extra spawns.    │
// │ Only create additional tmpdirs for external/outside-project paths. │
// └──────────────────────────────────────────────────────────────────────┘

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import os from "os"
import path from "path"
import { PwshTool } from "../../src/tool/pwsh"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
import { Truncate } from "../../src/tool/truncation"

// pwsh tests spawn real shell processes and load tree-sitter WASM;
// the default 5 s timeout is not enough on Windows.
setDefaultTimeout(15_000)

// Helper to access truncation metadata added by the framework at runtime
function truncationMeta(result: { metadata: Record<string, unknown> }) {
  return result.metadata as { truncated: boolean; outputPath?: string }
}

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

// Sentinel error thrown by permission-only tests to abort execution
// before spawning a real pwsh process.
class PermissionCollected extends Error {}

// Create a test context that records permission requests and throws
// PermissionCollected on the final "pwsh" ask to prevent spawning.
function permissionCtx() {
  const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
  const testCtx = {
    ...ctx,
    ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
      requests.push(req)
      if (req.permission === "pwsh") throw new PermissionCollected()
    },
  }
  return { requests, testCtx }
}

// Execute a pwsh command collecting only permission requests (no spawn).
async function executeForPermissions(
  pwshTool: Awaited<ReturnType<typeof PwshTool.init>>,
  params: { command: string; workdir?: string; description: string },
) {
  const { requests, testCtx } = permissionCtx()
  try {
    await pwshTool.execute(params, testCtx)
  } catch (e) {
    if (!(e instanceof PermissionCollected)) throw e
  }
  return requests
}

const pwsh = Bun.which("pwsh")
const run = pwsh ? describe : describe.skip

// ── Shared project directory ─────────────────────────────────────────
// All tests share one tmpdir to minimize child_process.spawn() calls.
// Bun 1.3.9 on Windows segfaults when a test file accumulates too many.
// The pwsh tool doesn't need git — it only uses Instance.directory and
// Instance.containsPath(), so we skip { git: true } entirely.
let sharedDir: Awaited<ReturnType<typeof tmpdir>> | undefined
let sharedTool: Awaited<ReturnType<typeof PwshTool.init>> | undefined

if (pwsh) {
  beforeAll(async () => {
    sharedDir = await tmpdir()
    await Instance.provide({
      directory: sharedDir.path,
      fn: async () => {
        // Also warms the tree-sitter WASM parser (~10s on Windows)
        sharedTool = await PwshTool.init()
      },
    })
  }, 30_000)

  afterAll(async () => {
    if (sharedDir) await sharedDir[Symbol.asyncDispose]()
  })
}

// Helper: run a permission-only test using the shared project directory
function shared(fn: (pwshTool: Awaited<ReturnType<typeof PwshTool.init>>, dir: string) => Promise<void>) {
  return async () => {
    await Instance.provide({
      directory: sharedDir!.path,
      fn: () => fn(sharedTool!, sharedDir!.path),
    })
  }
}

run("tool.pwsh", () => {
  test(
    "basic",
    shared(async (pwshTool) => {
      const result = await pwshTool.execute(
        {
          command: "Write-Output 'test'",
          description: "Write test message",
        },
        ctx,
      )
      expect(result.metadata.exit).toBe(0)
      expect(result.metadata.output).toContain("test")
    }),
  )
})

run("tool.pwsh permissions", () => {
  test(
    "asks for pwsh permission with correct pattern",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Write-Output hello",
        description: "Write hello",
      })
      expect(requests.length).toBe(1)
      expect(requests[0].permission).toBe("pwsh")
      expect(requests[0].patterns).toContain("Write-Output hello")
    }),
  )

  test(
    "asks for pwsh permission with multiple commands",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Write-Output foo; Write-Output bar",
        description: "Write twice",
      })
      expect(requests.length).toBe(1)
      expect(requests[0].permission).toBe("pwsh")
      expect(requests[0].patterns).toContain("Write-Output foo")
      expect(requests[0].patterns).toContain("Write-Output bar")
    }),
  )

  test(
    "asks for external_directory when Set-Location to parent",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Set-Location ../",
        description: "Change to parent directory",
      })
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeDefined()
    }),
  )

  test(
    "asks for external_directory when workdir is outside project",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Get-ChildItem",
        workdir: "/tmp",
        description: "List /tmp",
      })
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeDefined()
      expect(extDirReq!.patterns.some((p) => p.includes("tmp") && p.includes("*"))).toBe(true)
    }),
  )

  test("asks for external_directory when -Path arg is outside project", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "outside.txt"), "x")
      },
    })
    await Instance.provide({
      directory: sharedDir!.path,
      fn: async () => {
        const filepath = path.join(outerTmp.path, "outside.txt")
        const requests = await executeForPermissions(sharedTool!, {
          command: `Get-Content -Path "${filepath}"`,
          description: "Read external file",
        })
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        const expected = path.join(outerTmp.path, "*")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(expected)
        expect(extDirReq!.always).toContain(expected)
      },
    })
  })

  test(
    "does not ask for external_directory when Remove-Item inside project",
    shared(async (pwshTool, dir) => {
      await Bun.write(path.join(dir, "tmpfile"), "x")
      const requests = await executeForPermissions(pwshTool, {
        command: "Remove-Item tmpfile",
        description: "Remove tmpfile",
      })
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeUndefined()
    }),
  )

  test(
    "includes always patterns for auto-approval",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "git log --oneline -5",
        description: "Git log",
      })
      expect(requests.length).toBe(1)
      expect(requests[0].always.length).toBeGreaterThan(0)
      expect(requests[0].always.some((p) => p.endsWith("*"))).toBe(true)
    }),
  )

  test(
    "does not ask for pwsh permission when command is Set-Location only",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Set-Location .",
        description: "Stay in current directory",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeUndefined()
    }),
  )

  test(
    "matches redirections in permission pattern",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Get-ChildItem > /tmp/output.txt",
        description: "Redirect output",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
      expect(pwshReq!.patterns).toContain("Get-ChildItem > /tmp/output.txt")
    }),
  )

  test("asks external_directory for nonexistent parent-outside path", async () => {
    await using outerTmp = await tmpdir()
    await Instance.provide({
      directory: sharedDir!.path,
      fn: async () => {
        const nonexistentPath = path.join(outerTmp.path, "nonexistent", "nested", "file.txt")
        const requests = await executeForPermissions(sharedTool!, {
          command: `New-Item -Path "${nonexistentPath}" -Force`,
          description: "Create file in nonexistent path",
        })
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns.some((p) => p.includes(outerTmp.path))).toBe(true)
      },
    })
  })

  test("blocks mixed-path bypass attempts", async () => {
    if (process.platform !== "win32") return
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "target.txt"), "x")
      },
    })
    await Instance.provide({
      directory: sharedDir!.path,
      fn: async () => {
        const windowsPath = path.join(outerTmp.path, "target.txt")
        const requests1 = await executeForPermissions(sharedTool!, {
          command: `Get-Content -Path "${windowsPath}"`,
          description: "Read with Windows path",
        })
        const msysPath = windowsPath.replace(/^([A-Z]):/i, (_, drive: string) => `/${drive.toLowerCase()}`)
        const requests2 = await executeForPermissions(sharedTool!, {
          command: `Get-Content -Path "${msysPath}"`,
          description: "Read with MSYS path",
        })
        const extDir1 = requests1.find((r) => r.permission === "external_directory")
        const extDir2 = requests2.find((r) => r.permission === "external_directory")
        expect(extDir1).toBeDefined()
        expect(extDir2).toBeDefined()
      },
    })
  })

  test(
    "MSYS paths do not produce root-wide external_directory patterns",
    shared(async (pwshTool) => {
      if (process.platform !== "win32") return
      const requests = await executeForPermissions(pwshTool, {
        command: "Set-Location /c/Users",
        description: "cd via MSYS path",
      })
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      if (extDirReq) {
        for (const pattern of extDirReq.patterns) {
          const normalized = pattern.replace(/\\/g, "/")
          expect(normalized).not.toMatch(/^[A-Z]:\/\*$/)
        }
      }
    }),
  )

  test(
    "does not crash on invalid workdir",
    shared(async (pwshTool) => {
      try {
        const result = await pwshTool.execute(
          {
            command: "Write-Output test",
            workdir: "/nonexistent/path/that/definitely/does/not/exist",
            description: "Test with invalid workdir",
          },
          ctx,
        )
        expect(result).toBeDefined()
        expect(result.metadata).toBeDefined()
      } catch (error) {
        expect(error).toHaveProperty("code", "ENOENT")
      }
    }),
  )

  test(
    "parser fallback still asks permission and executes",
    shared(async (pwshTool) => {
      const staticMethodCall = "[System.Math]::Sqrt(144)"
      const requests = await executeForPermissions(pwshTool, {
        command: staticMethodCall,
        description: "Static method call",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
      expect(pwshReq!.patterns).toContain(staticMethodCall)
    }),
  )

  test("handles path parameter forms", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "test1.txt"), "x")
        await Bun.write(path.join(dir, "test2.txt"), "x")
        await Bun.write(path.join(dir, "test3.txt"), "x")
      },
    })
    await Instance.provide({
      directory: sharedDir!.path,
      fn: async () => {
        const requests1 = await executeForPermissions(sharedTool!, {
          command: `Get-Content -Path "${path.join(outerTmp.path, "test1.txt")}"`,
          description: "Test -Path value",
        })
        const requests2 = await executeForPermissions(sharedTool!, {
          command: `Get-Content -Path:"${path.join(outerTmp.path, "test2.txt")}"`,
          description: "Test -Path:value",
        })
        const requests3 = await executeForPermissions(sharedTool!, {
          command: `Get-Content -LiteralPath "${path.join(outerTmp.path, "test3.txt")}"`,
          description: "Test -LiteralPath",
        })
        expect(requests1.find((r) => r.permission === "external_directory")).toBeDefined()
        expect(requests2.find((r) => r.permission === "external_directory")).toBeDefined()
        expect(requests3.find((r) => r.permission === "external_directory")).toBeDefined()
      },
    })
  })

  test(
    "unresolved variable path remains safe",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: 'Get-Content -Path "$env:TEMP/test.txt"',
        description: "Read from env var path",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
    }),
  )

  test(
    "~ path triggers external_directory",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Get-ChildItem ~",
        description: "List home directory",
      })
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeDefined()
      expect(extDirReq!.patterns.some((p) => p.includes(os.homedir()))).toBe(true)
    }),
  )

  test(
    "Set-Location ~ triggers external_directory",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Set-Location ~",
        description: "cd to home",
      })
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeDefined()
    }),
  )

  test("expanded cmdlets trigger external_directory for outside paths", async () => {
    await using outerTmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "target.txt"), "x")
      },
    })
    await Instance.provide({
      directory: sharedDir!.path,
      fn: async () => {
        const filepath = path.join(outerTmp.path, "target.txt")
        const requests = await executeForPermissions(sharedTool!, {
          command: `Add-Content -Path "${filepath}" -Value "test"`,
          description: "Append to external file",
        })
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns.some((p) => p.includes(outerTmp.path))).toBe(true)
      },
    })
  })
})

run("tool.pwsh truncation", () => {
  test(
    "truncates output exceeding line limit",
    shared(async (pwshTool) => {
      const lineCount = Truncate.MAX_LINES + 500
      const result = await pwshTool.execute(
        {
          command: `1..${lineCount} | ForEach-Object { Write-Output $_ }`,
          description: "Generate lines exceeding limit",
        },
        ctx,
      )
      expect(truncationMeta(result).truncated).toBe(true)
      expect(result.output).toContain("truncated")
      expect(result.output).toContain("The tool call succeeded but the output was truncated")
    }),
  )

  test(
    "truncates output exceeding byte limit",
    shared(async (pwshTool) => {
      const byteCount = Truncate.MAX_BYTES + 10000
      const result = await pwshTool.execute(
        {
          command: `Write-Output ('a' * ${byteCount})`,
          description: "Generate bytes exceeding limit",
        },
        ctx,
      )
      expect(truncationMeta(result).truncated).toBe(true)
      expect(result.output).toContain("truncated")
      expect(result.output).toContain("The tool call succeeded but the output was truncated")
    }),
  )

  test(
    "does not truncate small output",
    shared(async (pwshTool) => {
      const result = await pwshTool.execute(
        {
          command: "Write-Output hello",
          description: "Write hello",
        },
        ctx,
      )
      expect(truncationMeta(result).truncated).toBe(false)
      expect(result.output).toContain("hello")
    }),
  )

  test(
    "full output saved to file when truncated",
    shared(async (pwshTool) => {
      const lineCount = Truncate.MAX_LINES + 100
      const result = await pwshTool.execute(
        {
          command: `1..${lineCount} | ForEach-Object { Write-Output $_ }`,
          description: "Generate lines for file check",
        },
        ctx,
      )
      expect(truncationMeta(result).truncated).toBe(true)

      const filepath = truncationMeta(result).outputPath
      expect(filepath).toBeTruthy()

      const saved = await Bun.file(filepath!).text()
      const lines = saved.trim().split(/\r?\n/)
      expect(lines.length).toBe(lineCount)
      expect(lines[0].trim()).toBe("1")
      expect(lines[lineCount - 1].trim()).toBe(String(lineCount))
    }),
  )
})

run("tool.pwsh security", () => {
  test(
    "blocks PowerShell provider path (Cert:\\)",
    shared(async (pwshTool) => {
      if (process.platform !== "win32") return // Provider paths are Windows-specific
      const requests = await executeForPermissions(pwshTool, {
        command: "Get-ChildItem Cert:\\CurrentUser",
        description: "List certificates",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
      // Provider path should NOT trigger external_directory (it's not a filesystem path)
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeUndefined()
    }),
  )

  test(
    "blocks PowerShell provider path (HKCU:\\)",
    shared(async (pwshTool) => {
      if (process.platform !== "win32") return // Provider paths are Windows-specific
      const requests = await executeForPermissions(pwshTool, {
        command: "Get-Item HKCU:\\Software",
        description: "Access registry",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
      // Provider path should NOT trigger external_directory
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeUndefined()
    }),
  )

  test(
    "blocks $HOME path expansion bypass",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Test-Path $HOME",
        description: "Test home directory path",
      })
      // Should trigger external_directory for home directory access
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeDefined()
      expect(extDirReq!.patterns.some((p) => p.includes(os.homedir()))).toBe(true)
    }),
  )

  test(
    "blocks ~ path traversal bypass",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Get-Content ~/../../tmp",
        description: "Attempt traversal via tilde",
      })
      // Should trigger external_directory
      const extDirReq = requests.find((r) => r.permission === "external_directory")
      expect(extDirReq).toBeDefined()
      // Pattern should NOT be root-wide (like C:\\* on Windows)
      if (process.platform === "win32") {
        const hasRootWildcard = extDirReq!.patterns.some((p) => /^[A-Z]:\\?\*$/i.test(p))
        expect(hasRootWildcard).toBe(false)
      }
    }),
  )

  test(
    "dangerous cmdlets not auto-approved",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Invoke-Expression 'Write-Output test'",
        description: "Test dangerous cmdlet",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
      // Should have pattern but NO auto-approval (empty always array)
      expect(pwshReq!.patterns.length).toBeGreaterThan(0)
      expect(pwshReq!.always.length).toBe(0)
    }),
  )

  test(
    "dangerous cmdlet aliases not auto-approved (iex)",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "iex 'Get-ChildItem'",
        description: "Test dangerous alias",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
      // Should NOT have auto-approval
      expect(pwshReq!.always.length).toBe(0)
    }),
  )

  test(
    "network cmdlets not auto-approved (Invoke-WebRequest)",
    shared(async (pwshTool) => {
      const requests = await executeForPermissions(pwshTool, {
        command: "Invoke-WebRequest https://example.com",
        description: "Test network cmdlet",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
      // Should NOT have auto-approval
      expect(pwshReq!.always.length).toBe(0)
    }),
  )

  test(
    "registry cmdlets not auto-approved (Get-ItemProperty)",
    shared(async (pwshTool) => {
      if (process.platform !== "win32") return // Registry is Windows-specific
      const requests = await executeForPermissions(pwshTool, {
        command: "Get-ItemProperty HKCU:\\Software\\Test",
        description: "Test registry cmdlet",
      })
      const pwshReq = requests.find((r) => r.permission === "pwsh")
      expect(pwshReq).toBeDefined()
      // Should NOT have auto-approval
      expect(pwshReq!.always.length).toBe(0)
    }),
  )
})
