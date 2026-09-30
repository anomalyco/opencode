import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionID } from "@opencode-ai/schema/session-id"
import path from "path"
import { Permission } from "../src/permission"
import { Sandbox } from "../src/permission/sandbox"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "./lib/effect"
import { provideTmpdirInstance } from "./fixture/fixture"

const it = testEffect(Layer.mergeAll(LayerNode.compile(Permission.node), LayerNode.compile(CrossSpawnSpawner.node)))

const sessionID = SessionID.make("ses_actions")

const ALLOW: PermissionV1.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

function request(
  permission: string,
  patterns: string[],
  options?: {
    command?: string
    ruleset?: PermissionV1.Ruleset
    metadata?: PermissionV1.Request["metadata"]
  },
): Permission.AskInput {
  return {
    sessionID,
    permission,
    patterns,
    metadata: { ...options?.metadata, ...(options?.command ? { command: options.command } : {}) },
    always: patterns,
    ruleset: options?.ruleset ?? ALLOW,
  }
}

function pendingFor(permission: Permission.Interface, name: string) {
  return pollWithTimeout(
    Effect.gen(function* () {
      const list = yield* permission.list()
      return list.find((item) => item.permission === name)
    }),
    `pending confirmation for ${name} not published`,
    "15 seconds",
  )
}

describe("permission action gates", () => {
  it.live("an allow ruleset still confirms destructive commands through the guard", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const fiber = yield* permission
          .ask(request("bash", ["rm -rf dist"], { command: "rm -rf dist" }))
          .pipe(Effect.forkChild)
        const pending = yield* pendingFor(permission, "bash")
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        const action = yield* awaitWithTimeout(Fiber.join(fiber), "ask should finish after the reply")
        expect(action).toBe("allow")
      }),
    ),
  )

  it.live("a benign command passes without confirmation when nothing is configured", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        yield* awaitWithTimeout(
          permission.ask(request("bash", ["git status"], { command: "git status" })),
          "benign command should not confirm",
          "15 seconds",
        )
      }),
    ),
  )

  it.live("trusted-command bypasses the guard", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const action = yield* awaitWithTimeout(
          permission.ask(
            request("bash", ["rm -rf dist"], {
              command: "rm -rf dist",
              ruleset: [{ permission: "bash", pattern: "*", action: "trusted-command" }],
            }),
          ),
          "trusted command should not confirm",
          "15 seconds",
        )
        expect(action).toBe("allow")
      }),
    ),
  )

  it.live("trusted-domain bypasses confirmation for network tools", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const action = yield* awaitWithTimeout(
          permission.ask(
            request("webfetch", ["https://example.com"], {
              ruleset: [{ permission: "webfetch", pattern: "*", action: "trusted-domain" }],
            }),
          ),
          "trusted domain should not confirm",
          "15 seconds",
        )
        expect(action).toBe("allow")
      }),
    ),
  )

  it.live("an always approval never re-confirms the same command", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const fiber = yield* permission
          .ask(request("bash", ["rm -rf dist"], { command: "rm -rf dist" }))
          .pipe(Effect.forkChild)
        const pending = yield* pendingFor(permission, "bash")
        yield* permission.reply({ requestID: pending.id, reply: "always" })
        yield* awaitWithTimeout(Fiber.join(fiber), "first ask should finish after the reply")
        yield* awaitWithTimeout(
          permission.ask(request("bash", ["rm -rf dist"], { command: "rm -rf dist" })),
          "approved command must not confirm again",
          "15 seconds",
        )
      }),
    ),
  )

  it.live("read-only rules confirm commands that are not read-only", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const ruleset: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "read-only" }]
        yield* awaitWithTimeout(
          permission.ask(request("bash", ["ls"], { command: "ls", ruleset })),
          "a read-only command should pass",
          "15 seconds",
        )
        const fiber = yield* permission
          .ask(request("bash", ["mkdir out"], { command: "mkdir out", ruleset }))
          .pipe(Effect.forkChild)
        const pending = yield* pendingFor(permission, "bash")
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        yield* awaitWithTimeout(Fiber.join(fiber), "a write command should finish after the reply")
      }),
    ),
  )

  it.live("isolated-workspace confirms paths outside the workspace", () =>
    provideTmpdirInstance((directory) =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const ruleset: PermissionV1.Ruleset = [{ permission: "read", pattern: "*", action: "isolated-workspace" }]
        yield* awaitWithTimeout(
          permission.ask(
            request("read", ["src/a.ts"], {
              ruleset,
              metadata: { filepath: path.join(directory, "src", "a.ts") },
            }),
          ),
          "a workspace path should pass",
          "15 seconds",
        )
        const fiber = yield* permission
          .ask(
            request("read", ["../outside.txt"], {
              ruleset,
              metadata: { filepath: path.join(directory, "..", "outside.txt") },
            }),
          )
          .pipe(Effect.forkChild)
        const pending = yield* pendingFor(permission, "read")
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        yield* awaitWithTimeout(Fiber.join(fiber), "an outside path should finish after the reply")
      }),
    ),
  )

  it.live("restricted-network denies network tools outright", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const exit = yield* Effect.exit(
          permission.ask(
            request("webfetch", ["https://example.com"], {
              ruleset: [{ permission: "webfetch", pattern: "*", action: "restricted-network" }],
            }),
          ),
        )
        expect(Exit.isSuccess(exit)).toBe(false)
      }),
    ),
  )

  it.live("a deny rule wins over every allow", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const exit = yield* Effect.exit(
          permission.ask(request("bash", ["ls"], { ruleset: [{ permission: "bash", pattern: "*", action: "deny" }] })),
        )
        expect(Exit.isSuccess(exit)).toBe(false)
      }),
    ),
  )

  it.live("a sandbox rule enforces the sandbox or confirms it as unenforced", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const permission = yield* Permission.Service
        const ruleset: PermissionV1.Ruleset = [{ permission: "bash", pattern: "*", action: "sandbox" }]
        if (Sandbox.availability().mechanism !== "none") {
          const action = yield* awaitWithTimeout(
            permission.ask(request("bash", ["ls"], { command: "ls", ruleset })),
            "a sandboxed command should run in the sandbox",
            "15 seconds",
          )
          expect(action).toBe("sandbox")
          return
        }
        const fiber = yield* permission.ask(request("bash", ["ls"], { command: "ls", ruleset })).pipe(Effect.forkChild)
        const pending = yield* pendingFor(permission, "bash")
        expect(pending.metadata.sandbox).toBe("unavailable")
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        const action = yield* awaitWithTimeout(Fiber.join(fiber), "ask should finish after the reply")
        expect(action).toBe("allow")
      }),
    ),
  )
})
