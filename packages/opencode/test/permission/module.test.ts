import { describe, expect, test } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { PermissionModule as PermissionModuleSchema } from "@opencode-ai/schema/permission-module"
import { Permission } from "../../src/permission"
import {
  PermissionModule,
  applySafety,
  parseClassifierResult,
  runClassifier,
  destructiveReason,
  MISSING_MODEL_MESSAGE,
} from "../../src/permission/module"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { testEffect } from "../lib/effect"
import { MessageID, SessionID } from "../../src/session/schema"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { TestConfig } from "../fixture/config"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

function stubModules(
  decide: (input: PermissionModule.DecideInput) => Effect.Effect<PermissionModule.Decision | PermissionModule.DecideResult>,
) {
  return Layer.succeed(
    PermissionModule.Service,
    PermissionModule.Service.of({
      decide: (input) => decide(input).pipe(Effect.map(PermissionModule.normalizeDecide)),
      register: () => Effect.void,
      registerSync: () => undefined,
      has: () => true,
    }),
  )
}

describe("permission modules", () => {
  test("fromConfig accepts cruise_control module action", () => {
    const result = Permission.fromConfig({ bash: "cruise_control" })
    expect(result).toEqual([{ permission: "bash", pattern: "*", action: "cruise_control" }])
  })

  test("migrate maps module action to ask + module", () => {
    const migrated = ConfigMigrateV1.migrate({
      permission: { bash: "cruise_control", edit: "ask" },
      permission_modules: {
        cruise_control: { model: "opencode/deepseek-v4-flash" },
      },
    })
    expect(migrated.permission_modules).toEqual({
      cruise_control: { model: "opencode/deepseek-v4-flash" },
    })
    expect(migrated.permissions).toContainEqual({
      action: "bash",
      resource: "*",
      effect: "ask",
      module: "cruise_control",
    })
    expect(migrated.permissions).toContainEqual({
      action: "edit",
      resource: "*",
      effect: "ask",
    })
  })

  test("isStaticAction rejects module ids", () => {
    expect(ConfigPermissionV1.isStaticAction("ask")).toBe(true)
    expect(ConfigPermissionV1.isStaticAction("cruise_control")).toBe(false)
  })
})

const allowEnv = AppNodeBuilder.build(
  LayerNode.group([
    Permission.node,
    PermissionModule.node,
    EventV2Bridge.node,
    CrossSpawnSpawner.node,
    InstanceStore.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [PermissionModule.node, stubModules(() => Effect.succeed("allow"))],
  ],
)

const denyEnv = AppNodeBuilder.build(
  LayerNode.group([
    Permission.node,
    PermissionModule.node,
    EventV2Bridge.node,
    CrossSpawnSpawner.node,
    InstanceStore.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [PermissionModule.node, stubModules(() => Effect.succeed("deny"))],
  ],
)

const askEnv = AppNodeBuilder.build(
  LayerNode.group([
    Permission.node,
    PermissionModule.node,
    EventV2Bridge.node,
    CrossSpawnSpawner.node,
    InstanceStore.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [PermissionModule.node, stubModules(() => Effect.succeed("ask"))],
  ],
)

const itAllow = testEffect(allowEnv)
const itDeny = testEffect(denyEnv)
const itAsk = testEffect(askEnv)

itAllow.instance("cruise_control allow skips human ask", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    yield* permission.ask({
      sessionID: SessionID.make("ses_module_allow"),
      permission: "bash",
      patterns: ["ls"],
      metadata: {},
      always: ["ls"],
      ruleset: Permission.fromConfig({ bash: PermissionModuleSchema.CRUISE_CONTROL }),
      tool: { messageID: MessageID.make("msg_module_allow"), callID: "call_1" },
    })
    expect(yield* permission.list()).toEqual([])
  }),
)

itDeny.instance("cruise_control deny fails closed", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const result = yield* permission
      .ask({
        sessionID: SessionID.make("ses_module_deny"),
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {},
        always: [],
        ruleset: Permission.fromConfig({ bash: PermissionModuleSchema.CRUISE_CONTROL }),
      })
      .pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
  }),
)

itAsk.instance("cruise_control ask publishes pending request", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const fiber = yield* permission
      .ask({
        sessionID: SessionID.make("ses_module_ask"),
        permission: "bash",
        patterns: ["npm install"],
        metadata: {},
        always: ["npm install"],
        ruleset: Permission.fromConfig({ bash: PermissionModuleSchema.CRUISE_CONTROL }),
      })
      .pipe(Effect.forkChild)

    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () => Effect.fail(new Error("timed out waiting for pending ask")),
      }),
    )

    expect(pending[0]?.permission).toBe("bash")
    yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })
    yield* Fiber.join(fiber)
  }),
)

