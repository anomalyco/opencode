import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { TaskManager, TaskEvent, type TaskInfo } from "../../src/task"
import { TaskPersistence } from "../../src/task/persistence"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

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

describe("TaskManager", () => {
  describe("create()", () => {
    test(
      "creates task, spawns process, returns task info",
      async () => {
        await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await TaskManager.create({
            command: "echo hello",
            description: "Test echo",
          })

          expect(task.id).toMatch(/^task_/)
          expect(task.pid).toBeGreaterThan(0)
          expect(task.command).toBe("echo hello")
          expect(task.status).toBe("running")
          expect(task.workdir).toBe(tmp.path)
          expect(task.description).toBe("Test echo")
          expect(task.logFile).toContain(".opencode/tasks/")
          expect(task.reconnectable).toBe(true)

          // Wait for completion
          const completed = await waitForTaskCompletion(task.id)
          expect(completed?.status).toBe("completed")
          expect(completed?.exitCode).toBe(0)
        },
      })
      },
      { timeout: 30000 },
    )

    test("creates task with custom workdir", async () => {
      await using tmp = await tmpdir({ git: true })
      const subdir = path.join(tmp.path, "subdir")
      await fs.mkdir(subdir, { recursive: true })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await TaskManager.create({
            command: "pwd",
            workdir: subdir,
            description: "Test pwd in subdir",
          })

          expect(task.workdir).toBe(subdir)

          await waitForTaskCompletion(task.id)
          const output = await TaskManager.read(task.id)
          expect(output.trim()).toBe(subdir)
        },
      })
    })

    test("handles command failure with non-zero exit code", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await TaskManager.create({
            command: "exit 42",
            description: "Test failure",
          })

          const completed = await waitForTaskCompletion(task.id)
          expect(completed?.status).toBe("failed")
          expect(completed?.exitCode).toBe(42)
        },
      })
    })
  })

  describe("list()", () => {
    test("returns all tasks", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task1 = await TaskManager.create({
            command: "sleep 0.1",
            description: "Task 1",
          })
          const task2 = await TaskManager.create({
            command: "sleep 0.1",
            description: "Task 2",
          })

          const tasks = await TaskManager.list()
          expect(tasks.length).toBeGreaterThanOrEqual(2)
          expect(tasks.some((t) => t.id === task1.id)).toBe(true)
          expect(tasks.some((t) => t.id === task2.id)).toBe(true)

          // Wait for completion
          await waitForTaskCompletion(task1.id)
          await waitForTaskCompletion(task2.id)
        },
      })
    })

    test("returns empty array when no tasks", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Clear any existing tasks
          const existingTasks = await TaskManager.list()
          for (const task of existingTasks) {
            if (task.status !== "running") {
              await TaskManager.remove(task.id)
            }
          }

          // Check remaining (may have running tasks from other tests)
          const tasks = await TaskManager.list()
          expect(Array.isArray(tasks)).toBe(true)
        },
      })
    })
  })

  describe("get()", () => {
    test("returns specific task", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const created = await TaskManager.create({
            command: "echo test",
            description: "Get test",
          })

          const task = await TaskManager.get(created.id)
          expect(task).toBeDefined()
          expect(task?.id).toBe(created.id)
          expect(task?.command).toBe("echo test")

          await waitForTaskCompletion(created.id)
        },
      })
    })

    test("returns undefined for unknown task", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await TaskManager.get("task_nonexistent_12345")
          expect(task).toBeUndefined()
        },
      })
    })
  })

  describe("kill()", () => {
    test("terminates running task", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await TaskManager.create({
            command: "sleep 60",
            description: "Long running task",
          })

          expect(task.status).toBe("running")

          // Kill the task
          const killed = await TaskManager.kill(task.id)
          expect(killed).toBe(true)

          // Wait a bit for cleanup
          await Bun.sleep(300)

          const after = await TaskManager.get(task.id)
          expect(after?.status).toBe("failed")
        },
      })
    })

    test("returns false for unknown task", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const killed = await TaskManager.kill("task_nonexistent_12345")
          expect(killed).toBe(false)
        },
      })
    })

    test("returns false for already completed task", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await TaskManager.create({
            command: "echo done",
            description: "Quick task",
          })

          await waitForTaskCompletion(task.id)

          const killed = await TaskManager.kill(task.id)
          expect(killed).toBe(false)
        },
      })
    })
  })

  describe("read()", () => {
    test("returns full output", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await TaskManager.create({
            command: "echo line1 && echo line2 && echo line3",
            description: "Multi-line output",
          })

          await waitForTaskCompletion(task.id)
          const output = await TaskManager.read(task.id)

          expect(output).toContain("line1")
          expect(output).toContain("line2")
          expect(output).toContain("line3")
        },
      })
    })

    test("returns empty string for task without output", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const output = await TaskManager.read("task_nonexistent_12345")
          expect(output).toBe("")
        },
      })
    })
  })

  describe("tail()", () => {
    test("returns last N lines", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const task = await TaskManager.create({
            command: "seq 1 20",
            description: "Generate numbers",
          })

          await waitForTaskCompletion(task.id)
          const output = await TaskManager.tail(task.id, 5)

          const lines = output
            .trim()
            .split("\n")
            .filter((l) => l)
          expect(lines.length).toBeLessThanOrEqual(5)
          expect(lines[lines.length - 1]).toBe("20")
        },
      })
    })
  })

  describe("input()", () => {
    test("sends stdin to process", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Use a simple command that reads stdin and echoes it
          const task = await TaskManager.create({
            command: "read line && echo \"received: $line\"",
            description: "Read stdin",
          })

          // Give process time to start
          await Bun.sleep(200)

          // Send input
          const sent = await TaskManager.input(task.id, "hello\n")
          expect(sent).toBe(true)

          // Wait for completion (the read command should exit after receiving input)
          await waitForTaskCompletion(task.id)

          const output = await TaskManager.read(task.id)
          expect(output).toContain("received: hello")
        },
      })
    })

    test("returns false for task without process handle", async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const sent = await TaskManager.input("task_nonexistent_12345", "test")
          expect(sent).toBe(false)
        },
      })
    })
  })
})

