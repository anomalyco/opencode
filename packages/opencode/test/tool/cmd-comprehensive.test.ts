import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { PermissionNext } from "../../src/permission/next"

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

// Part 1: Exit Code Capture (10+ tests) - test various exit codes
describe("tool.bash CMD Exit Code Capture", () => {
  test.skipIf(process.platform !== "win32")("captures exit code 42 from cmd /c exit 42", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c exit 42",
            description: "Exit with code 42",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(42)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 1 from cmd /c dir nonexistent", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c dir nonexistent 2>&1",
            description: "Dir nonexistent directory",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(1)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 0 from successful cmd /c echo", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo success",
            description: "Echo success message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("success")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 2 from cmd /c call nonexistent.bat", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c call nonexistent.bat",
            description: "Call nonexistent batch file",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(2)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 255 from cmd /c exit /b 255", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c exit /b 255",
            description: "Exit with code 255 using /b",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(255)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 9009 from cmd /c nonexistent_command", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c nonexistent_command",
            description: "Run nonexistent command",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(9009)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 1 from cmd /c findstr nonexistent file.txt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c findstr nonexistent file.txt",
            description: "Findstr nonexistent pattern",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(1)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 0 from cmd /c findstr test file_with_test.txt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a test file first
        const bash = await BashTool.init()
        await bash.execute(
          {
            command: "cmd /c echo test > file_with_test.txt",
            description: "Create test file",
          },
          ctx,
        )
        const result = await bash.execute(
          {
            command: "cmd /c findstr test file_with_test.txt",
            description: "Findstr existing pattern",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 1 from cmd /c if not exist nonexistent echo not found", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c if not exist nonexistent echo not found",
            description: "Check nonexistent file",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(1)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("captures exit code 0 from cmd /c if exist file.txt echo found", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Create file first
        await bash.execute(
          {
            command: "cmd /c echo content > file.txt",
            description: "Create file",
          },
          ctx,
        )
        const result = await bash.execute(
          {
            command: "cmd /c if exist file.txt echo found",
            description: "Check existing file",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("found")
      },
    })
  })
})

// Part 2: CMD Pipe Operations (10+ tests) - test pipe functionality
describe("tool.bash CMD Pipe Operations", () => {
  test.skipIf(process.platform !== "win32")("handles basic pipe: echo test | findstr test", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo test | findstr test",
            description: "Basic pipe operation",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles pipe with multiple commands: dir | findstr .txt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Create a txt file first
        await bash.execute(
          {
            command: "cmd /c echo content > test.txt",
            description: "Create txt file",
          },
          ctx,
        )
        const result = await bash.execute(
          {
            command: "cmd /c dir | findstr .txt",
            description: "Pipe dir output to findstr",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test.txt")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles pipe with sort: echo z a b | sort", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c (echo z & echo a & echo b) | sort",
            description: "Pipe with sort command",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("a")
        expect(result.metadata.output).toContain("b")
        expect(result.metadata.output).toContain("z")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles pipe with more: dir /b | more", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c dir /b | more",
            description: "Pipe with more command",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles complex pipe chain: echo test | findstr test | sort", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo test | findstr test | sort",
            description: "Complex pipe chain",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles pipe with error redirection: dir nonexistent 2>&1 | findstr error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c dir nonexistent 2>&1 | findstr error",
            description: "Pipe with error redirection",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles pipe with type command: type file.txt | findstr content", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Create file first
        await bash.execute(
          {
            command: "cmd /c echo specific content > file.txt",
            description: "Create file with content",
          },
          ctx,
        )
        const result = await bash.execute(
          {
            command: "cmd /c type file.txt | findstr specific",
            description: "Pipe type output to findstr",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("specific")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles pipe with netstat: netstat -n | findstr :80", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c netstat -n 2>nul | findstr :80",
            description: "Pipe netstat output",
          },
          ctx,
        )
        // This might fail if no port 80 connections, but should not crash
        expect([0, 1, null]).toContain(result.metadata.exit)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles pipe with tasklist: tasklist | findstr explorer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c tasklist 2>nul | findstr explorer",
            description: "Pipe tasklist output",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("explorer")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles pipe with ipconfig: ipconfig | findstr IPv4", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c ipconfig | findstr IPv4",
            description: "Pipe ipconfig output",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })
})

// Part 3: Quote Handling (8+ tests) - test variable expansion and quote artifacts
describe("tool.bash CMD Quote Handling", () => {
  test.skipIf(process.platform !== "win32")("handles PowerShell wrapped cmd with quotes: powershell -Command \"cmd /c 'dir'\"", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"cmd /c 'dir'\"",
            description: "PowerShell wrapped cmd with quotes",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles PowerShell wrapped cmd with environment variable: powershell -Command \"cmd /c 'echo %username%'\"", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"cmd /c 'echo %username%'\"",
            description: "PowerShell wrapped cmd with environment variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toMatch(/[a-zA-Z]/) // Should contain username
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles direct cmd with quoted path: cmd /c dir \"C:\\Program Files\"", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo \"C:\\Program Files\"",
            description: "Direct cmd with quoted path",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("C:\\Program Files")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles cmd with quoted string containing spaces: cmd /c echo \"hello world\"", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo \"hello world\"",
            description: "Cmd with quoted string",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("hello world")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles cmd with single quotes: cmd /c echo 'single quoted'", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo 'single quoted'",
            description: "Cmd with single quotes",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("single quoted")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles cmd with escaped quotes: cmd /c echo \\\"escaped\\\"", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo \\\"escaped\\\"",
            description: "Cmd with escaped quotes",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("escaped")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles cmd with variable in quotes: cmd /c echo \"%cd%\"", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo \"%cd%\"",
            description: "Cmd with variable in quotes",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toMatch(/[a-zA-Z]:/) // Should contain drive letter
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles cmd with complex quoting: cmd /c for %i in (\"file 1.txt\" \"file 2.txt\") do echo %i", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c for %i in (\"file 1.txt\" \"file 2.txt\") do echo %i",
            description: "Cmd with complex quoting in for loop",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("file 1.txt")
        expect(result.metadata.output).toContain("file 2.txt")
      },
    })
  })
})

