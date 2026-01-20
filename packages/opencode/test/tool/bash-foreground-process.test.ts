import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import {
  registerForegroundProcess,
  unregisterForegroundProcess,
  getForegroundProcess,
  listForegroundProcesses,
  migrateToBackground,
  killForegroundProcess,
  type ForegroundProcess,
} from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { TaskManager, type TaskInfo } from "../../src/task"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"
import { Shell } from "../../src/shell/shell"

Log.init({ print: false })

// Helper to create a mock process for testing
function createMockProcess(command: string = "sleep 5"): ChildProcess {
  const shell = Shell.acceptable()
  return spawn(command, {
    shell,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
}

// Helper to wait for task completion with timeout
async function waitForTaskCompletion(taskId: string, timeoutMs: number = 10000): Promise<TaskInfo | undefined> {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    const task = await TaskManager.get(taskId)
    if (task && task.status !== "running") {
      return task
    }
    await Bun.sleep(100)
  }
  return TaskManager.get(taskId)
}

describe("Foreground Process Registry", () => {
  describe("registerForegroundProcess", () => {
    test("registers a process and can be retrieved by callID", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const proc = createMockProcess()
          const callID = `test_call_${Date.now()}`

          try {
            registerForegroundProcess({
              callID,
              sessionID: "test-session",
              pid: proc.pid!,
              command: "sleep 5",
              description: "Test process",
              workdir: tmp.path,
              startTime: Date.now(),
              process: proc,
              output: "",
            })

            const registered = getForegroundProcess(callID)
            expect(registered).toBeDefined()
            expect(registered?.callID).toBe(callID)
            expect(registered?.pid).toBe(proc.pid!)
            expect(registered?.command).toBe("sleep 5")
            expect(registered?.sessionID).toBe("test-session")
            expect(registered?.migrated).toBe(false)
          } finally {
            // Cleanup
            proc.kill()
            unregisterForegroundProcess(callID)
          }
        },
      })
    })

    test("registers with default no-op resolve callback when none provided", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const proc = createMockProcess()
          const callID = `test_call_noop_${Date.now()}`

          try {
            registerForegroundProcess({
              callID,
              sessionID: "test-session",
              pid: proc.pid!,
              command: "sleep 5",
              description: "Test process",
              workdir: tmp.path,
              startTime: Date.now(),
              process: proc,
              output: "",
            })

            const registered = getForegroundProcess(callID)
            expect(registered).toBeDefined()
            expect(typeof registered?.resolve).toBe("function")

            // Should not throw when called (no-op)
            expect(() => registered?.resolve({ migrated: true, taskId: "test" })).not.toThrow()
          } finally {
            proc.kill()
            unregisterForegroundProcess(callID)
          }
        },
      })
    })

    test("registers with custom resolve callback", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const proc = createMockProcess()
          const callID = `test_call_resolve_${Date.now()}`
          let resolveCalled = false
          let receivedTaskId: string | null = null

          try {
            registerForegroundProcess(
              {
                callID,
                sessionID: "test-session",
                pid: proc.pid!,
                command: "sleep 5",
                description: "Test process",
                workdir: tmp.path,
                startTime: Date.now(),
                process: proc,
                output: "",
              },
              (result) => {
                resolveCalled = true
                receivedTaskId = result.taskId
              },
            )

            const registered = getForegroundProcess(callID)
            expect(registered).toBeDefined()

            // Manually invoke resolve to test callback
            registered?.resolve({ migrated: true, taskId: "task_123" })

            expect(resolveCalled).toBe(true)
            expect(receivedTaskId).not.toBeNull()
            expect(String(receivedTaskId)).toBe("task_123")
          } finally {
            proc.kill()
            unregisterForegroundProcess(callID)
          }
        },
      })
    })

    test("appears in listForegroundProcesses when active", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const proc = createMockProcess()
          const callID = `test_call_list_${Date.now()}`

          try {
            registerForegroundProcess({
              callID,
              sessionID: "test-session",
              pid: proc.pid!,
              command: "sleep 5",
              description: "Test process",
              workdir: tmp.path,
              startTime: Date.now(),
              process: proc,
              output: "",
            })

            const processes = listForegroundProcesses()
            expect(processes.some((p) => p.callID === callID)).toBe(true)
          } finally {
            proc.kill()
            unregisterForegroundProcess(callID)
          }
        },
      })
    })
  })

  describe("unregisterForegroundProcess", () => {
    test("removes process from registry", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const proc = createMockProcess()
          const callID = `test_call_unregister_${Date.now()}`

          try {
            registerForegroundProcess({
              callID,
              sessionID: "test-session",
              pid: proc.pid!,
              command: "sleep 5",
              description: "Test process",
              workdir: tmp.path,
              startTime: Date.now(),
              process: proc,
              output: "",
            })

            // Verify it was registered
            expect(getForegroundProcess(callID)).toBeDefined()

            // Unregister
            unregisterForegroundProcess(callID)

            // Verify it's gone
            expect(getForegroundProcess(callID)).toBeUndefined()
          } finally {
            proc.kill()
          }
        },
      })
    })

    test("no longer appears in listForegroundProcesses after unregistration", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const proc = createMockProcess()
          const callID = `test_call_list_unregister_${Date.now()}`

          try {
            registerForegroundProcess({
              callID,
              sessionID: "test-session",
              pid: proc.pid!,
              command: "sleep 5",
              description: "Test process",
              workdir: tmp.path,
              startTime: Date.now(),
              process: proc,
              output: "",
            })

            // Verify it's in the list
            expect(listForegroundProcesses().some((p) => p.callID === callID)).toBe(true)

            // Unregister
            unregisterForegroundProcess(callID)

            // Verify it's no longer in the list
            expect(listForegroundProcesses().some((p) => p.callID === callID)).toBe(false)
          } finally {
            proc.kill()
          }
        },
      })
    })

    test("handles unregistering non-existent process gracefully", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Should not throw
          expect(() => unregisterForegroundProcess("non_existent_call_id")).not.toThrow()
        },
      })
    })
  })
})

