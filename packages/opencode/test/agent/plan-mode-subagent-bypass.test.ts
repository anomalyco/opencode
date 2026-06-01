/**
 * Reproducer for opencode issue #26514:
 *
 * In Plan Mode (the `plan` agent), the main agent's edit/write tools are
 * blocked by the plan agent's permission ruleset (`edit: { "*": "deny" }`).
 * However, when the plan agent spawns a subagent via the `task` tool, the
 * subagent retains full file modification capabilities — a security bypass.
 *
 * This test replicates the permission ruleset that would govern a
 * `general` subagent when launched from a `plan` parent session, mirroring
 * the logic in `src/tool/task.ts` (filtered parent permissions ++ runtime
 * subagent agent permissions, evaluated as in `session/prompt.ts`).
 *
 * The expected (secure) behavior is that the subagent inherits the plan
 * mode read-only restriction and `edit`/`write` resolve to `deny`. On
 * origin/dev this assertion fails because the parent **agent** permissions
 * are not propagated to the subagent — only the parent **session**
 * permissions are passed through, and Plan Mode's restrictions live on the
 * agent, not the session.
 */
import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(Agent.defaultLayer)

function testAgent(input: {
  name: string
  mode: Agent.Info["mode"]
  permission: Parameters<typeof Permission.fromConfig>[0]
}) {
  return {
    name: input.name,
    mode: input.mode,
    permission: Permission.fromConfig(input.permission),
    options: {},
  } satisfies Agent.Info
}

// `deriveSubagentSessionPermission` is imported from production. The test
// exercises the actual helper that task.ts uses to build the subagent's
// session permission, so any regression in that helper trips this test.

it.instance("[#26514] subagent spawned from plan mode inherits read-only restriction (edit denied)", () =>
  Effect.gen(function* () {
    const planAgent = yield* Agent.use.get("plan")
    const generalAgent = yield* Agent.use.get("general")

    expect(planAgent).toBeDefined()
    expect(generalAgent).toBeDefined()
    // Sanity: the plan agent itself blocks edit. (Note: `write` and
    // `apply_patch` route through the `edit` permission at the runtime
    // tool layer — see Permission.disabled / EDIT_TOOLS.)
    expect(Permission.evaluate("edit", "/some/file.ts", planAgent!.permission).action).toBe("deny")

    // Simulate the plan-mode parent session: in real flow the plan
    // session's `permission` field is empty (Plan Mode lives on the agent
    // ruleset, not the session). So we pass [] through as the parent
    // session permission, exactly like the actual code path.
    const parentSessionPermission: Permission.Ruleset = []

    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentSessionPermission,
      parentAgent: planAgent,
      subagent: generalAgent!,
    })

    // Mirror the runtime evaluation in session/prompt.ts (~line 410, 639):
    //   ruleset: Permission.merge(agent.permission, session.permission ?? [])
    const effective = Permission.merge(generalAgent!.permission, subagentSessionPermission)

    expect(Permission.evaluate("edit", "/some/file.ts", effective).action).toBe("deny")
    expect(Permission.evaluate("edit", "/another/path/index.tsx", effective).action).toBe("deny")
  }),
)

it.instance("[#26514] explore subagent launched from plan mode also stays read-only", () =>
  // Sibling check: even though `explore` is intrinsically read-only, the
  // bug surface is the same. Including this case to document that the fix
  // should propagate the parent **agent** permissions, not just deny edit
  // when the subagent happens to already deny it.
  Effect.gen(function* () {
    const planAgent = yield* Agent.use.get("plan")
    const explore = yield* Agent.use.get("explore")
    expect(planAgent).toBeDefined()
    expect(explore).toBeDefined()

    const parentSessionPermission: Permission.Ruleset = []
    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentSessionPermission,
      parentAgent: planAgent,
      subagent: explore!,
    })
    const effective = Permission.merge(explore!.permission, subagentSessionPermission)

    // Already deny — sanity check.
    expect(Permission.evaluate("edit", "/x.ts", effective).action).toBe("deny")
  }),
)

it.instance(
  "[#26514] custom user subagent launched from plan mode bypasses Plan Mode read-only",
  // The most damaging case: a user-defined subagent with default
  // permissions (allow-by-default, like `general`). The subagent must NOT
  // be able to edit when the parent agent is `plan`.
  () =>
    Effect.gen(function* () {
      const planAgent = yield* Agent.use.get("plan")
      const my = yield* Agent.use.get("my_subagent")
      expect(planAgent).toBeDefined()
      expect(my).toBeDefined()

      const parentSessionPermission: Permission.Ruleset = []
      const subagentSessionPermission = deriveSubagentSessionPermission({
        parentSessionPermission,
        parentAgent: planAgent,
        subagent: my!,
      })
      const effective = Permission.merge(my!.permission, subagentSessionPermission)

      // BUG: on origin/dev edit resolves to "allow" because the plan
      // agent's `edit: deny *` rule never reaches the subagent.
      expect(Permission.evaluate("edit", "/some/file.ts", effective).action).toBe("deny")
    }),
  {
    config: {
      agent: {
        my_subagent: {
          description: "A user-defined subagent",
          mode: "subagent",
        },
      },
    },
  },
)