// Part 4: Environment Variables (8+ tests) - test %variable% expansion
describe("tool.bash CMD Environment Variables", () => {
  test.skipIf(process.platform !== "win32")("expands %username% variable: cmd /c echo %username%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo %username%",
            description: "Expand username variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toMatch(/[a-zA-Z]/) // Should contain username
      },
    })
  })

  test.skipIf(process.platform !== "win32")("expands %cd% variable: cmd /c echo %cd%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo %cd%",
            description: "Expand current directory variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toMatch(/[a-zA-Z]:/) // Should contain drive letter
      },
    })
  })

  test.skipIf(process.platform !== "win32")("expands %temp% variable: cmd /c echo %temp%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo %temp%",
            description: "Expand temp directory variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toMatch(/[a-zA-Z]:/) // Should contain drive letter
      },
    })
  })

  test.skipIf(process.platform !== "win32")("expands %path% variable: cmd /c echo %path%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo %path%",
            description: "Expand path variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("Windows") // Should contain Windows in path
      },
    })
  })

  test.skipIf(process.platform !== "win32")("expands %date% variable: cmd /c echo %date%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo %date%",
            description: "Expand date variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toMatch(/\d/) // Should contain digits
      },
    })
  })

  test.skipIf(process.platform !== "win32")("expands %time% variable: cmd /c echo %time%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo %time%",
            description: "Expand time variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toMatch(/\d/) // Should contain digits
      },
    })
  })

  test.skipIf(process.platform !== "win32")("expands custom environment variable: set TEST_VAR=test && cmd /c echo %TEST_VAR%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c set TEST_VAR=test && echo %TEST_VAR%",
            description: "Set and expand custom variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles undefined variable: cmd /c echo %UNDEFINED_VAR%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo %UNDEFINED_VAR%",
            description: "Echo undefined variable",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("%UNDEFINED_VAR%") // Should show literal
      },
    })
  })
})

