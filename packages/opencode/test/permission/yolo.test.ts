import { afterEach, beforeEach, test, expect } from "bun:test"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID } from "../../src/session/schema"

let savedYolo: string | undefined

beforeEach(() => {
  savedYolo = process.env.OPENCODE_YOLO
})

afterEach(async () => {
  if (savedYolo === undefined) {
    delete process.env.OPENCODE_YOLO
  } else {
    process.env.OPENCODE_YOLO = savedYolo
  }
  await Instance.disposeAll()
})

test("yolo - auto-approves when OPENCODE_YOLO=1 and rules say ask", async () => {
  process.env.OPENCODE_YOLO = "1"
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // With yolo, even "ask" rules should auto-approve (return undefined)
      const result = await Permission.ask({
        sessionID: SessionID.make("session_yolo"),
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "ask" }],
      })
      expect(result).toBeUndefined()
    },
  })
})

test("yolo - auto-approves when OPENCODE_YOLO=1 and rules say deny", async () => {
  process.env.OPENCODE_YOLO = "1"
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // With yolo, even "deny" rules should be bypassed
      const result = await Permission.ask({
        sessionID: SessionID.make("session_yolo"),
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
      })
      expect(result).toBeUndefined()
    },
  })
})

test("yolo - does not auto-approve when OPENCODE_YOLO is unset", async () => {
  delete process.env.OPENCODE_YOLO
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Without yolo, "deny" rules should throw DeniedError
      await expect(
        Permission.ask({
          sessionID: SessionID.make("session_no_yolo"),
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
        }),
      ).rejects.toBeInstanceOf(Permission.DeniedError)
    },
  })
})

test("yolo - no pending requests created when OPENCODE_YOLO=1", async () => {
  process.env.OPENCODE_YOLO = "1"
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Permission.ask({
        sessionID: SessionID.make("session_yolo_pending"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      })
      // No pending requests should have been created
      const list = await Permission.list()
      expect(list).toHaveLength(0)
    },
  })
})

test("yolo - OPENCODE_YOLO=true also works", async () => {
  process.env.OPENCODE_YOLO = "true"
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await Permission.ask({
        sessionID: SessionID.make("session_yolo_true"),
        permission: "edit",
        patterns: ["/etc/passwd"],
        metadata: {},
        always: [],
        ruleset: [{ permission: "edit", pattern: "*", action: "ask" }],
      })
      expect(result).toBeUndefined()
    },
  })
})

test("yolo - OPENCODE_YOLO=0 does not auto-approve", async () => {
  process.env.OPENCODE_YOLO = "0"
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(
        Permission.ask({
          sessionID: SessionID.make("session_yolo_zero"),
          permission: "bash",
          patterns: ["rm -rf /"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "bash", pattern: "*", action: "deny" }],
        }),
      ).rejects.toBeInstanceOf(Permission.DeniedError)
    },
  })
})