const askReasonEnv = AppNodeBuilder.build(
  LayerNode.group([
    Permission.node,
    PermissionModule.node,
    EventV2Bridge.node,
    CrossSpawnSpawner.node,
    InstanceStore.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [
      PermissionModule.node,
      stubModules(() => Effect.succeed({ decision: "ask" as const, reason: "network install needs review" })),
    ],
  ],
)

const itAskReason = testEffect(askReasonEnv)

itAskReason.instance("cruise_control ask attaches classifier reason to metadata", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const fiber = yield* permission
      .ask({
        sessionID: SessionID.make("ses_module_ask_reason"),
        permission: "bash",
        patterns: ["npm install"],
        metadata: {},
        always: ["npm install"],
        ruleset: Permission.fromConfig({ bash: PermissionModuleSchema.CRUISE_CONTROL }),
      })
      .pipe(Effect.forkChild)

    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () => Effect.fail(new Error("timed out waiting for pending ask")),
      }),
    )

    expect(pending[0]?.metadata?.reason).toBe("network install needs review")
    yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })
    yield* Fiber.join(fiber)
  }),
)

const allowReasonEnv = AppNodeBuilder.build(
  LayerNode.group([
    Permission.node,
    PermissionModule.node,
    EventV2Bridge.node,
    CrossSpawnSpawner.node,
    InstanceStore.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [
      PermissionModule.node,
      stubModules(() => Effect.succeed({ decision: "allow" as const, reason: "safe read-only command" })),
    ],
  ],
)

const itAllowReason = testEffect(allowReasonEnv)

itAllowReason.instance("cruise_control allow returns conclusion", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const result = yield* permission.ask({
      sessionID: SessionID.make("ses_module_allow_reason"),
      permission: "bash",
      patterns: ["ls"],
      metadata: {},
      always: ["ls"],
      ruleset: Permission.fromConfig({ bash: PermissionModuleSchema.CRUISE_CONTROL }),
      tool: { messageID: MessageID.make("msg_module_allow_reason"), callID: "call_allow_reason" },
    })
    expect(result.conclusion).toBe("safe read-only command")
    expect(yield* permission.list()).toEqual([])
  }),
)

const denyReasonEnv = AppNodeBuilder.build(
  LayerNode.group([
    Permission.node,
    PermissionModule.node,
    EventV2Bridge.node,
    CrossSpawnSpawner.node,
    InstanceStore.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [
      PermissionModule.node,
      stubModules(() =>
        Effect.succeed({ decision: "deny" as const, reason: "Recursive force delete (rm -rf) is blocked" }),
      ),
    ],
  ],
)

const itDenyReason = testEffect(denyReasonEnv)

itDenyReason.instance("cruise_control deny surfaces reason on DeniedError", () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const blocked = yield* permission
      .ask({
        sessionID: SessionID.make("ses_module_deny_reason"),
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {},
        always: [],
        ruleset: Permission.fromConfig({ bash: PermissionModuleSchema.CRUISE_CONTROL }),
      })
      .pipe(Effect.flip)
    expect(blocked).toBeInstanceOf(PermissionV1.DeniedError)
    expect(blocked.message).toBe("Recursive force delete (rm -rf) is blocked")
  }),
)

const missingModelEnv = AppNodeBuilder.build(
  LayerNode.group([
    Permission.node,
    PermissionModule.node,
    EventV2Bridge.node,
    CrossSpawnSpawner.node,
    InstanceStore.node,
  ]),
  [
    [InstanceStore.bootstrapNode, noopBootstrap],
    [Config.node, TestConfig.layer()],
    [Provider.node, Layer.mock(Provider.Service, {})],
  ],
)

const itMissingModel = testEffect(missingModelEnv)

