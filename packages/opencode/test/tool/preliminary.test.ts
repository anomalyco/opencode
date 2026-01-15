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

describe("tool.bash preliminary test suite", () => {
  describe("Part 1: Basic Shell Execution", () => {
    describe("1.1 Simple PowerShell Commands", () => {
      test("command 1: powershell -NoProfile -Command \"Write-Host 'Test123'\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -NoProfile -Command \"Write-Host 'Test123'\"",
                description: "Write-Host Test123",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toContain("Test123")
          },
        })
      })

      test("command 2: powershell -Command \"Get-Date -Format 'MM/dd/yyyy'\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"Get-Date -Format 'MM/dd/yyyy'\"",
                description: "Get current date",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/) // Basic date pattern
          },
        })
      })

      test("command 3: powershell -Command \"1 + 1\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"1 + 1\"",
                description: "Simple arithmetic",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim()).toBe("2")
          },
        })
      })

      test("command 4: powershell -Command \"Write-Host 'Hello World'\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"Write-Host 'Hello World'\"",
                description: "Write-Host Hello World",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toContain("Hello World")
          },
        })
      })

      test("command 5: powershell -Command \"Get-Random\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"Get-Random\"",
                description: "Get random number",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            const output = parseInt(result.metadata.output.trim())
            expect(output).toBeGreaterThanOrEqual(0)
            expect(output).toBeLessThanOrEqual(2147483647) // Max int32
          },
        })
      })
    })

    describe("1.2 Simple CMD Commands", () => {
      test("command 6: cmd /c echo HelloWorld", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c echo HelloWorld",
                description: "Echo HelloWorld",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toContain("HelloWorld")
          },
        })
      })

      test("command 7: cmd /c dir", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c dir",
                description: "List directory contents",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toMatch(/\d{2}\/\d{2}\/\d{4}/) // Directory listing format
          },
        })
      })

      test("command 8: cmd /c echo %username%", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c echo %username%",
                description: "Echo username",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim().length).toBeGreaterThan(0)
          },
        })
      })

      test("command 9: cmd /c echo %userprofile%", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c echo %userprofile%",
                description: "Echo user profile path",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim()).toMatch(/[A-Za-z]:\\Users\\/)
          },
        })
      })

      test("command 10: cmd /c ver", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c ver",
                description: "Show Windows version",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toContain("Microsoft Windows")
          },
        })
      })
    })

    describe("1.3 Command Chaining and Piping", () => {
      test("command 11: powershell -Command \"Write-Host a; Write-Host b\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"Write-Host a; Write-Host b\"",
                description: "Multiple Write-Host commands",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toContain("a")
            expect(result.metadata.output).toContain("b")
          },
        })
      })

      test("command 12: powershell -Command \"Get-Process | Select-Object -First 2\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"Get-Process | Select-Object -First 2\"",
                description: "Get first 2 processes",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
            expect(lines.length).toBeGreaterThanOrEqual(2)
          },
        })
      })

      test("command 13: cmd /c echo one & echo two", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c echo one & echo two",
                description: "Echo two commands with &",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toContain("one")
            expect(result.metadata.output).toContain("two")
          },
        })
      })

      test("command 14: cmd /c echo first && echo second", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c echo first && echo second",
                description: "Echo two commands with &&",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toContain("first")
            expect(result.metadata.output).toContain("second")
          },
        })
      })

      test("command 15: powershell -Command \"1,2,3,4,5 | Where-Object { $_ -gt 2 }\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"1,2,3,4,5 | Where-Object { $_ -gt 2 }\"",
                description: "Filter numbers greater than 2",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            const output = result.metadata.output.trim()
            expect(output).toContain("3")
            expect(output).toContain("4")
            expect(output).toContain("5")
            expect(output).not.toContain("1")
            expect(output).not.toContain("2")
          },
        })
      })
    })
  })

  describe("Part 2: PowerShell Script Block Execution", () => {
    test("command 16: powershell -Command \"& { Write-Host 'Inside block' }\"", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "powershell -Command \"& { Write-Host 'Inside block' }\"",
              description: "Execute script block",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output).toContain("Inside block")
        },
      })
    })

    test("command 17: powershell -Command \"if (1 -eq 1) { Write-Host 'True' }\"", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "powershell -Command \"if (1 -eq 1) { Write-Host 'True' }\"",
              description: "Simple if statement",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output).toContain("True")
        },
      })
    })

    test("command 18: powershell -Command \"$x = 5; $x * 2\"", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "powershell -Command \"$x = 5; $x * 2\"",
              description: "Variable assignment and multiplication",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output.trim()).toBe("10")
        },
      })
    })

    test("command 19: powershell -Command \"& { $sum = 0; 1..10 | ForEach-Object { $sum += $_ }; Write-Host $sum }\"", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "powershell -Command \"& { $sum = 0; 1..10 | ForEach-Object { $sum += $_ }; Write-Host $sum }\"",
              description: "Sum numbers 1 through 10",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output.trim()).toBe("55")
        },
      })
    })

    test("command 20: powershell -Command \"foreach ($i in 1,2,3) { Write-Host $i }\"", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "powershell -Command \"foreach ($i in 1,2,3) { Write-Host $i }\"",
              description: "Foreach loop",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output).toContain("1")
          expect(result.metadata.output).toContain("2")
          expect(result.metadata.output).toContain("3")
        },
      })
    })

    test("command 21: powershell -Command \"& { $arr = @('a','b','c'); $arr -join ',' }\"", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "powershell -Command \"& { $arr = @('a','b','c'); $arr -join ',' }\"",
              description: "Array join operation",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output.trim()).toBe("a,b,c")
        },
      })
    })

    test("command 22: powershell -Command \"function test { Write-Host 'function works' }; test\"", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "powershell -Command \"function test { Write-Host 'function works' }; test\"",
              description: "Function definition and call",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output).toContain("function works")
        },
      })
    })

    test("command 23: powershell -Command \"$hash = @{key='value'}; Write-Host $hash.key\"", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: "powershell -Command \"$hash = @{key='value'}; Write-Host $hash.key\"",
              description: "Hashtable access",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.metadata.output).toContain("value")
        },
      })
    })

    describe("Part 3: Variable and Expression Handling", () => {
      test("command 24: powershell -Command \"$env:USERNAME\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"$env:USERNAME\"",
                description: "Get username from environment",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim().length).toBeGreaterThan(0)
          },
        })
      })

      test("command 25: powershell -Command \"$env:USERPROFILE\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"$env:USERPROFILE\"",
                description: "Get user profile path",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim()).toMatch(/[A-Za-z]:\\Users\\/)
          },
        })
      })

      test("command 26: powershell -Command \"$PSVersionTable.PSVersion.ToString()\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"$PSVersionTable.PSVersion.ToString()\"",
                description: "Get PowerShell version",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toMatch(/\d+\.\d+/)
          },
        })
      })

      test("command 27: powershell -Command \"[Environment]::OSVersion\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"[Environment]::OSVersion\"",
                description: "Get OS version",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output).toContain("Microsoft Windows")
          },
        })
      })

      test("command 28: powershell -Command \"$((Get-Date).ToString('yyyy-MM-dd'))\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"$((Get-Date).ToString('yyyy-MM-dd'))\"",
                description: "Get today's date in yyyy-MM-dd format",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim()).toMatch(/\d{4}-\d{2}-\d{2}/)
          },
        })
      })

      test("command 29: cmd /c echo %computername%", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c echo %computername%",
                description: "Get computer name",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim().length).toBeGreaterThan(0)
          },
        })
      })

      test("command 30: cmd /c echo %temp%", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "cmd /c echo %temp%",
                description: "Get temp directory",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim()).toMatch(/[A-Za-z]:\\.*Temp/)
          },
        })
      })

      test("command 31: powershell -Command \"$x = 'test'; $x.ToUpper()\"", async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await BashTool.init()
            const result = await bash.execute(
              {
                command: "powershell -Command \"$x = 'test'; $x.ToUpper()\"",
                description: "String manipulation",
              },
              ctx,
            )
            expect(result.metadata.exit).toBe(0)
            expect(result.metadata.output.trim()).toBe("TEST")
          },
        })
      })

      describe("Part 4: Path Handling and File Operations", () => {
        test("command 32: powershell -Command \"Write-Host 'C:\\\\Temp\\\\test.txt'\"", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "powershell -Command \"Write-Host 'C:\\\\Temp\\\\test.txt'\"",
                  description: "Display path string",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              expect(result.metadata.output).toContain("C:\Temp\test.txt")
            },
          })
        })

        test("command 33: powershell -Command \"Test-Path 'C:\\\\Windows'\"", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "powershell -Command \"Test-Path 'C:\\\\Windows'\"",
                  description: "Test if Windows directory exists",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              expect(result.metadata.output.trim()).toBe("True")
            },
          })
        })

        test("command 34: powershell -Command \"Get-ChildItem 'C:\\\\Program Files' | Select-Object -First 3\"", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "powershell -Command \"Get-ChildItem 'C:\\\\Program Files' | Select-Object -First 3\"",
                  description: "Get first 3 items from Program Files",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
              expect(lines.length).toBeGreaterThanOrEqual(3)
            },
          })
        })

        test("command 35: cmd /c dir %userprofile%", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "cmd /c dir %userprofile%",
                  description: "List user profile directory",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              expect(result.metadata.output).toMatch(/\d{2}\/\d{2}\/\d{4}/) // Directory listing format
            },
          })
        })

        test("command 36: powershell -Command \"Resolve-Path ~\"", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "powershell -Command \"Resolve-Path ~\"",
                  description: "Resolve home path",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              expect(result.metadata.output.trim()).toMatch(/[A-Za-z]:\\Users\\/)
            },
          })
        })

        test("command 37: powershell -Command \"(Get-Location).Path\"", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "powershell -Command \"(Get-Location).Path\"",
                  description: "Get current location path",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              expect(result.metadata.output.trim()).toMatch(/[A-Za-z]:\\.*opencode/)
            },
          })
        })

        test("command 38: powershell -Command \"Split-Path -Path 'C:\\\\Windows\\\\System32' -Leaf\"", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "powershell -Command \"Split-Path -Path 'C:\\\\Windows\\\\System32' -Leaf\"",
                  description: "Get leaf of path",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              expect(result.metadata.output.trim()).toBe("System32")
            },
          })
        })

        test("command 39: powershell -Command \"Join-Path -Path 'C:\\\\Temp' -ChildPath 'test.txt'\"", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "powershell -Command \"Join-Path -Path 'C:\\\\Temp' -ChildPath 'test.txt'\"",
                  description: "Join path components",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              expect(result.metadata.output.trim()).toBe("C:\Temp\test.txt")
            },
          })
        })

        test("command 40: cmd /c cd /d %temp% && echo %cd%", async () => {
          await Instance.provide({
            directory: projectRoot,
            fn: async () => {
              const bash = await BashTool.init()
              const result = await bash.execute(
                {
                  command: "cmd /c cd /d %temp% && echo %cd%",
                  description: "Change to temp directory and show current directory",
                },
                ctx,
              )
              expect(result.metadata.exit).toBe(0)
              expect(result.metadata.output.trim()).toMatch(/[A-Za-z]:\\.*Temp/i)
            },
          })
        })

        describe("Part 5: Batch File Creation and Execution", () => {
          test("commands 41-46: Create, modify, execute, and cleanup batch file", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()

                // Create batch file
                const createResult = await bash.execute(
                  {
                    command: "cmd /c echo @echo off > test.bat",
                    description: "Create batch file with echo off",
                  },
                  ctx,
                )
                expect(createResult.metadata.exit).toBe(0)

                // Add content
                const addContent1 = await bash.execute(
                  {
                    command: "cmd /c echo echo Hello from batch >> test.bat",
                    description: "Add echo command to batch file",
                  },
                  ctx,
                )
                expect(addContent1.metadata.exit).toBe(0)

                const addContent2 = await bash.execute(
                  {
                    command: "cmd /c echo echo Current time is >> test.bat",
                    description: "Add time command to batch file",
                  },
                  ctx,
                )
                expect(addContent2.metadata.exit).toBe(0)

                // Execute batch file
                const executeResult = await bash.execute(
                  {
                    command: "cmd /c test.bat",
                    description: "Execute the batch file",
                  },
                  ctx,
                )
                expect(executeResult.metadata.exit).toBe(0)
                expect(executeResult.metadata.output).toContain("Hello from batch")

                // Verify content
                const verifyResult = await bash.execute(
                  {
                    command: "cmd /c type test.bat",
                    description: "Display batch file contents",
                  },
                  ctx,
                )
                expect(verifyResult.metadata.exit).toBe(0)
                expect(verifyResult.metadata.output).toContain("@echo off")
                expect(verifyResult.metadata.output).toContain("echo Hello from batch")

                // Cleanup
                const cleanupResult = await bash.execute(
                  {
                    command: "cmd /c del test.bat",
                    description: "Delete the batch file",
                  },
                  ctx,
                )
                expect(cleanupResult.metadata.exit).toBe(0)
              },
            })
          })

          test("commands 47-48: Create and execute PowerShell script", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()

                // Create PowerShell script
                const createResult = await bash.execute(
                  {
                    command: "powershell -Command \"'@echo off' | Out-File -FilePath test.ps1 -Encoding ASCII\"",
                    description: "Create PowerShell script file",
                  },
                  ctx,
                )
                expect(createResult.metadata.exit).toBe(0)

                // Execute PowerShell script
                const executeResult = await bash.execute(
                  {
                    command: "powershell -ExecutionPolicy Bypass -File test.ps1",
                    description: "Execute PowerShell script",
                  },
                  ctx,
                )
                expect(executeResult.metadata.exit).toBe(0)

                // Cleanup
                await bash.execute(
                  {
                    command: "cmd /c del test.ps1",
                    description: "Delete PowerShell script",
                  },
                  ctx,
                )
              },
            })
          })
        })

        describe("Part 6: Process and Service Management", () => {
          test("command 49: powershell -Command \"Get-Process | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Process | Select-Object -First 3\"",
                    description: "Get first 3 processes",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(3)
              },
            })
          })

          test("command 50: powershell -Command \"Get-Process | Where-Object {$_.Name -eq 'explorer'} | Select-Object -First 1\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Process | Where-Object {$_.Name -eq 'explorer'} | Select-Object -First 1\"",
                    description: "Find explorer process",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // Explorer may or may not be running, so we just check that the command executed
              },
            })
          })

          test("command 51: powershell -Command \"Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object -First 3\"",
                    description: "Get first 3 running services",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(3)
              },
            })
          })

          test("command 52: powershell -Command \"Get-Service | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Service | Select-Object -First 3\"",
                    description: "Get first 3 services",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(3)
              },
            })
          })

          test("command 53: powershell -Command \"(Get-Process -Id $PID).ProcessName\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"(Get-Process -Id $PID).ProcessName\"",
                    description: "Get current process name",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 54: powershell -Command \"Get-ComputerInfo | Select-Object -First 1\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-ComputerInfo | Select-Object -First 1\"",
                    description: "Get computer info",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 55: cmd /c tasklist /fo csv /nh", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c tasklist /fo csv /nh",
                    description: "Get process list in CSV format",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain(",")
              },
            })
          })

          test("command 56: cmd /c sc query type= service state= all | find /c \"SERVICE_NAME\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c sc query type= service state= all | find /c \"SERVICE_NAME\"",
                    description: "Count services",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const count = parseInt(result.metadata.output.trim())
                expect(count).toBeGreaterThanOrEqual(0)
              },
            })
          })
        })

        describe("Part 7: Network Commands", () => {
          test("command 57: powershell -Command \"Test-Connection -ComputerName localhost -Count 1\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Test-Connection -ComputerName localhost -Count 1\"",
                    description: "Test connection to localhost",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // Connection test should succeed
              },
            })
          })

          test("command 58: cmd /c ping -n 1 127.0.0.1", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c ping -n 1 127.0.0.1",
                    description: "Ping localhost",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Reply from 127.0.0.1")
              },
            })
          })

          test("command 59: powershell -Command \"(Invoke-WebRequest -Uri 'https://www.microsoft.com' -UseBasicParsing).StatusCode\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"(Invoke-WebRequest -Uri 'https://www.microsoft.com' -UseBasicParsing).StatusCode\"",
                    description: "Get HTTP status code from Microsoft",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const statusCode = parseInt(result.metadata.output.trim())
                expect(statusCode).toBe(200)
              },
            })
          })

          test("command 60: powershell -Command \"[Net.Dns]::GetHostName()\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"[Net.Dns]::GetHostName()\"",
                    description: "Get hostname",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 61: cmd /c ipconfig /all | findstr /c:\"IPv4\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c ipconfig /all | findstr /c:\"IPv4\"",
                    description: "Find IPv4 addresses",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("IPv4")
              },
            })
          })

          test("command 62: powershell -Command \"Test-NetConnection -ComputerName www.google.com -InformationLevel Quiet\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Test-NetConnection -ComputerName www.google.com -InformationLevel Quiet\"",
                    description: "Test network connection to Google",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // Result should be True or False
                const output = result.metadata.output.trim().toLowerCase()
                expect(["true", "false"]).toContain(output)
              },
            })
          })

          test("command 63: cmd /c netstat -an | find /c \"LISTEN\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c netstat -an | find /c \"LISTEN\"",
                    description: "Count listening ports",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const count = parseInt(result.metadata.output.trim())
                expect(count).toBeGreaterThanOrEqual(0)
              },
            })
          })
        })

        describe("Part 8: System Information", () => {
          test("command 64: powershell -Command \"Get-CimInstance Win32_OperatingSystem | Select-Object -Property Caption\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-CimInstance Win32_OperatingSystem | Select-Object -Property Caption\"",
                    description: "Get OS name",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Microsoft Windows")
              },
            })
          })

          test("command 65: powershell -Command \"Get-CimInstance Win32_ComputerSystem | Select-Object -Property Model\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-CimInstance Win32_ComputerSystem | Select-Object -Property Model\"",
                    description: "Get computer model",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 66: powershell -Command \"(Get-CimInstance Win32_Processor).Name\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"(Get-CimInstance Win32_Processor).Name\"",
                    description: "Get CPU name",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 67: powershell -Command \"(Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum / 1GB\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"(Get-CimInstance Win32_PhysicalMemory | Measure-Object -Property Capacity -Sum).Sum / 1GB\"",
                    description: "Get RAM in GB",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const ramGB = parseFloat(result.metadata.output.trim())
                expect(ramGB).toBeGreaterThan(0)
              },
            })
          })

          test("command 68: powershell -Command \"Get-Disk | Select-Object -First 1\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Disk | Select-Object -First 1\"",
                    description: "Get disk info",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 69: cmd /c systeminfo | find /c \"OS\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c systeminfo | find /c \"OS\"",
                    description: "Count OS lines in systeminfo",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const count = parseInt(result.metadata.output.trim())
                expect(count).toBeGreaterThanOrEqual(0)
              },
            })
          })

          test("command 70: powershell -Command \"(Get-UICulture).Name\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"(Get-UICulture).Name\"",
                    description: "Get UI culture",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 71: powershell -Command \"[Environment]::Is64BitOperatingSystem\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"[Environment]::Is64BitOperatingSystem\"",
                    description: "Check if 64-bit OS",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const is64Bit = result.metadata.output.trim().toLowerCase()
                expect(["true", "false"]).toContain(is64Bit)
              },
            })
          })
        })

        describe("Part 9: Error Handling and Exit Codes", () => {
          test("command 72: powershell -Command \"Write-Error 'Test error'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Write-Error 'Test error'\"",
                    description: "Write error message",
                  },
                  ctx,
                )
                expect(result.metadata.exit).not.toBe(0)
                expect(result.metadata.output).toContain("Test error")
              },
            })
          })

          test("command 73: cmd /c dir nonexistent 2>&1", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c dir nonexistent 2>&1",
                    description: "List nonexistent directory",
                  },
                  ctx,
                )
                expect(result.metadata.exit).not.toBe(0)
                expect(result.metadata.output).toContain("File Not Found")
              },
            })
          })

          test("command 74: powershell -Command \"throw 'Intentional error'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"throw 'Intentional error'\"",
                    description: "Throw exception",
                  },
                  ctx,
                )
                expect(result.metadata.exit).not.toBe(0)
                expect(result.metadata.output).toContain("Intentional error")
              },
            })
          })

          test("command 75: cmd /c exit 42", async () => {
            await Instance.provide({
              directory: projectRoot,
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

          test("command 76: powershell -Command \"$ErrorActionPreference = 'Stop'; Get-Content nonexisistent.txt\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$ErrorActionPreference = 'Stop'; Get-Content nonexisistent.txt\"",
                    description: "Stop on error for nonexistent file",
                  },
                  ctx,
                )
                expect(result.metadata.exit).not.toBe(0)
                expect(result.metadata.output).toContain("Cannot find path")
              },
            })
          })

          test("command 77: cmd /c (exit 1) && echo success", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c (exit 1) && echo success",
                    description: "Exit 1 and check && behavior",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(1)
                expect(result.metadata.output).not.toContain("success")
              },
            })
          })

          test("command 78: powershell -Command \"try { 1/0 } catch { Write-Host 'Caught' }\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"try { 1/0 } catch { Write-Host 'Caught' }\"",
                    description: "Try-catch division by zero",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Caught")
              },
            })
          })

          test("command 79: cmd /c mkdir \"%temp%\\test_dir_$\" && echo success", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c mkdir \"%temp%\\test_dir_$\" && echo success",
                    description: "Create directory and echo success",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("success")
              },
            })
          })
        })

        describe("Part 10: Complex PowerShell Expressions", () => {
          test("command 80: powershell -Command \"1..10 | Measure-Object -Sum\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"1..10 | Measure-Object -Sum\"",
                    description: "Sum numbers 1 through 10",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("55")
              },
            })
          })

          test("command 81: powershell -Command \"@('a','b','c') | ForEach-Object { $_ + $_ }\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"@('a','b','c') | ForEach-Object { $_ + $_ }\"",
                    description: "Duplicate each array element",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("aa")
                expect(result.metadata.output).toContain("bb")
                expect(result.metadata.output).toContain("cc")
              },
            })
          })

          test("command 82: powershell -Command \"Get-ChildItem -Path 'C:\\\\Windows' -Filter *.exe -Recurse | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-ChildItem -Path 'C:\\\\Windows' -Filter *.exe -Recurse | Select-Object -First 3\"",
                    description: "Find first 3 exe files in Windows",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(3)
              },
            })
          })

          test("command 83: powershell -Command \"$hash = @{'a'=1;'b'=2;'c'=3}; $hash.GetEnumerator() | Sort-Object Value\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$hash = @{'a'=1;'b'=2;'c'=3}; $hash.GetEnumerator() | Sort-Object Value\"",
                    description: "Sort hashtable by value",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("1")
                expect(result.metadata.output).toContain("2")
                expect(result.metadata.output).toContain("3")
              },
            })
          })

          test("command 84: powershell -Command \"[regex]::Matches('abcabcabc', 'a+') | ForEach-Object {$_.Value}\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"[regex]::Matches('abcabcabc', 'a+') | ForEach-Object {$_.Value}\"",
                    description: "Regex matches for 'a+'",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("a")
              },
            })
          })

          test("command 85: powershell -Command \"$arr = 1..100; ($arr | Where-Object { $_ % 7 -eq 0 } | Measure-Object).Count\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$arr = 1..100; ($arr | Where-Object { $_ % 7 -eq 0 } | Measure-Object).Count\"",
                    description: "Count numbers divisible by 7",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const count = parseInt(result.metadata.output.trim())
                expect(count).toBeGreaterThan(0)
              },
            })
          })

          test("command 86: powershell -Command \"Get-Content $env:windir\\\\system32\\\\drivers\\\\etc\\\\hosts | Select-Object -First 5\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Content $env:windir\\\\system32\\\\drivers\\\\etc\\\\hosts | Select-Object -First 5\"",
                    description: "Read first 5 lines of hosts file",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(5)
              },
            })
          })

          test("command 87: powershell -Command \"$obj = New-Object PSObject -Property @{Name='Test';Value=42}; $obj\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$obj = New-Object PSObject -Property @{Name='Test';Value=42}; $obj\"",
                    description: "Create custom object",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Test")
                expect(result.metadata.output).toContain("42")
              },
            })
          })

          test.skip("command 88: powershell -Command \"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Test')\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Test')\"",
                    description: "Show message box",
                  },
                  ctx,
                )
                // MessageBox may not work in non-interactive context, but command should execute
                expect(result.metadata.exit === 0 || result.metadata.exit === 1).toBe(true)
              },
            })
          })

          test("command 89: powershell -Command \"$bytes = [Text.Encoding]::UTF8.GetBytes('Hello'); [Convert]::ToBase64String($bytes)\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$bytes = [Text.Encoding]::UTF8.GetBytes('Hello'); [Convert]::ToBase64String($bytes)\"",
                    description: "Convert string to base64",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim()).toBe("SGVsbG8=")
              },
            })
          })

          test("command 90: powershell -Command \"[DateTime]::Now.AddDays(-7).ToString('yyyy-MM-dd')\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"[DateTime]::Now.AddDays(-7).ToString('yyyy-MM-dd')\"",
                    description: "Get date 7 days ago",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim()).toMatch(/\d{4}-\d{2}-\d{2}/)
              },
            })
          })
        })

        describe("Part 11: Long-Running Command Handling", () => {
          test("command 91: powershell -Command \"Start-Sleep -Seconds 1; Write-Host 'Done'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Start-Sleep -Seconds 1; Write-Host 'Done'\"",
                    description: "Sleep for 1 second then output",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Done")
              },
            })
          })

          test("command 92: cmd /c ping -n 3 127.0.0.1", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c ping -n 3 127.0.0.1",
                    description: "Ping localhost 3 times",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Reply from 127.0.0.1")
              },
            })
          })

          test("command 93: powershell -Command \"for ($i = 0; $i -lt 10; $i++) { Write-Host $i; Start-Sleep -Milliseconds 100 }\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"for ($i = 0; $i -lt 10; $i++) { Write-Host $i; Start-Sleep -Milliseconds 100 }\"",
                    description: "Loop with sleep",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("0")
                expect(result.metadata.output).toContain("9")
              },
            })
          })

          test("command 94: powershell -Command \"$null = 1..1000 | ForEach-Object { }; Write-Host 'Done'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$null = 1..1000 | ForEach-Object { }; Write-Host 'Done'\"",
                    description: "Process 1000 items then output",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Done")
              },
            })
          })

          test("command 95: cmd /c for /l %i in (1,1,100) do @echo %i", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c for /l %i in (1,1,100) do @echo %i",
                    description: "CMD for loop 1 to 100",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("1")
                expect(result.metadata.output).toContain("100")
              },
            })
          })
        })

        describe("Part 12: Output Format Verification", () => {
          test("command 96: powershell -Command \"Get-Date -Format 'yyyy-MM-dd HH:mm:ss'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Date -Format 'yyyy-MM-dd HH:mm:ss'\"",
                    description: "Get formatted date",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim()).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
              },
            })
          })

          test("command 97: powershell -Command \"Get-Process | ConvertTo-Csv -NoTypeInformation | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Process | ConvertTo-Csv -NoTypeInformation | Select-Object -First 3\"",
                    description: "Get processes as CSV",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain(",")
              },
            })
          })

          test("command 98: powershell -Command \"Get-Process | Select-Object Name,Id | ConvertTo-Json -Depth 1\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Process | Select-Object Name,Id | ConvertTo-Json -Depth 1\"",
                    description: "Get processes as JSON",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("{")
                expect(result.metadata.output).toContain("}")
              },
            })
          })

          test("command 99: powershell -Command \"Get-Process | Format-Table -AutoSize | Out-String -Width 100\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Process | Format-Table -AutoSize | Out-String -Width 100\"",
                    description: "Get processes as formatted table",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Name")
                expect(result.metadata.output).toContain("Id")
              },
            })
          }, 15000)

          test("command 100: powershell -Command \"Get-Date | Format-List\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Date | Format-List\"",
                    description: "Get date as formatted list",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain(":")
              },
            })
          })
        })

        describe("Part 13: Environment and Configuration", () => {
          test("command 101: powershell -Command \"Get-ChildItem Env:\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-ChildItem Env:\"",
                    description: "Get environment variables",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Name")
                expect(result.metadata.output).toContain("Value")
              },
            })
          })

          test("command 102: powershell -Command \"$env:PATH.Length\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$env:PATH.Length\"",
                    description: "Get PATH environment variable",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 103: powershell -Command \"[Environment]::GetEnvironmentVariables('Machine')\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"[Environment]::GetEnvironmentVariables('Machine')\"",
                    description: "Get machine environment variables",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 104: powershell -Command \"Get-PSReadLineOption\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-PSReadLineOption\"",
                    description: "Get PSReadLine options",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // PSReadLine may not be available, but command should execute
              },
            })
          })

          test("command 105: powershell -Command \"$PSDefaultParameterValues\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$PSDefaultParameterValues\"",
                    description: "Get default parameter values",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // May be empty, but command should execute
              },
            })
          })

          test("command 106: powershell -Command \"Get-ExecutionPolicy\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-ExecutionPolicy\"",
                    description: "Get execution policy",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })
        })

        describe("Part 14: Unicode and Special Characters", () => {
          test("command 107: powershell -Command \"Write-Host 'Hello 世界'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Write-Host 'Hello 世界'\"",
                    description: "Write-Host with Unicode characters",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Hello 世界")
              },
            })
          })

          test("command 108: powershell -Command \"Write-Host 'Emoji: 😀 🔥 🚀'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Write-Host 'Emoji: 😀 🔥 🚀'\"",
                    description: "Write-Host with emoji",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Emoji:")
              },
            })
          })

          test("command 109: powershell -Command \"Write-Host 'Smart quotes: \"test\"'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Write-Host 'Smart quotes: \"test\"'\"",
                    description: "Write-Host with smart quotes",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Smart quotes:")
              },
            })
          })

          test("command 110: powershell -Command \"Write-Host 'Special: — – …'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Write-Host 'Special: — – …'\"",
                    description: "Write-Host with special characters",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Special:")
              },
            })
          })

          test("command 111: powershell -Command \"'test'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"'test'\"",
                    description: "Unicode character codes",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 112: powershell -Command \"Write-Host 'Cyrillic: Привет'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Write-Host 'Cyrillic: Привет'\"",
                    description: "Write-Host with Cyrillic",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Cyrillic:")
              },
            })
          })

          test("command 113: powershell -Command \"Write-Host 'Arabic: مرحبا'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Write-Host 'Arabic: مرحبا'\"",
                    description: "Write-Host with Arabic",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Arabic:")
              },
            })
          })

          test("command 114: powershell -Command \"Write-Host 'Tabs: a\tb\tc'\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Write-Host 'Tabs: a\tb\tc'\"",
                    description: "Write-Host with tab characters",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Tabs:")
              },
            })
          })
        })

        describe("Part 15: Command Discovery and Help", () => {
          test("command 115: powershell -Command \"Get-Command Write-Host | Format-List\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Command Write-Host | Format-List\"",
                    description: "Get command info for Write-Host",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Write-Host")
              },
            })
          })

          test("command 116: powershell -Command \"Get-History\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-History\"",
                    description: "Get command history",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // History may be empty, but command should execute
              },
            })
          })

          test("command 117: powershell -Command \"Get-Alias\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Alias\"",
                    description: "Get aliases list",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test.skip("command 118: powershell -Command \"Update-Help -ErrorAction SilentlyContinue; Get-Help Get-Process\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Update-Help -ErrorAction SilentlyContinue; Get-Help Get-Process\"",
                    description: "Get help for Get-Process",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Get-Process")
              },
            })
          })

          test("command 119: powershell -Command \"Get-Module\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Module\"",
                    description: "Get loaded modules",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // May be empty, but command should execute
              },
            })
          })

          test("command 120: powershell -Command \"Get-PSSnapin\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-PSSnapin\"",
                    description: "Get PS snapins",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // May be empty, but command should execute
              },
            })
          })
        })

        describe("Part 16: Job and Background Execution", () => {
          test("command 121: powershell -Command \"$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 1; Write-Host 'Job done' }; Receive-Job -Job $job -Wait\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$job = Start-Job -ScriptBlock { Start-Sleep -Seconds 1; Write-Host 'Job done' }; Receive-Job -Job $job -Wait\"",
                    description: "Start background job and wait for completion",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Job done")
              },
            })
          })

          test("command 122: powershell -Command \"Get-Job\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Job\"",
                    description: "Get job listing",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // May be empty, but command should execute
              },
            })
          })

          test("command 123: powershell -Command \"Start-Job -ScriptBlock { Get-Process } | Wait-Job | Receive-Job\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Start-Job -ScriptBlock { Get-Process } | Wait-Job | Receive-Job\"",
                    description: "Start job, wait, and receive results",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("Name")
                expect(result.metadata.output).toContain("Id")
              },
            })
          }, 120000)

          test("command 124: powershell -Command \"$job = Start-Job -ScriptBlock { 1..10 }; $job | Wait-Job | Receive-Job\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$job = Start-Job -ScriptBlock { 1..10 }; $job | Wait-Job | Receive-Job\"",
                    description: "Start job with numbers and receive results",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("1")
                expect(result.metadata.output).toContain("10")
              },
            })
          })
        })

        describe("Part 17: Module and Package Management", () => {
          test("command 125: powershell -Command \"Get-Module -ListAvailable | Select-Object -First 5\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-Module -ListAvailable | Select-Object -First 5\"",
                    description: "Get first 5 available modules",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(5)
              },
            })
          })

          test("command 126: powershell -Command \"Find-Module -Name _Package_ -ErrorAction SilentlyContinue | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Find-Module -Name _Package_ -ErrorAction SilentlyContinue | Select-Object -First 3\"",
                    description: "Find modules with search pattern",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // May be empty if no modules found, but command should execute
              },
            })
          })

          test("command 127: powershell -Command \"Import-Module Microsoft.PowerShell.Management; Get-Command -Module Microsoft.PowerShell.Management | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Import-Module Microsoft.PowerShell.Management; Get-Command -Module Microsoft.PowerShell.Management | Select-Object -First 3\"",
                    description: "Import module and get its commands",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(3)
              },
            })
          })
        })

        describe("Part 18: Cross-Platform Considerations", () => {
          test("command 128: powershell -Command \"(Get-Item 'C:\\\\Windows').FullName\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"(Get-Item 'C:\\\\Windows').FullName\"",
                    description: "Get Windows directory full path",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim()).toBe("C:\\Windows")
              },
            })
          })

          test("command 129: powershell -Command \"$PSHome\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$PSHome\"",
                    description: "Get PowerShell home directory",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 130: powershell -Command \"(Get-PSProvider FileSystem).Home\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"(Get-PSProvider FileSystem).Home\"",
                    description: "Get FileSystem provider home",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim().length).toBeGreaterThan(0)
              },
            })
          })

          test("command 131: powershell -Command \"[System.IO.Path]::AltDirectorySeparatorChar\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"[System.IO.Path]::AltDirectorySeparatorChar\"",
                    description: "Get alternate directory separator",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim()).toBe("/")
              },
            })
          })

          test("command 132: powershell -Command \"[System.IO.Path]::DirectorySeparatorChar\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"[System.IO.Path]::DirectorySeparatorChar\"",
                    description: "Get directory separator",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim()).toBe("\\")
              },
            })
          })

          test("command 133: powershell -Command \"[System.Environment]::NewLine\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"[System.Environment]::NewLine\"",
                    description: "Get newline character",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output.trim()).toBe("\r\n")
              },
            })
          })
        })

        describe("Part 19: Performance and Timing", () => {
          test("command 134: powershell -Command \"Measure-Command { 1..1000 | ForEach-Object { $_ } }\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Measure-Command { 1..1000 | ForEach-Object { $_ } }\"",
                    description: "Measure command execution time",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toContain("TotalMilliseconds")
              },
            })
          })

          test("command 135: powershell -Command \"$sw = [Diagnostics.Stopwatch]::StartNew(); 1..100; $sw.Stop(); $sw.ElapsedMilliseconds\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$sw = [Diagnostics.Stopwatch]::StartNew(); 1..100; $sw.Stop(); $sw.ElapsedMilliseconds\"",
                    description: "Use stopwatch to measure time",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const time = parseInt(result.metadata.output.trim())
                expect(time).toBeGreaterThanOrEqual(0)
              },
            })
          })

          test("command 136: cmd /c echo %time% && ping -n 2 127.0.0.1 >nul && echo %time%", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "cmd /c echo %time% && ping -n 2 127.0.0.1 >nul && echo %time%",
                    description: "Show time before and after operation",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                expect(result.metadata.output).toMatch(/% \\d{1,2}:\\d{2}:\\d{2}\\.\\d{2}%/)
              },
            })
          })
        })

        describe("Part 20: Combinations and Complex Scenarios", () => {
          test("command 137: powershell -Command \"$procs = Get-Process; $procs | Where-Object { $_.CPU -gt 0 } | Sort-Object CPU -Descending | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$procs = Get-Process; $procs | Where-Object { $_.CPU -gt 0 } | Sort-Object CPU -Descending | Select-Object -First 3\"",
                    description: "Complex process filtering and sorting",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(3)
              },
            })
          }, 20000)

          test("command 138: powershell -Command \"$files = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 1MB } | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$files = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt 1MB } | Select-Object -First 3\"",
                    description: "Find large files",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // May not find any large files, but command should execute
              },
            })
          })

          test("command 139: powershell -Command \"$env:PATH.Split(';') | Where-Object { Test-Path $_ } | Select-Object -First 5\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"$env:PATH.Split(';') | Where-Object { Test-Path $_ } | Select-Object -First 5\"",
                    description: "Filter valid PATH directories",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                const lines = result.metadata.output.trim().split('\n').filter(line => line.trim())
                expect(lines.length).toBeGreaterThanOrEqual(1)
              },
            })
          })

          test("command 140: powershell -Command \"Get-ChildItem -Path 'C:\\\\Windows\\\\System32' -Filter *.dll | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-30) } | Select-Object -First 3\"", async () => {
            await Instance.provide({
              directory: projectRoot,
              fn: async () => {
                const bash = await BashTool.init()
                const result = await bash.execute(
                  {
                    command: "powershell -Command \"Get-ChildItem -Path 'C:\\\\Windows\\\\System32' -Filter *.dll | Where-Object { $_.LastWriteTime -gt (Get-Date).AddDays(-30) } | Select-Object -First 3\"",
                    description: "Find recently modified DLLs",
                  },
                  ctx,
                )
                expect(result.metadata.exit).toBe(0)
                // May not find recently modified DLLs, but command should execute
              },
            })
          })
        })
      })
    })
  })
})
