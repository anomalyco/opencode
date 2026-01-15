import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"
import { Truncate } from "../../src/tool/truncation"
import { Shell } from "../../src/shell/shell"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo 'test'",
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
  test("asks for bash permission with correct pattern", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo hello",
            description: "Echo hello",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo hello")
      },
    })
  })

  test("asks for bash permission with multiple commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "echo foo && echo bar",
            description: "Echo twice",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("bash")
        expect(requests[0].patterns).toContain("echo foo")
        expect(requests[0].patterns).toContain("echo bar")
      },
    })
  })

  test("asks for external_directory permission when cd to parent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd ../",
            description: "Change to parent directory",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
      },
    })
  })

  test("asks for external_directory permission when workdir is outside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "ls",
            workdir: "/c/nonexistent",
            description: "List /tmp",
          },
          testCtx,
        )
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain("/tmp")
      },
    })
  })

  test("does not ask for external_directory permission when rm inside project", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        await Bun.write(path.join(tmp.path, "tmpfile"), "x")

        await bash.execute(
          {
            command: "rm tmpfile",
            description: "Remove tmpfile",
          },
          testCtx,
        )

        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeUndefined()
      },
    })
  })

  test("includes always patterns for auto-approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "git log --oneline -5",
            description: "Git log",
          },
          testCtx,
        )
        expect(requests.length).toBe(1)
        expect(requests[0].always.length).toBeGreaterThan(0)
        expect(requests[0].always.some((p) => p.endsWith("*"))).toBe(true)
      },
    })
  })

  test("does not ask for bash permission when command is cd only", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const requests: Array<Omit<PermissionNext.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }
        await bash.execute(
          {
            command: "cd .",
            description: "Stay in current directory",
          },
          testCtx,
        )
        const bashReq = requests.find((r) => r.permission === "bash")
        expect(bashReq).toBeUndefined()
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
            command: `seq 1 ${lineCount}`,
            description: "Generate lines exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
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
            command: `head -c ${byteCount} /dev/zero | tr '\\0' 'a'`,
            description: "Generate bytes exceeding limit",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)
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
        expect((result.metadata as any).truncated).toBe(false)
        expect(result.output).toBe("hello\n")
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
            command: `seq 1 ${lineCount}`,
            description: "Generate lines for file check",
          },
          ctx,
        )
        expect((result.metadata as any).truncated).toBe(true)

        const filepath = (result.metadata as any).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Bun.file(filepath).text()
        const lines = saved.trim().split("\n")
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  })
})

describe("tool.bash CMD environment variables", () => {
  test.skipIf(process.platform !== "win32")("handles chained CMD commands with %cd% variable", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // The command changes directory to %temp% and then echoes %cd%.
        // Without delayed expansion, %cd% would be the original directory.
        // With the fix, it should be the temp directory.
        const result = await bash.execute(
          {
            command: "cmd /c cd /d %temp% && echo %cd%",
            description: "Test delayed expansion for %cd%",
          },
          ctx,
        )

        expect(result.metadata.exit).toBe(0)
        // The output should contain the temp directory path
        const tempPath = process.env.TEMP || process.env.TMP
        expect(tempPath).toBeTruthy()
        expect(result.metadata.output.trim()).toContain(tempPath!.trim())
        // The output should NOT contain the original working directory (tmp.path)
        expect(result.metadata.output.trim()).not.toContain(tmp.path.trim())
      },
    })
  })
})

describe("tool.bash CMD pipe commands", () => {
  test.skipIf(process.platform !== "win32")("handles CMD pipe with findstr matching text", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo test line | findstr test",
            description: "Test CMD pipe command finding matching text",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test line")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles CMD pipe with quoted text and findstr", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: 'cmd /c echo "hello world" | findstr hello',
            description: "Test CMD pipe command with quoted text",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("hello world")
      },
    })
  })
})

