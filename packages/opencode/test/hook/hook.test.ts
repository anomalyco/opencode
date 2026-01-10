import { test, expect, beforeEach, afterEach } from "bun:test"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Hook } from "../../src/hook"
import { Instance } from "../../src/project/instance"
import { PermissionNext } from "../../src/permission/next"
import { Question } from "../../src/question"
import { SessionStatus } from "../../src/session/status"
import { tmpdir } from "../fixture/fixture"
import path from "path"
import fs from "fs/promises"

// Helper to wait for async operations
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Test hook that writes to a file instead of showing notifications
async function createTestHook(dir: string, filename: string) {
  const scriptPath = path.join(dir, `test-hook-${filename}.sh`)
  const outputPath = path.join(dir, filename)
  await fs.writeFile(
    scriptPath,
    `#!/bin/bash
echo "SESSION_ID=$SESSION_ID" >> "${outputPath}"
echo "INPUT_TYPE=$INPUT_TYPE" >> "${outputPath}"
echo "PERMISSION_NAME=$PERMISSION_NAME" >> "${outputPath}"
echo "QUESTION_HEADER=$QUESTION_HEADER" >> "${outputPath}"
echo "---" >> "${outputPath}"
`,
  )
  await fs.chmod(scriptPath, 0o755)
  return { scriptPath, outputPath }
}

async function readHookOutput(outputPath: string): Promise<string[]> {
  const content = await fs.readFile(outputPath, "utf-8").catch(() => "")
  return content.split("---\n").filter(Boolean)
}

beforeEach(() => {
  Hook._test.reset()
})

afterEach(() => {
  Hook._test.reset()
})

test("session_completed hook triggers on busy -> idle transition", async () => {
  await using tmp = await tmpdir({ git: true })
  const { scriptPath, outputPath } = await createTestHook(tmp.path, "session-completed.txt")

  // Write config before Instance.provide
  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      experimental: {
        hook: {
          session_completed: [{ command: [scriptPath] }],
        },
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Pre-load config to avoid slow first load during hook execution
      await Config.get()

      Hook.init()

      // Simulate busy -> idle transition
      SessionStatus.set("session_test1", { type: "busy" })
      SessionStatus.set("session_test1", { type: "idle" })

      // Wait for hook to execute (config loading + execution)
      await sleep(1500)

      const outputs = await readHookOutput(outputPath)
      expect(outputs.length).toBe(1)
      expect(outputs[0]).toContain("SESSION_ID=session_test1")
      expect(outputs[0]).toContain("INPUT_TYPE=")
    },
  })
})

test("session_completed hook does not trigger on idle -> idle", async () => {
  await using tmp = await tmpdir({ git: true })
  const { scriptPath, outputPath } = await createTestHook(tmp.path, "no-trigger.txt")

  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      experimental: {
        hook: {
          session_completed: [{ command: [scriptPath] }],
        },
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Config.get()
      Hook.init()

      // Only idle events (no busy first)
      SessionStatus.set("session_test2", { type: "idle" })
      SessionStatus.set("session_test2", { type: "idle" })

      await sleep(500)

      const outputs = await readHookOutput(outputPath)
      expect(outputs.length).toBe(0)
    },
  })
})

test("input_required hook triggers on permission.asked", async () => {
  await using tmp = await tmpdir({ git: true })
  const { scriptPath, outputPath } = await createTestHook(tmp.path, "permission.txt")

  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      experimental: {
        hook: {
          input_required: [{ command: [scriptPath] }],
        },
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Config.get()
      Hook.init()

      // Simulate permission.asked event
      Bus.publish(PermissionNext.Event.Asked, {
        id: "permission_test1",
        sessionID: "session_test3",
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
      })

      // Wait for hook to execute (leading throttle fires immediately)
      await sleep(1500)

      const outputs = await readHookOutput(outputPath)
      expect(outputs.length).toBe(1)
      expect(outputs[0]).toContain("SESSION_ID=session_test3")
      expect(outputs[0]).toContain("INPUT_TYPE=permission_required")
      expect(outputs[0]).toContain("PERMISSION_NAME=bash")
    },
  })
})

test("input_required hook triggers on question.asked", async () => {
  await using tmp = await tmpdir({ git: true })
  const { scriptPath, outputPath } = await createTestHook(tmp.path, "question.txt")

  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      experimental: {
        hook: {
          input_required: [{ command: [scriptPath] }],
        },
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Config.get()
      Hook.init()

      // Simulate question.asked event
      Bus.publish(Question.Event.Asked, {
        id: "question_test1",
        sessionID: "session_test4",
        questions: [{ question: "Which option?", header: "Choice", options: [] }],
      })

      // Wait for hook to execute
      await sleep(1500)

      const outputs = await readHookOutput(outputPath)
      expect(outputs.length).toBe(1)
      expect(outputs[0]).toContain("SESSION_ID=session_test4")
      expect(outputs[0]).toContain("INPUT_TYPE=question_asked")
      expect(outputs[0]).toContain("QUESTION_HEADER=Choice")
    },
  })
})

test("input_required hook throttles multiple rapid events (first wins)", async () => {
  await using tmp = await tmpdir({ git: true })
  const { scriptPath, outputPath } = await createTestHook(tmp.path, "throttle.txt")

  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      experimental: {
        hook: {
          input_required: [{ command: [scriptPath] }],
        },
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Config.get()
      Hook.init()

      // Rapid fire multiple permission events
      Bus.publish(PermissionNext.Event.Asked, {
        id: "permission_throttle1",
        sessionID: "session_test5",
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
      })

      await sleep(100)

      Bus.publish(PermissionNext.Event.Asked, {
        id: "permission_throttle2",
        sessionID: "session_test5",
        permission: "edit",
        patterns: ["foo.ts"],
        metadata: {},
        always: [],
      })

      await sleep(100)

      Bus.publish(PermissionNext.Event.Asked, {
        id: "permission_throttle3",
        sessionID: "session_test5",
        permission: "read",
        patterns: ["bar.ts"],
        metadata: {},
        always: [],
      })

      // Wait for hook to execute
      await sleep(1500)

      const outputs = await readHookOutput(outputPath)
      // Should only have ONE output due to throttle (first one wins)
      expect(outputs.length).toBe(1)
      expect(outputs[0]).toContain("PERMISSION_NAME=bash")
    },
  })
})

test("_test.reset clears all state", async () => {
  await using tmp = await tmpdir({ git: true })
  const { scriptPath, outputPath } = await createTestHook(tmp.path, "reset.txt")

  await Bun.write(
    path.join(tmp.path, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      experimental: {
        hook: {
          session_completed: [{ command: [scriptPath] }],
        },
      },
    }),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Config.get()
      Hook.init()

      // Set some state
      SessionStatus.set("session_reset1", { type: "busy" })

      // Reset
      Hook._test.reset()

      // Re-init after reset
      Hook.init()

      // This should NOT trigger because we don't have previous busy state recorded after reset
      SessionStatus.set("session_reset1", { type: "idle" })

      await sleep(500)

      const outputs = await readHookOutput(outputPath)
      expect(outputs.length).toBe(0)
    },
  })
})
