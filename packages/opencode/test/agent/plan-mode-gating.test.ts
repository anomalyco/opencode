import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { planAgentRestrictions } from "@opencode-ai/core/plugin/agent"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Agent, planRulesConfig } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { Question } from "../../src/question"
import { SessionReminders } from "../../src/session/reminders"
import { Session } from "../../src/session/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { PlanExitTool } from "../../src/tool/plan"
import { Truncate } from "../../src/tool/truncate"
import { Skill } from "../../src/skill"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { InstanceState } from "../../src/effect/instance-state"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"

const agentLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Agent.layer.pipe(
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Skill.defaultLayer),
    Layer.provide(LocationServiceMap.layer),
    Layer.provide(RuntimeFlags.layer(flags)),
  )

const it = testEffect(agentLayer())

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

const permissionIt = testEffect(
  Layer.mergeAll(
    Permission.layer.pipe(
      Layer.provide(Database.defaultLayer),
      Layer.provide(EventV2Bridge.defaultLayer),
    ),
    EventV2Bridge.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
  ),
)

function reminderInput(input: {
  agent: Agent.Info
  sessionPermission?: PermissionV1.Ruleset
}) {
  const sessionID = SessionID.make("ses_reminder")
  const user: SessionV1.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "plan",
    model: {
      providerID: ProviderV2.ID.make("openai"),
      modelID: ModelV2.ID.make("gpt-4"),
    },
  }
  return {
    agent: input.agent,
    session: {
      id: sessionID,
      slug: "reminder",
      projectID: ProjectV2.ID.make("prj_test"),
      directory: "/tmp",
      title: "test",
      version: "test",
      time: { created: Date.now(), updated: Date.now() },
      permission: input.sessionPermission ? [...input.sessionPermission] : undefined,
    } satisfies Session.Info,
    messages: [{ info: user, parts: [] }],
  }
}

