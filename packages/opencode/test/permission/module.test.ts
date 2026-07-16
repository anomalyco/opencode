import { describe, expect, test } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { PermissionModule as PermissionModuleSchema } from "@opencode-ai/schema/permission-module"
import { Permission } from "../../src/permission"
import { PermissionModule } from "../../src/permission/module"
import {
  applySafety,
  CLASSIFIER_PREAMBLE,
  decideCruiseControl,
  DEFAULT_INSTRUCTIONS,
  ensureDefaultInstructions,
  hasCompleteInstructions,
  mergeInstructionsDefaults,
  parseClassifierResult,
  renderSystemPrompt,
  resolveInstructions,
  resolveSystemPrompt,
  runClassifier,
  destructiveReason,
  managedAppDirectoryAllow,
  isManagedAppDirectoryPattern,
  MISSING_MODEL_MESSAGE,
} from "../../src/plugin/cruise-control/classifier"
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
    Config.node,
    Provider.node,
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
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    modules.registerSync({
      id: PermissionModuleSchema.CRUISE_CONTROL,
      decide: (input) =>
        decideCruiseControl(input).pipe(
          Effect.provideService(Config.Service, config),
          Effect.provideService(Provider.Service, provider),
        ),
    })
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
  test("resolveInstructions fills missing sections from defaults", () => {
    expect(resolveInstructions(undefined)).toEqual(DEFAULT_INSTRUCTIONS)
    expect(resolveInstructions({})).toEqual(DEFAULT_INSTRUCTIONS)
    expect(resolveInstructions({ instructions: { allow: ["Custom allow."] } })).toEqual({
      background: DEFAULT_INSTRUCTIONS.background,
      allow: ["Custom allow."],
      conditional: DEFAULT_INSTRUCTIONS.conditional,
      deny: DEFAULT_INSTRUCTIONS.deny,
    })
    expect(resolveInstructions({ instructions: { allow: [] } }).allow).toEqual([])
  })

  test("resolveSystemPrompt renders preamble and instruction sections", () => {
    const prompt = resolveSystemPrompt(undefined)
    expect(prompt.startsWith(CLASSIFIER_PREAMBLE)).toBe(true)
    expect(prompt).toContain("## Background")
    expect(prompt).toContain("## Allow")
    expect(prompt).toContain("## Conditional")
    expect(prompt).toContain("## Deny")
    expect(prompt).toContain(DEFAULT_INSTRUCTIONS.background[0]!)
    expect(prompt).toContain('"decision":"allow"|"deny"')
    expect(prompt).not.toContain("|\"ask\"")
  })

  test("renderSystemPrompt includes custom instruction lines", () => {
    const prompt = renderSystemPrompt({
      background: ["Custom background."],
      allow: ["Custom allow."],
      conditional: ["Custom conditional."],
      deny: ["Custom deny."],
    })
    expect(prompt).toContain("- Custom background.")
    expect(prompt).toContain("- Custom allow.")
    expect(prompt).toContain("- Custom conditional.")
    expect(prompt).toContain("- Custom deny.")
  })

  test("hasCompleteInstructions requires all four sections", () => {
    expect(hasCompleteInstructions(undefined)).toBe(false)
    expect(hasCompleteInstructions({})).toBe(false)
    expect(hasCompleteInstructions({ instructions: { allow: [] } })).toBe(false)
    expect(
      hasCompleteInstructions({
        instructions: { background: [], allow: [], conditional: [], deny: [] },
      }),
    ).toBe(true)
  })

  test("mergeInstructionsDefaults seeds missing sections only", () => {
    expect(mergeInstructionsDefaults(undefined)).toEqual(DEFAULT_INSTRUCTIONS)
    expect(mergeInstructionsDefaults({ allow: ["Keep me."] })).toEqual({
      background: DEFAULT_INSTRUCTIONS.background,
      allow: ["Keep me."],
      conditional: DEFAULT_INSTRUCTIONS.conditional,
      deny: DEFAULT_INSTRUCTIONS.deny,
    })
    expect(
      mergeInstructionsDefaults({
        background: [],
        allow: ["Keep."],
        conditional: DEFAULT_INSTRUCTIONS.conditional,
        deny: DEFAULT_INSTRUCTIONS.deny,
      }),
    ).toBeUndefined()
  })

  test("ensureDefaultInstructions writes defaults when unset", async () => {
    const patches: unknown[] = []
    await Effect.runPromise(
      ensureDefaultInstructions().pipe(
        Effect.provide(
          TestConfig.layer({
            getGlobal: () => Effect.succeed({}),
            updateGlobal: (config) => {
              patches.push(config)
              return Effect.succeed({ info: config, changed: true })
            },
          }),
        ),
      ),
    )
    expect(patches).toEqual([
      {
        permission_modules: {
          cruise_control: { instructions: DEFAULT_INSTRUCTIONS },
        },
      },
    ])
  })

  test("ensureDefaultInstructions fills only missing sections", async () => {
    const patches: unknown[] = []
    await Effect.runPromise(
      ensureDefaultInstructions().pipe(
        Effect.provide(
          TestConfig.layer({
            getGlobal: () =>
              Effect.succeed({
                permission_modules: {
                  cruise_control: {
                    model: "opencode/deepseek-v4-flash",
                    instructions: { allow: ["User allow rule."] },
                  },
                },
              }),
            updateGlobal: (config) => {
              patches.push(config)
              return Effect.succeed({ info: config, changed: true })
            },
          }),
        ),
      ),
    )
    expect(patches).toEqual([
      {
        permission_modules: {
          cruise_control: {
            instructions: {
              background: DEFAULT_INSTRUCTIONS.background,
              allow: ["User allow rule."],
              conditional: DEFAULT_INSTRUCTIONS.conditional,
              deny: DEFAULT_INSTRUCTIONS.deny,
            },
          },
        },
      },
    ])
  })

  test("ensureDefaultInstructions does not overwrite complete instructions", async () => {
    const patches: unknown[] = []
    const custom = {
      background: ["Custom background."],
      allow: [],
      conditional: ["Custom conditional."],
      deny: ["Custom deny."],
    }
    const result = await Effect.runPromise(
      ensureDefaultInstructions().pipe(
        Effect.provide(
          TestConfig.layer({
            getGlobal: () =>
              Effect.succeed({
                permission_modules: {
                  cruise_control: {
                    model: "opencode/deepseek-v4-flash",
                    instructions: custom,
                  },
                },
              }),
            updateGlobal: (config) => {
              patches.push(config)
              return Effect.succeed({ info: config, changed: true })
            },
          }),
        ),
      ),
    )
    expect(result).toEqual({ changed: false })
    expect(patches).toEqual([])
  })

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
    expect(parseClassifierResult({ action: "ask" })).toBeUndefined()
    expect(parseClassifierResult({ decision: "ask" })).toBeUndefined()
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

  test("managed KanCode config dir patterns are recognized", () => {
    const configGlob = path.join(Global.Path.config, "*")
    const configChild = path.join(Global.Path.config, "agents")
    const homeConfig = path.join(path.dirname(Global.Path.config), "*")
    expect(isManagedAppDirectoryPattern(configGlob)).toBe(true)
    expect(isManagedAppDirectoryPattern(configChild)).toBe(true)
    expect(isManagedAppDirectoryPattern(path.join(Global.Path.data, "db"))).toBe(true)
    expect(isManagedAppDirectoryPattern(homeConfig)).toBe(false)
    expect(isManagedAppDirectoryPattern("/some/other/path/*")).toBe(false)
    expect(managedAppDirectoryAllow("external_directory", [configGlob])).toBe(
      "KanCode managed app directory access is allowed",
    )
    expect(managedAppDirectoryAllow("external_directory", [homeConfig])).toBeUndefined()
    expect(managedAppDirectoryAllow("read", [configGlob])).toBeUndefined()
  })

  test("never_auto does not block managed app directory allow", () => {
    const configGlob = path.join(Global.Path.config, "*")
    expect(
      applySafety("allow", "external_directory", { allowlist: ["external_directory"] }, [configGlob]),
    ).toBe("allow")
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

  test("managed app directory allow skips classifier and never_auto", async () => {
    let called = false
    const configGlob = path.join(Global.Path.config, "*")
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "external_directory",
        patterns: [configGlob],
        opts: { fallback: "ask", allowlist: ["external_directory"], timeout_ms: 1000 },
        classify: Effect.sync(() => {
          called = true
          return { decision: "deny" as const, reason: "should not run" }
        }),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(called).toBe(false)
    expect(outcome).toEqual({
      decision: "allow",
      reason: "KanCode managed app directory access is allowed",
    })
  })

  test("safety rails replace allow-sounding reason when escalating external_directory", async () => {
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "external_directory",
        patterns: ["/some/other/path/*"],
        opts: { fallback: "ask", allowlist: ["external_directory"], timeout_ms: 1000 },
        classify: Effect.succeed({
          decision: "allow" as const,
          reason: "Access to user's own configuration directory for kancode is a standard, safe operation.",
        }),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(outcome).toEqual({
      decision: "ask",
      reason: "Requires approval (safety rails)",
    })
  })

  test("invalid classifier output uses fallback", async () => {
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "ask", allowlist: ["bash"], timeout_ms: 1000, retries: 1 },
        classify: Effect.fail(new Error("invalid JSON")),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(outcome.decision).toBe("ask")
    expect(outcome.reason).toBe("Classifier unavailable after 1 attempts; needs approval")
  })

  test("timeout uses fallback and never allows", async () => {
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "deny", allowlist: ["bash"], timeout_ms: 20, retries: 1 },
        classify: Effect.sleep("1 second").pipe(Effect.as({ decision: "allow" as const, reason: "late" })),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(outcome.decision).toBe("deny")
    expect(outcome.reason).toBe("Classifier unavailable after 1 attempts; denied")
  })

  test("timeout defaults to ask when fallback unset", async () => {
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { allowlist: ["bash"], timeout_ms: 20, retries: 1 },
        classify: Effect.sleep("1 second").pipe(Effect.as({ decision: "allow" as const, reason: "late" })),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(outcome.decision).toBe("ask")
    expect(outcome.reason).toBe("Classifier unavailable after 1 attempts; needs approval")
  })

  test("retries defaults to 3 total attempts then reports count in fallback", async () => {
    let calls = 0
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "ask", allowlist: ["bash"], timeout_ms: 1000 },
        classify: Effect.suspend(() => {
          calls += 1
          return Effect.fail(new Error(`fail ${calls}`))
        }),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(calls).toBe(3)
    expect(outcome).toEqual({
      decision: "ask",
      reason: "Classifier unavailable after 3 attempts; needs approval",
    })
  })

  test("retries succeeds on a later attempt", async () => {
    let calls = 0
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "ask", allowlist: ["bash"], timeout_ms: 1000, retries: 3 },
        classify: Effect.suspend(() => {
          calls += 1
          if (calls < 2) return Effect.fail(new Error("transient"))
          return Effect.succeed({ decision: "allow" as const, reason: "ok after retry" })
        }),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(calls).toBe(2)
    expect(outcome).toEqual({
      decision: "allow",
      reason: "ok after retry",
    })
  })

  test("retries: 0 skips classify and falls back immediately", async () => {
    let calls = 0
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "deny", allowlist: ["bash"], retries: 0 },
        classify: Effect.sync(() => {
          calls += 1
          return { decision: "allow" as const, reason: "should not run" }
        }),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(calls).toBe(0)
    expect(outcome).toEqual({
      decision: "deny",
      reason: "Classifier unavailable after 0 attempts; denied",
    })
  })

  test("timeout budget is per attempt", async () => {
    let calls = 0
    const outcome = await Effect.runPromise(
      runClassifier({
        permission: "bash",
        patterns: ["ls"],
        opts: { fallback: "ask", allowlist: ["bash"], timeout_ms: 40, retries: 2 },
        classify: Effect.gen(function* () {
          calls += 1
          yield* Effect.sleep("80 millis")
          return { decision: "allow" as const, reason: "late" }
        }),
        modelRef: "opencode/deepseek-v4-flash",
      }),
    )
    expect(calls).toBe(2)
    expect(outcome.decision).toBe("ask")
    expect(outcome.reason).toBe("Classifier unavailable after 2 attempts; needs approval")
  })
})