itMissingModel.instance("missing cruise_control model asks with configure warning", () =>
  Effect.gen(function* () {
    const modules = yield* PermissionModule.Service
    expect(
      yield* modules.decide({
        moduleID: PermissionModuleSchema.CRUISE_CONTROL,
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
      }),
    ).toEqual({ decision: "ask", reason: MISSING_MODEL_MESSAGE })

    const permission = yield* Permission.Service
    const fiber = yield* permission
      .ask({
        sessionID: SessionID.make("ses_module_missing_model"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: ["ls"],
        ruleset: Permission.fromConfig({ "*": PermissionModuleSchema.CRUISE_CONTROL }),
      })
      .pipe(Effect.forkChild)

    const pending = yield* Effect.gen(function* () {
      while (true) {
        const list = yield* permission.list()
        if (list.length === 1) return list
        yield* Effect.sleep("10 millis")
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () => Effect.fail(new Error("timed out waiting for pending ask")),
      }),
    )

    expect(pending[0]?.permission).toBe("bash")
    expect(pending[0]?.metadata?.warning).toBe(MISSING_MODEL_MESSAGE)
    yield* permission.reply({ requestID: pending[0]!.id, reply: "once" })
    yield* Fiber.join(fiber)
  }),
)

describe("classifier contract", () => {
  test("parseClassifierResult accepts missing reason and fences", () => {
    expect(parseClassifierResult({ decision: "allow" })).toEqual({ decision: "allow", reason: "" })
    expect(parseClassifierResult({ decision: "ALLOW", reason: "safe" })).toEqual({
      decision: "allow",
      reason: "safe",
    })
    expect(parseClassifierResult('```json\n{"decision":"deny","reason":"risky"}\n```')).toEqual({
      decision: "deny",
      reason: "risky",
    })
    expect(parseClassifierResult({ action: "ask" })).toEqual({ decision: "ask", reason: "" })
    expect(parseClassifierResult({ decision: "maybe" })).toBeUndefined()
    expect(parseClassifierResult("not json")).toBeUndefined()
  })

  test("destructiveReason matches rm -rf and SQL drops", () => {
    expect(destructiveReason("bash", ["rm -rf /tmp/foo"])).toBe("Recursive force delete (rm -rf) is blocked")
    expect(destructiveReason("bash", ["rm -fr ./build"])).toBe("Recursive force delete (rm -rf) is blocked")
    expect(destructiveReason("bash", ["rm -r -f nest"])).toBe("Recursive force delete (rm -rf) is blocked")
    expect(destructiveReason("bash", ["DROP DATABASE prod"])).toBe("DROP DATABASE is blocked")
    expect(destructiveReason("bash", ["truncate table users"])).toBe("TRUNCATE TABLE is blocked")
    expect(destructiveReason("bash", ["echo hello"])).toBeUndefined()
    expect(destructiveReason("bash", ["rm file.txt"])).toBeUndefined()
  })

  test("valid allow passes allowlist safety", () => {
    expect(
      applySafety("allow", "bash", {
        fallback: "deny",
        allowlist: ["bash"],
      }),
    ).toBe("allow")
  })

  test("valid allow without allowlist asks instead of denying", () => {
    expect(applySafety("allow", "bash", { fallback: "deny", allowlist: [] })).toBe("ask")
  })

  test("omitted allowlist uses defaults and can auto-allow bash", () => {
    expect(applySafety("allow", "bash", { fallback: "deny" })).toBe("allow")
  })

  test("never_auto escalates allow to ask", () => {
    expect(applySafety("allow", "external_directory", { allowlist: ["external_directory"] })).toBe("ask")
  })

  test("valid allow from classifier", async () => {
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "deny", allowlist: ["bash"], timeout_ms: 1000 },
        classify: Effect.succeed({ decision: "allow", reason: "safe read-only command" }),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(outcome).toEqual({ decision: "allow", reason: "safe read-only command" })
  })

  test("destructive patterns deny without calling classifier", async () => {
    let called = false
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["rm -rf /"],
        opts: { fallback: "ask", allowlist: ["bash"], timeout_ms: 1000 },
        classify: Effect.sync(() => {
          called = true
          return { decision: "allow" as const, reason: "should not run" }
        }),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(called).toBe(false)
    expect(outcome).toEqual({
      decision: "deny",
      reason: "Recursive force delete (rm -rf) is blocked",
    })
  })

  test("invalid classifier output uses fallback", async () => {
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "ask", allowlist: ["bash"], timeout_ms: 1000 },
        classify: Effect.fail(new Error("invalid JSON")),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(outcome.decision).toBe("ask")
    expect(outcome.reason).toContain("Classifier unavailable")
  })

  test("timeout uses fallback and never allows", async () => {
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "deny", allowlist: ["bash"], timeout_ms: 20 },
        classify: Effect.sleep("1 second").pipe(Effect.as({ decision: "allow" as const, reason: "late" })),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(outcome.decision).toBe("deny")
  })

  test("timeout defaults to ask when fallback unset", async () => {
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { allowlist: ["bash"], timeout_ms: 20 },
        classify: Effect.sleep("1 second").pipe(Effect.as({ decision: "allow" as const, reason: "late" })),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(outcome.decision).toBe("ask")
  })
})