it.instance(
  "plan agent edit deny survives global permission edit allow",
  () =>
    Effect.gen(function* () {
      const plan = yield* Agent.use.get("plan")
      expect(Permission.evaluate("edit", "/src/foo.ts", plan!.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", ".opencode/plans/foo.md", plan!.permission).action).toBe("allow")
    }),
  {
    config: {
      permission: {
        edit: "allow",
      },
    },
  },
)

it.instance(
  "plan agent edit deny survives global wildcard allow",
  () =>
    Effect.gen(function* () {
      const plan = yield* Agent.use.get("plan")
      expect(Permission.evaluate("edit", "/src/foo.ts", plan!.permission).action).toBe("deny")
    }),
  {
    config: {
      permission: {
        "*": "allow",
      },
    },
  },
)

it.instance("plan agent bash allows readonly commands and asks for mutating commands", () =>
  Effect.gen(function* () {
    const plan = yield* Agent.use.get("plan")
    expect(Permission.evaluate("bash", "ls -la", plan!.permission).action).toBe("allow")
    expect(Permission.evaluate("bash", "git status", plan!.permission).action).toBe("allow")
    expect(Permission.evaluate("bash", "lsof", plan!.permission).action).toBe("ask")
    expect(Permission.evaluate("bash", "lstmeval", plan!.permission).action).toBe("ask")
    expect(Permission.evaluate("bash", "find . -delete", plan!.permission).action).toBe("ask")
    expect(Permission.evaluate("bash", "git branch -D main", plan!.permission).action).toBe("ask")
    expect(Permission.evaluate("bash", "rm -rf x", plan!.permission).action).toBe("ask")
    expect(Permission.evaluate("bash", "npm install", plan!.permission).action).toBe("ask")
    expect(Permission.evaluate("bash", "tee out", plan!.permission).action).toBe("ask")
  }),
)

it.instance("plan agent bash allows cat without write redirect", () =>
  Effect.gen(function* () {
    const plan = yield* Agent.use.get("plan")
    expect(Permission.evaluate("bash", "cat foo.txt", plan!.permission).action).toBe("allow")
  }),
)

it.instance("V2 plan agent keeps plan_enter deny under global allow", () =>
  Effect.sync(() => {
    const merged = PermissionV2.merge(
      [{ action: "*", resource: "*", effect: "allow" }],
      planAgentRestrictions("/project"),
    )
    expect(PermissionV2.evaluate("plan_enter", "*", merged).effect).toBe("deny")
  }),
)

it.instance(
  "session permission edit allow does not relax plan edit deny",
  () =>
    Effect.gen(function* () {
      const plan = yield* Agent.use.get("plan")
      const instance = yield* InstanceState.context
      const merged = Permission.merge(
        plan!.permission,
        Permission.fromConfig({ edit: "allow" }),
        Permission.fromConfig(planRulesConfig(instance.worktree)),
      )
      expect(Permission.evaluate("edit", "/src/foo.ts", merged).action).toBe("deny")
    }),
  {
    config: {
      permission: {
        edit: "allow",
      },
    },
  },
)

it.instance(
  "agent.plan.permission is the supported escape hatch for relaxing plan caps",
  () =>
    Effect.gen(function* () {
      const plan = yield* Agent.use.get("plan")
      expect(Permission.evaluate("edit", "/src/foo.ts", plan!.permission).action).toBe("allow")
      expect(Permission.evaluate("bash", "npm install", plan!.permission).action).toBe("allow")
    }),
  {
    config: {
      agent: {
        plan: {
          permission: {
            edit: "allow",
            bash: "allow",
          },
        },
      },
    },
  },
)

it.instance(
  "global permission still merges last for build agent",
  () =>
    Effect.gen(function* () {
      const build = yield* Agent.use.get("build")
      expect(Permission.evaluate("edit", "/src/foo.ts", build!.permission).action).toBe("allow")
      expect(Permission.evaluate("bash", "npm install", build!.permission).action).toBe("deny")
    }),
  {
    config: {
      permission: {
        bash: "deny",
      },
    },
  },
)

permissionIt.instance(
  "ask denies when ruleset denies even after always-allow approval",
  () =>
    Effect.gen(function* () {
      const permission = yield* Permission.Service
      const sessionID = SessionID.make("ses_plan_cap")
      const askRuleset = Permission.fromConfig({ edit: "ask" })
      const denyRuleset = Permission.fromConfig({ edit: "deny" })

      const pending = yield* permission
        .ask({
          sessionID,
          permission: "edit",
          patterns: ["/src/foo.ts"],
          metadata: {},
          always: ["*"],
          ruleset: askRuleset,
        })
        .pipe(Effect.forkScoped)

      const requests = yield* Effect.gen(function* () {
        while (true) {
          const list = yield* permission.list()
          if (list.length === 1) return list
          yield* Effect.sleep("10 millis")
        }
      }).pipe(Effect.timeoutOrElse({ duration: "1 second", orElse: () => Effect.die("timed out waiting for permission ask") }))

      expect(requests).toHaveLength(1)
      yield* permission.reply({ requestID: requests[0]!.id, reply: "always" })
      yield* Fiber.join(pending)

      const exit = yield* permission
        .ask({
          sessionID,
          permission: "edit",
          patterns: ["/src/foo.ts"],
          metadata: {},
          always: ["*"],
          ruleset: denyRuleset,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(PermissionV1.DeniedError)
    }) as Effect.Effect<void>,
  { git: true },
)

const planExitCapture: { message?: SessionV1.User } = {}

const planExitIt = testEffect(
  Layer.mergeAll(
    agentLayer(),
    Provider.defaultLayer,
    Truncate.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Layer.mock(Session.Service, {
      get: () =>
        Effect.succeed({
          id: SessionID.make("ses_plan_exit"),
          slug: "plan-exit",
          projectID: ProjectV2.ID.make("prj_test"),
          directory: "/tmp",
          title: "test",
          version: "test",
          time: { created: 1, updated: 1 },
        } satisfies Session.Info),
      messages: () =>
        Effect.succeed([
          {
            info: {
              id: MessageID.ascending(),
              sessionID: SessionID.make("ses_plan_exit"),
              role: "user",
              agent: "plan",
              model: {
                providerID: ProviderV2.ID.make("openai"),
                modelID: ModelV2.ID.make("gpt-4"),
              },
              time: { created: Date.now() },
            } satisfies SessionV1.User,
            parts: [],
          },
        ]),
      updateMessage: (msg) =>
        Effect.sync(() => {
          planExitCapture.message = msg as SessionV1.User
          return msg
        }),
      updatePart: (part) => Effect.succeed(part),
    }),
    Layer.mock(Question.Service, {
      ask: () => Effect.succeed([["Yes"]]),
    }),
  ),
)

planExitIt.instance(
  "plan_exit falls back when build agent is disabled",
  () =>
    Effect.gen(function* () {
      const toolInfo = yield* PlanExitTool
      const tool = yield* toolInfo.init()
      yield* tool.execute(
        {},
        {
          sessionID: SessionID.make("ses_plan_exit"),
          messageID: MessageID.ascending(),
          agent: "plan",
          abort: AbortSignal.any([]),
          callID: "call_plan_exit",
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const message = planExitCapture.message
      expect(message?.agent).toBe("implement")
      expect(message?.agent).not.toBe("build")
    }) as Effect.Effect<void>,
  {
    config: {
      agent: {
        build: { disable: true },
        implement: {
          mode: "primary",
          description: "Implements approved plans",
        },
      },
    },
  },
)

planExitIt.instance(
  "plan_exit handoff uses build agent configured model",
  () =>
    Effect.gen(function* () {
      const build = yield* Agent.use.get("build")
      const toolInfo = yield* PlanExitTool
      const tool = yield* toolInfo.init()
      yield* tool.execute(
        {},
        {
          sessionID: SessionID.make("ses_plan_exit"),
          messageID: MessageID.ascending(),
          agent: "plan",
          abort: AbortSignal.any([]),
          callID: "call_plan_exit",
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(planExitCapture.message?.agent).toBe("build")
      expect(planExitCapture.message?.model).toEqual(build?.model)
    }) as Effect.Effect<void>,
  {
    config: {
      agent: {
        build: {
          model: "anthropic/claude-3",
        },
      },
    },
  },
)

const reminderLayer = (flags: Partial<RuntimeFlags.Info>) =>
  Layer.mergeAll(
    agentLayer(flags),
    RuntimeFlags.layer(flags),
    FSUtil.defaultLayer,
    Layer.mock(Session.Service, {
      updatePart: (part) => Effect.succeed(part),
    }),
  )

const reminderIt = testEffect(reminderLayer({ experimentalPlanMode: true, client: "app" }))

reminderIt.instance(
  "experimental plan reminder falls back when client is not cli",
  () =>
    Effect.gen(function* () {
      const plan = yield* Agent.use.get("plan")
      const result = yield* SessionReminders.apply(reminderInput({ agent: plan! }))
      const text = result[0]?.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n")
      expect(text).toContain("# Plan Mode - System Reminder")
      expect(text).not.toContain("call plan_exit")
    }) as Effect.Effect<void>,
)

const deniedReminderIt = testEffect(reminderLayer({ experimentalPlanMode: true, client: "cli" }))

deniedReminderIt.instance(
  "experimental plan reminder falls back when plan_exit is denied",
  () =>
    Effect.gen(function* () {
      const plan = yield* Agent.use.get("plan")
      const result = yield* SessionReminders.apply(
        reminderInput({
          agent: plan!,
          sessionPermission: Permission.fromConfig({ plan_exit: "deny" }),
        }),
      )
      const text = result[0]?.parts.map((part) => (part.type === "text" ? part.text : "")).join("\n")
      expect(text).toContain("# Plan Mode - System Reminder")
      expect(text).not.toContain("call plan_exit")
    }) as Effect.Effect<void>,
)