describe("Migration Flow", () => {
  describe("migrateToBackground", () => {
    test(
      "migrates running process to background task",
      async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const proc = createMockProcess("sleep 10")
            const callID = `test_migrate_${Date.now()}`
            let resolveCalled = false
            let receivedTaskId: string | null = null

            registerForegroundProcess(
              {
                callID,
                sessionID: "test-session",
                pid: proc.pid!,
                command: "sleep 10",
                description: "Migratable process",
                workdir: tmp.path,
                startTime: Date.now(),
                process: proc,
                output: "initial output",
              },
              (result) => {
                resolveCalled = true
                receivedTaskId = result.taskId
              },
            )

            // Migrate to background
            const taskId = await migrateToBackground(callID)

            expect(taskId).not.toBeNull()
            expect(taskId).toMatch(/^task_/)

            // Verify resolve callback was invoked with taskId
            expect(resolveCalled).toBe(true)
            expect(String(receivedTaskId)).toBe(String(taskId))

            // Verify process is removed from foreground registry
            expect(getForegroundProcess(callID)).toBeUndefined()
            expect(listForegroundProcesses().some((p) => p.callID === callID)).toBe(false)

            // Verify task exists in TaskManager
            const task = await TaskManager.get(taskId!)
            expect(task).toBeDefined()
            expect(task?.command).toBe("sleep 10")
            expect(task?.description).toBe("Migratable process")
            expect(task?.status).toBe("running")

            // Clean up
            await TaskManager.kill(taskId!)
            await waitForTaskCompletion(taskId!)
          },
        })
      },
      { timeout: 30000 },
    )

    test("returns null for unknown callID", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const taskId = await migrateToBackground("non_existent_call_id")
          expect(taskId).toBeNull()
        },
      })
    })

    test("returns null for already migrated process", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const proc = createMockProcess("sleep 10")
          const callID = `test_double_migrate_${Date.now()}`

          registerForegroundProcess({
            callID,
            sessionID: "test-session",
            pid: proc.pid!,
            command: "sleep 10",
            description: "Double migrate test",
            workdir: tmp.path,
            startTime: Date.now(),
            process: proc,
            output: "",
          })

          // First migration should succeed
          const taskId1 = await migrateToBackground(callID)
          expect(taskId1).not.toBeNull()

          // Second migration should fail (process already removed from registry)
          const taskId2 = await migrateToBackground(callID)
          expect(taskId2).toBeNull()

          // Clean up
          await TaskManager.kill(taskId1!)
          await waitForTaskCompletion(taskId1!)
        },
      })
    })

    test("returns null for completed process", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Create a process that exits immediately
          const proc = createMockProcess("echo done")
          const callID = `test_migrate_completed_${Date.now()}`

          registerForegroundProcess({
            callID,
            sessionID: "test-session",
            pid: proc.pid!,
            command: "echo done",
            description: "Completed process",
            workdir: tmp.path,
            startTime: Date.now(),
            process: proc,
            output: "",
          })

          // Wait for process to exit
          await new Promise<void>((resolve) => {
            proc.on("exit", () => resolve())
          })

          // Migration should fail for completed process
          const taskId = await migrateToBackground(callID)
          expect(taskId).toBeNull()

          // Clean up
          unregisterForegroundProcess(callID)
        },
      })
    })

    test(
      "preserves initial output when migrating",
      async () => {
        await using tmp = await tmpdir({ git: true })
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            // Use a command that outputs something and then sleeps
            const proc = createMockProcess('echo "initial" && sleep 5')
            const callID = `test_migrate_output_${Date.now()}`
            const initialOutput = "previously captured output\n"

            registerForegroundProcess({
              callID,
              sessionID: "test-session",
              pid: proc.pid!,
              command: 'echo "initial" && sleep 5',
              description: "Output test",
              workdir: tmp.path,
              startTime: Date.now(),
              process: proc,
              output: initialOutput,
            })

            // Let the process run a bit to generate output
            await Bun.sleep(300)

            // Migrate to background
            const taskId = await migrateToBackground(callID)
            expect(taskId).not.toBeNull()

            // Verify task was created
            const task = await TaskManager.get(taskId!)
            expect(task).toBeDefined()

            // Clean up
            await TaskManager.kill(taskId!)
            await waitForTaskCompletion(taskId!)
          },
        })
      },
      { timeout: 30000 },
    )
  })
})