it.effect("[#26700] controller self-restrictions do not erase executor permissions", () =>
  Effect.sync(() => {
    const controller = testAgent({
      name: "controller",
      mode: "primary",
      permission: {
        "*": "deny",
        read: "deny",
        bash: "deny",
        task: {
          "*": "deny",
          executor: "allow",
        },
        edit: "deny",
        write: "deny",
      },
    })
    const executor = testAgent({
      name: "executor",
      mode: "subagent",
      permission: {
        "*": "deny",
        read: "allow",
        bash: "allow",
        task: {
          "*": "deny",
          worker: "allow",
        },
        edit: "deny",
        write: "deny",
      },
    })

    const effective = Permission.merge(
      executor.permission,
      deriveSubagentSessionPermission({
        parentSessionPermission: [],
        parentAgent: controller,
        subagent: executor,
      }),
    )

    expect(Permission.evaluate("read", "README.md", effective).action).toBe("allow")
    expect(Permission.evaluate("bash", "git status", effective).action).toBe("allow")
    expect(Permission.evaluate("task", "worker", effective).action).toBe("allow")
    expect(Permission.evaluate("task", "other", effective).action).toBe("deny")
    expect(Permission.disabled(["edit", "write", "apply_patch"], effective)).toEqual(
      new Set(["edit", "write", "apply_patch"]),
    )
  }),
)

it.effect("subagent inherits parent session deny rules as hard runtime ceilings", () =>
  Effect.sync(() => {
    const executor = testAgent({
      name: "executor",
      mode: "subagent",
      permission: {
        bash: "allow",
      },
    })
    const effective = Permission.merge(
      executor.permission,
      deriveSubagentSessionPermission({
        parentSessionPermission: Permission.fromConfig({ bash: "deny" }),
        parentAgent: undefined,
        subagent: executor,
      }),
    )

    expect(Permission.evaluate("bash", "git status", effective).action).toBe("deny")
  }),
)

it.effect("[#16491] subagent inherits parent session MCP tool allow rules", () =>
  Effect.sync(() => {
    const executor = testAgent({
      name: "executor",
      mode: "subagent",
      permission: {
        read: "allow",
      },
    })

    // Simulate a parent session that has allowed MCP tools.
    // MCP tool permission keys use an underscore pattern:
    // sanitize(clientName) + '_' + sanitize(toolName)
    const parentWithMcpAllows: Permission.Ruleset = Permission.fromConfig({
      "myserver_tool-one": "allow",
      "myserver_tool-two": "allow",
      "otherclient_resource-list": "allow",
      bash: "allow",
      read: "allow",
    })

    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentSessionPermission: parentWithMcpAllows,
      parentAgent: undefined,
      subagent: executor,
    })

    const effective = Permission.merge(executor.permission, subagentSessionPermission)

    // MCP tools (with underscores) should be allowed in the subagent
    expect(Permission.evaluate("myserver_tool-one", "*", effective).action).toBe("allow")
    expect(Permission.evaluate("myserver_tool-two", "*", effective).action).toBe("allow")
    expect(Permission.evaluate("otherclient_resource-list", "*", effective).action).toBe("allow")

    // Native tools (no underscore) should NOT be inherited through the
    // MCP allow filter. The subagent itself only allowed "read", so
    // bash resolves to "ask" (the default) — not "deny" and not "allow".
    // The parent session's bash:allow doesn't leak through because
    // "bash" has no underscore in its permission key.
    expect(Permission.evaluate("bash", "ls", effective).action).toBe("ask")
  }),
)

it.effect("[#16491] wildcard allow in parent session is inherited by subagent", () =>
  Effect.sync(() => {
    const executor = testAgent({
      name: "executor",
      mode: "subagent",
      permission: {
        read: "allow",
      },
    })

    // Parent session with wildcard allow (user accepted all tools)
    const parentWithWildcard: Permission.Ruleset = Permission.fromConfig({
      "*": "allow",
    })

    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentSessionPermission: parentWithWildcard,
      parentAgent: undefined,
      subagent: executor,
    })

    const effective = Permission.merge(executor.permission, subagentSessionPermission)

    // Wildcard allow should be inherited
    expect(Permission.evaluate("context7_resolve-library-id", "*", effective).action).toBe("allow")
    expect(Permission.evaluate("matrix_matrix_read", "*", effective).action).toBe("allow")
  }),
)

it.effect("[#16491] native tool deny rules still propagate and are not overridden by MCP allow rules", () =>
  Effect.sync(() => {
    const executor = testAgent({
      name: "executor",
      mode: "subagent",
      permission: {
        read: "allow",
      },
    })

    // Parent session: MCP tools allowed, but edit denied (e.g. read-only session)
    const parentSession: Permission.Ruleset = Permission.fromConfig({
      "context7_resolve-library-id": "allow",
      "matrix_matrix_read": "allow",
      edit: { "*": "deny" },
      read: "allow",
    })

    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentSessionPermission: parentSession,
      parentAgent: undefined,
      subagent: executor,
    })

    const effective = Permission.merge(executor.permission, subagentSessionPermission)

    // MCP tools allowed
    expect(Permission.evaluate("context7_resolve-library-id", "*", effective).action).toBe("allow")
    // Edit still denied from parent session
    expect(Permission.evaluate("edit", "/some/file.ts", effective).action).toBe("deny")
  }),
)