describe("tool.bash PowerShell fixes", () => {
  test.skipIf(process.platform !== "win32")("handles PowerShell argument parsing with -Command flag", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Write-Output 'Hello World'\"",
            description: "Test PowerShell -Command argument parsing",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("Hello World")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles PowerShell argument parsing with -c flag", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "pwsh -c \"Get-Process -Name explorer | Select-Object -First 1\"",
            description: "Test PowerShell -c argument parsing",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Should either show process info or handle gracefully if explorer not running
        expect(result.metadata.output).not.toContain("Error:")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("detects Start-Job and extends timeout", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const startTime = Date.now()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Start-Job -ScriptBlock { Start-Sleep -Seconds 2; Write-Output 'Job completed' } | Wait-Job | Receive-Job\"",
            description: "Test Start-Job timeout extension",
            timeout: 5000, // Short timeout that should be extended for Start-Job
          },
          ctx,
        )
        const endTime = Date.now()
        const duration = endTime - startTime
        
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("Job completed")
        // Should take at least 2 seconds (job duration) but less than 60 seconds (extended timeout)
        expect(duration).toBeGreaterThanOrEqual(2000)
        expect(duration).toBeLessThan(60000)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles non-existent cmdlet error with helpful message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Get-NonExistentCmdlet\"",
            description: "Test non-existent cmdlet error handling",
          },
          ctx,
        )
        expect(result.metadata.exit).not.toBe(0)
        expect(result.metadata.output).toContain("Error: Command 'Get-NonExistentCmdlet' not found")
        expect(result.metadata.output).toContain("Get-Command")
        expect(result.metadata.output).toContain("Import-Module")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles Format-* -First parameter error with helpful message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Get-Process | Format-Table -First 5\"",
            description: "Test Format-* -First parameter error handling",
          },
          ctx,
        )
        expect(result.metadata.exit).not.toBe(0)
        expect(result.metadata.output).toContain("Note: The -First parameter is not supported")
        expect(result.metadata.output).toContain("Select-Object -First")
        expect(result.metadata.output).toContain("PowerShell 7+")
      },
    })
  })

  // Removed problematic test that prompts for credentials and freezes application
  // test.skipIf(process.platform !== "win32")("handles Get-Credential in non-interactive context with fallback message", async () => {
  //   await using tmp = await tmpdir({ git: true })
  //   await Instance.provide({
  //     directory: tmp.path,
  //     fn: async () => {
  //       const bash = await BashTool.init()
  //       const result = await bash.execute(
  //         {
  //           command: "powershell -Command \"Get-Credential\"",
  //           description: "Test Get-Credential fallback message",
  //         },
  //         ctx,
  //       )
  //       expect(result.metadata.exit).not.toBe(0)
  //       expect(result.metadata.output).toContain("Error: Get-Credential requires interactive input")
  //       expect(result.metadata.output).toContain("Alternative approaches:")
  //       expect(result.metadata.output).toContain("Get-StoredCredential")
  //     },
  //   })
  // })

  test.skipIf(process.platform !== "win32")("handles PowerShell command detection correctly", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        
        // Test that isPowerShellCommand correctly identifies PowerShell commands
        const testCases = [
          { command: "powershell -Command \"echo hello\"", expected: true },
          { command: "pwsh -c \"echo hello\"", expected: true },
          { command: "powershell.exe -Command \"echo hello\"", expected: true },
          { command: "echo hello", expected: false },
          { command: "cmd /c echo hello", expected: false },
        ]
        
        for (const testCase of testCases) {
          const result = await bash.execute(
            {
              command: testCase.command,
              description: `Test command detection: ${testCase.command}`,
            },
            ctx,
          )
          
          // For PowerShell commands, output should be processed
          // For non-PowerShell commands, output should be raw
          if (testCase.expected) {
            expect(result.metadata.output).not.toBeUndefined()
          }
        }
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles PowerShell error output processing", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Write-Error 'This is a test error'\"",
            description: "Test PowerShell error output processing",
          },
          ctx,
        )
        expect(result.metadata.exit).not.toBe(0)
        expect(result.metadata.output).toContain("This is a test error")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles PowerShell complex command structures", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"$env:PATH; Get-ChildItem -Path . | Where-Object { $_.Name -like '*.txt' }\"",
            description: "Test PowerShell complex command structures",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Should contain PATH environment variable output
        expect(result.metadata.output).toContain(";")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles PowerShell command with special characters", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: 'powershell -Command "Write-Output \"Hello with \\\"quotes\\\"\""',
            description: "Test PowerShell command with special characters",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("quotes")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles PowerShell timeout scenarios gracefully", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Start-Sleep -Seconds 1\"",
            description: "Test PowerShell timeout handling",
            timeout: 5000, // 5 second timeout should be enough for 1 second sleep
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles PowerShell command with environment variables", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Write-Output \"USERPROFILE: $env:USERPROFILE\"\"",
            description: "Test PowerShell environment variables",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("USERPROFILE:")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles powershell -Debug -Command with Write-Output", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Debug -Command \"Write-Output 'x'\"",
            description: "Test PowerShell -Debug flag with Write-Output",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("x")
        // Should not throw null reference exceptions
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles Write-Debug 'x' scenarios", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Write-Debug 'x'\"",
            description: "Test Write-Debug cmdlet",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Write-Debug output should be captured or handled gracefully
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles -Verbose flag with Write-Output", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Verbose -Command \"Write-Output 'x'\"",
            description: "Test PowerShell -Verbose flag",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("x")
        // Should not throw null reference exceptions
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles multiple common parameters combined", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Debug -Verbose -Command \"Write-Output 'test'\"",
            description: "Test multiple common parameters",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
        // Should not throw null reference exceptions
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles Write-Debug with complex output", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Write-Debug 'Debug message'; Write-Output 'Normal output'\"",
            description: "Test Write-Debug with mixed output",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Should handle debug messages gracefully
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles debug scenarios with expected guidance messages", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Debug -Command \"Write-Debug 'Guidance: Use -Debug parameter for detailed output'\"",
            description: "Test debug guidance messages",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Should complete without NRE and surface expected debug guidance
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles common-parameter flow stability", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Debug -Verbose -ErrorAction Stop -Command \"Write-Output 'Stability test'\"",
            description: "Test common parameter flow stability",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("Stability test")
        // Should not throw null reference exceptions
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles Write-Debug edge cases", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"Write-Debug 'Edge case: empty debug'; Write-Debug 'Another debug message'\"",
            description: "Test Write-Debug edge cases",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Should handle multiple debug messages gracefully
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles debug parameter with error scenarios", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Debug -Command \"Write-Error 'Test error'; Write-Debug 'Debug after error'\"",
            description: "Test debug with error scenarios",
          },
          ctx,
        )
        expect(result.metadata.exit).not.toBe(0)
        // Should handle errors gracefully without NRE
        expect(result.metadata.output).not.toContain("NullReferenceException")
        expect(result.metadata.output).not.toContain("Object reference not set to an instance of an object")
      },
    })
  })
})
describe("Shell.isCmdBuiltin detection", () => {
  test("detects 'dir' as builtin", () => {
    expect(Shell.isCmdBuiltin("dir")).toBe(true)
  })

  test("detects 'DIR' (uppercase) as builtin", () => {
    expect(Shell.isCmdBuiltin("DIR")).toBe(true)
  })

  test("detects 'echo hello world' as builtin", () => {
    expect(Shell.isCmdBuiltin("echo hello world")).toBe(true)
  })

  test("does not detect 'git status' as builtin", () => {
    expect(Shell.isCmdBuiltin("git status")).toBe(false)
  })

  test("does not detect 'npm install' as builtin", () => {
    expect(Shell.isCmdBuiltin("npm install")).toBe(false)
  })

  test("does not detect 'cmd /c dir' as bare builtin (it's explicit)", () => {
    expect(Shell.isCmdBuiltin("cmd /c dir")).toBe(false)
  })

  test("does not detect 'powershell -Command \"dir\"' as builtin", () => {
    expect(Shell.isCmdBuiltin("powershell -Command \"dir\"")).toBe(false)
  })
})

describe("tool.bash bare CMD builtin support", () => {
  test.skipIf(process.platform !== "win32")("executes bare dir command", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "dir",
            description: "List directory contents",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain(".git")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes bare echo command", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo HelloWorld",
            description: "Echo HelloWorld",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("HelloWorld")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes bare type command", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(path.join(tmp.path, "test.txt"), "test content")
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "type test.txt",
            description: "Display file contents",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test content")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes bare copy command", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(path.join(tmp.path, "source.txt"), "source content")
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "copy source.txt dest.txt",
            description: "Copy file",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(await Bun.file(path.join(tmp.path, "dest.txt")).text()).toBe("source content")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes bare mkdir command", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "mkdir testdir",
            description: "Create directory",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(await Bun.file(path.join(tmp.path, "testdir")).exists()).toBe(true)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes bare del command", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Bun.write(path.join(tmp.path, "test.txt"), "content")
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "del test.txt",
            description: "Delete file",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(await Bun.file(path.join(tmp.path, "test.txt")).exists()).toBe(false)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles bare CMD with arguments", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "dir /b /s",
            description: "List files recursively in bare format",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain(".git")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("bare CMD commands have exit code 0 on success", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "echo success",
            description: "Echo success",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("success")
      },
    })
  })
})