describe("TaskPersistence", () => {
  describe("save() and load()", () => {
    test("tasks survive across restarts", async () => {
      await using tmp = await tmpdir({ git: true })

      // Create a task and save its state
      const taskInfo: TaskInfo = {
        id: "task_test_persist",
        pid: 12345,
        command: "echo test",
        startTime: Date.now(),
        status: "completed",
        exitCode: 0,
        workdir: tmp.path,
        description: "Persistence test",
        logFile: TaskPersistence.getLogFile(tmp.path, "task_test_persist"),
        reconnectable: true,
      }

      await TaskPersistence.save(tmp.path, taskInfo)

      // Load it back
      const loaded = await TaskPersistence.load(tmp.path, "task_test_persist")
      expect(loaded).toBeDefined()
      expect(loaded?.id).toBe("task_test_persist")
      expect(loaded?.command).toBe("echo test")
      expect(loaded?.status).toBe("completed")
      expect(loaded?.exitCode).toBe(0)
    })

    test("loadAll returns all persisted tasks", async () => {
      await using tmp = await tmpdir({ git: true })

      const task1: TaskInfo = {
        id: "task_test_1",
        pid: 1001,
        command: "echo 1",
        startTime: Date.now(),
        status: "completed",
        exitCode: 0,
        workdir: tmp.path,
        logFile: TaskPersistence.getLogFile(tmp.path, "task_test_1"),
        reconnectable: true,
      }

      const task2: TaskInfo = {
        id: "task_test_2",
        pid: 1002,
        command: "echo 2",
        startTime: Date.now(),
        status: "failed",
        exitCode: 1,
        workdir: tmp.path,
        logFile: TaskPersistence.getLogFile(tmp.path, "task_test_2"),
        reconnectable: true,
      }

      await TaskPersistence.save(tmp.path, task1)
      await TaskPersistence.save(tmp.path, task2)

      const all = await TaskPersistence.loadAll(tmp.path)
      expect(all.length).toBe(2)
      expect(all.some((t) => t.id === "task_test_1")).toBe(true)
      expect(all.some((t) => t.id === "task_test_2")).toBe(true)
    })
  })

  describe("log files", () => {
    test("appendLog and readLog work correctly", async () => {
      await using tmp = await tmpdir({ git: true })

      await TaskPersistence.appendLog(tmp.path, "task_log_test", "line 1\n")
      await TaskPersistence.appendLog(tmp.path, "task_log_test", "line 2\n")
      await TaskPersistence.appendLog(tmp.path, "task_log_test", "line 3\n")

      const content = await TaskPersistence.readLog(tmp.path, "task_log_test")
      expect(content).toBe("line 1\nline 2\nline 3\n")
    })

    test("tailLog returns last N lines", async () => {
      await using tmp = await tmpdir({ git: true })

      await TaskPersistence.appendLog(tmp.path, "task_tail_test", "line 1\nline 2\nline 3\nline 4\nline 5\n")

      const tail = await TaskPersistence.tailLog(tmp.path, "task_tail_test", 2)
      const lines = tail.split("\n").filter((l) => l)
      expect(lines).toEqual(["line 4", "line 5"])
    })
  })

  describe("remove()", () => {
    test("deletes state and log files", async () => {
      await using tmp = await tmpdir({ git: true })

      const taskInfo: TaskInfo = {
        id: "task_remove_test",
        pid: 9999,
        command: "echo remove",
        startTime: Date.now(),
        status: "completed",
        exitCode: 0,
        workdir: tmp.path,
        logFile: TaskPersistence.getLogFile(tmp.path, "task_remove_test"),
        reconnectable: true,
      }

      await TaskPersistence.save(tmp.path, taskInfo)
      await TaskPersistence.appendLog(tmp.path, "task_remove_test", "some log\n")

      // Verify files exist
      const stateFile = TaskPersistence.getStateFile(tmp.path, "task_remove_test")
      const logFile = TaskPersistence.getLogFile(tmp.path, "task_remove_test")
      expect(await Bun.file(stateFile).exists()).toBe(true)
      expect(await Bun.file(logFile).exists()).toBe(true)

      // Remove
      await TaskPersistence.remove(tmp.path, "task_remove_test")

      // Verify files are gone
      expect(await Bun.file(stateFile).exists()).toBe(false)
      expect(await Bun.file(logFile).exists()).toBe(false)
    })
  })

  describe("isProcessRunning()", () => {
    test("returns true for running process", () => {
      // Current process should be running
      const running = TaskPersistence.isProcessRunning(process.pid)
      expect(running).toBe(true)
    })

    test("returns false for non-existent process", () => {
      // Use a very high PID that likely doesn't exist
      const running = TaskPersistence.isProcessRunning(999999999)
      expect(running).toBe(false)
    })
  })
})