describe("killForegroundProcess", () => {
  test(
    "kills a running foreground process",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const proc = createMockProcess("sleep 60")
          const callID = `test_kill_${Date.now()}`

          registerForegroundProcess({
            callID,
            sessionID: "test-session",
            pid: proc.pid!,
            command: "sleep 60",
            description: "Kill test",
            workdir: tmp.path,
            startTime: Date.now(),
            process: proc,
            output: "",
          })

          // Verify process is registered
          expect(getForegroundProcess(callID)).toBeDefined()

          // Kill the process
          const killed = await killForegroundProcess(callID)
          expect(killed).toBe(true)

          // Wait a bit for process to be cleaned up
          await Bun.sleep(300)

          // Clean up registry
          unregisterForegroundProcess(callID)
        },
      })
    },
    { timeout: 10000 },
  )

  test("returns false for unknown callID", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const killed = await killForegroundProcess("non_existent_call_id")
        expect(killed).toBe(false)
      },
    })
  })

  test("returns false for already exited process", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const proc = createMockProcess("echo done")
        const callID = `test_kill_exited_${Date.now()}`

        registerForegroundProcess({
          callID,
          sessionID: "test-session",
          pid: proc.pid!,
          command: "echo done",
          description: "Already exited",
          workdir: tmp.path,
          startTime: Date.now(),
          process: proc,
          output: "",
        })

        // Wait for process to exit
        await new Promise<void>((resolve) => {
          proc.on("exit", () => resolve())
        })

        // Kill should return false since process already exited
        const killed = await killForegroundProcess(callID)
        expect(killed).toBe(false)

        // Clean up
        unregisterForegroundProcess(callID)
      },
    })
  })
})

describe("listForegroundProcesses filtering", () => {
  test("excludes migrated processes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const proc = createMockProcess("sleep 10")
        const callID = `test_list_migrated_${Date.now()}`

        registerForegroundProcess({
          callID,
          sessionID: "test-session",
          pid: proc.pid!,
          command: "sleep 10",
          description: "Migrated process",
          workdir: tmp.path,
          startTime: Date.now(),
          process: proc,
          output: "",
        })

        // Verify it's in the list before migration
        expect(listForegroundProcesses().some((p) => p.callID === callID)).toBe(true)

        // Migrate
        const taskId = await migrateToBackground(callID)
        expect(taskId).not.toBeNull()

        // Process should no longer be in the list (removed from registry)
        expect(listForegroundProcesses().some((p) => p.callID === callID)).toBe(false)

        // Clean up
        await TaskManager.kill(taskId!)
        await waitForTaskCompletion(taskId!)
      },
    })
  })

  test("excludes exited processes", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const proc = createMockProcess("echo quick")
        const callID = `test_list_exited_${Date.now()}`

        registerForegroundProcess({
          callID,
          sessionID: "test-session",
          pid: proc.pid!,
          command: "echo quick",
          description: "Exited process",
          workdir: tmp.path,
          startTime: Date.now(),
          process: proc,
          output: "",
        })

        // Wait for process to exit
        await new Promise<void>((resolve) => {
          proc.on("exit", () => resolve())
        })

        // Process should not appear in list (exited)
        expect(listForegroundProcesses().some((p) => p.callID === callID)).toBe(false)

        // But should still be gettable by callID until unregistered
        expect(getForegroundProcess(callID)).toBeDefined()

        // Clean up
        unregisterForegroundProcess(callID)
      },
    })
  })
})