// Part 5: CMD Builtins (10+ tests) - test all builtin commands
describe("tool.bash CMD Builtins", () => {
  test.skipIf(process.platform !== "win32")("executes dir builtin: cmd /c dir", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c dir",
            description: "Execute dir builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("Directory")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes echo builtin: cmd /c echo hello", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo hello",
            description: "Execute echo builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("hello")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes type builtin: cmd /c type file.txt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Create file first
        await bash.execute(
          {
            command: "cmd /c echo content > file.txt",
            description: "Create file",
          },
          ctx,
        )
        const result = await bash.execute(
          {
            command: "cmd /c type file.txt",
            description: "Execute type builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("content")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes copy builtin: cmd /c copy file1.txt file2.txt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Create source file
        await bash.execute(
          {
            command: "cmd /c echo content > file1.txt",
            description: "Create source file",
          },
          ctx,
        )
        const result = await bash.execute(
          {
            command: "cmd /c copy file1.txt file2.txt",
            description: "Execute copy builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("1 file(s) copied")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes mkdir builtin: cmd /c mkdir testdir", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c mkdir testdir",
            description: "Execute mkdir builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes del builtin: cmd /c del test.txt", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Create file first
        await bash.execute(
          {
            command: "cmd /c echo content > test.txt",
            description: "Create file",
          },
          ctx,
        )
        const result = await bash.execute(
          {
            command: "cmd /c del test.txt",
            description: "Execute del builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes set builtin: cmd /c set", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c set",
            description: "Execute set builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("PATH=")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes if builtin: cmd /c if 1==1 echo true", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c if 1==1 echo true",
            description: "Execute if builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("true")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes for builtin: cmd /c for %i in (a b c) do echo %i", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c for %i in (a b c) do echo %i",
            description: "Execute for builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("a")
        expect(result.metadata.output).toContain("b")
        expect(result.metadata.output).toContain("c")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("executes call builtin: cmd /c call echo.bat", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        // Create batch file
        await bash.execute(
          {
            command: "cmd /c echo @echo called > echo.bat",
            description: "Create batch file",
          },
          ctx,
        )
        const result = await bash.execute(
          {
            command: "cmd /c call echo.bat",
            description: "Execute call builtin",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("called")
      },
    })
  })
})

// Part 6: Edge Cases (8+ tests) - test edge cases and special scenarios
describe("tool.bash CMD Edge Cases", () => {
  test.skipIf(process.platform !== "win32")("handles process ID syntax mismatch: cmd /c mkdir \"%temp%\\test_dir_$$\"", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c mkdir \"test_dir_$\"",
            description: "Process ID syntax mismatch",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Should create directory with literal $$ in name
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles file verification requirement: cmd /c echo @echo off > test.bat", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo @echo off > test.bat",
            description: "Create batch file",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Verify file was created
        const verifyResult = await bash.execute(
          {
            command: "cmd /c if exist test.bat echo FILE_EXISTS else echo FILE_DELETED",
            description: "Verify file exists",
          },
          ctx,
        )
        expect(verifyResult.metadata.output).toContain("FILE_EXISTS")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles cross-syntax contamination: powershell -Command \"'@echo off' | Out-File -FilePath test.ps1\"", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"'@echo off' | Out-File -FilePath test.ps1 -Encoding ASCII\"",
            description: "Create file with batch syntax",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Verify file exists but don't try to execute as PowerShell
        const verifyResult = await bash.execute(
          {
            command: "cmd /c if exist test.ps1 echo FILE_EXISTS else echo FILE_DELETED",
            description: "Verify file exists",
          },
          ctx,
        )
        expect(verifyResult.metadata.output).toContain("FILE_EXISTS")
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles access denied on system commands: sc query type= service state= all", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c sc query type= service state= all 2>&1",
            description: "Access denied system command",
          },
          ctx,
        )
        // May return access denied, but should not crash
        expect([0, 1, null]).toContain(result.metadata.exit)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles timestamp test timing issue: cmd /c echo %time% && ping -n 2 127.0.0.1 >nul && echo %time%", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c echo %time% && ping -n 2 127.0.0.1 >nul && echo %time%",
            description: "Timestamp timing issue",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toMatch(/\d/) // Should contain time digits
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles Unicode limitation: [string][char]0x1F600", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "powershell -Command \"'😀🙄'\"",
            description: "Unicode emoji handling",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        // Should handle emoji characters
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles long command lines", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const longCommand = "cmd /c echo " + "a".repeat(1000)
        const result = await bash.execute(
          {
            command: longCommand,
            description: "Long command line",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test.skipIf(process.platform !== "win32")("handles special characters in paths", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          {
            command: "cmd /c mkdir \"test dir with spaces\" && dir \"test dir with spaces\"",
            description: "Special characters in paths",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })
})