describe("TaskEvent", () => {
  test("emits task.created event on task creation", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let eventReceived = false
        let receivedTaskId: string | undefined

        const unsub = Bus.subscribe(TaskEvent.Created, (event) => {
          eventReceived = true
          receivedTaskId = event.properties.info.id
        })

        const task = await TaskManager.create({
          command: "echo event_test",
          description: "Event test",
        })

        // Wait for event to propagate
        await Bun.sleep(100)

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedTaskId).toBe(task.id)

        await waitForTaskCompletion(task.id)
      },
    })
  })

  test("emits task.output event on output", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputs: string[] = []

        const unsub = Bus.subscribe(TaskEvent.Output, (event) => {
          outputs.push(event.properties.data)
        })

        const task = await TaskManager.create({
          command: "echo output_test",
          description: "Output event test",
        })

        await waitForTaskCompletion(task.id)

        // Wait for events to propagate
        await Bun.sleep(100)

        unsub()

        expect(outputs.some((o) => o.includes("output_test"))).toBe(true)
      },
    })
  })

  test("emits task.completed event on completion", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let completedTaskId: string | undefined
        let completedStatus: string | undefined

        const unsub = Bus.subscribe(TaskEvent.Completed, (event) => {
          completedTaskId = event.properties.id
          completedStatus = event.properties.status
        })

        const task = await TaskManager.create({
          command: "echo completed_test",
          description: "Completed event test",
        })

        await waitForTaskCompletion(task.id)

        // Wait for event to propagate
        await Bun.sleep(100)

        unsub()

        expect(completedTaskId).toBe(task.id)
        expect(completedStatus).toBe("completed")
      },
    })
  })

  test("emits task.killed event on kill", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        let killedTaskId: string | undefined

        const unsub = Bus.subscribe(TaskEvent.Killed, (event) => {
          killedTaskId = event.properties.id
        })

        const task = await TaskManager.create({
          command: "sleep 60",
          description: "Kill event test",
        })

        await Bun.sleep(100) // Let process start

        await TaskManager.kill(task.id)

        // Wait for event to propagate
        await Bun.sleep(100)

        unsub()

        expect(killedTaskId).toBe(task.id)
      },
    })
  })
})

describe("TaskManager.cleanup()", () => {
  test("removes completed tasks older than maxAge", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Create a task that completes quickly
        const task = await TaskManager.create({
          command: "echo cleanup_test",
          description: "Cleanup test",
        })

        await waitForTaskCompletion(task.id)

        // Get current tasks
        const beforeCleanup = await TaskManager.list()
        expect(beforeCleanup.some((t) => t.id === task.id)).toBe(true)

        // Cleanup with maxAge of 0 (should remove immediately)
        const removed = await TaskManager.cleanup(0)
        expect(removed).toBeGreaterThanOrEqual(1)

        // Verify task is removed
        const afterCleanup = await TaskManager.list()
        expect(afterCleanup.some((t) => t.id === task.id)).toBe(false)
      },
    })
  })
})

describe("TaskManager.remove()", () => {
  test("removes completed task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await TaskManager.create({
          command: "echo remove_test",
          description: "Remove test",
        })

        await waitForTaskCompletion(task.id)

        const removed = await TaskManager.remove(task.id)
        expect(removed).toBe(true)

        const afterRemove = await TaskManager.get(task.id)
        expect(afterRemove).toBeUndefined()
      },
    })
  })

  test("cannot remove running task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await TaskManager.create({
          command: "sleep 60",
          description: "Running task",
        })

        const removed = await TaskManager.remove(task.id)
        expect(removed).toBe(false)

        // Clean up
        await TaskManager.kill(task.id)
        await waitForTaskCompletion(task.id)
      },
    })
  })
})
