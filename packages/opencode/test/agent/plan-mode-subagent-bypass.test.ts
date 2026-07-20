import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { deriveSubagentSessionPermission } from "../../src/agent/subagent-permissions"
import { Permission } from "../../src/permission"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Agent.node))

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

it.instance("subagent permissions take precedence over parent agent restrictions", () =>
  Effect.gen(function* () {
    const planAgent = yield* Agent.use.get("plan")
    const generalAgent = yield* Agent.use.get("general")

    expect(planAgent).toBeDefined()
    expect(generalAgent).toBeDefined()
    // Sanity: the plan agent itself blocks edit. (Note: `write` and
    // `apply_patch` route through the `edit` permission at the runtime
    // tool layer — see Permission.disabled / EDIT_TOOLS.)
    expect(Permission.evaluate("edit", "/some/file.ts", planAgent!.permission).action).toBe("deny")

    const parentSessionPermission: PermissionV1.Ruleset = []

    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentAgent: undefined,
      parentSessionPermission,
      subagent: generalAgent!,
    })

    // Mirror the runtime evaluation in session/prompt.ts (~line 410, 639):
    //   ruleset: Permission.merge(agent.permission, session.permission ?? [])
    const effective = Permission.merge(generalAgent!.permission, subagentSessionPermission)

    expect(Permission.evaluate("edit", "/some/file.ts", effective).action).not.toBe("deny")
    expect(Permission.disabled(["edit", "write", "apply_patch"], effective)).toEqual(new Set())
  }),
)

it.instance("subagent's own read-only restriction remains effective", () =>
  Effect.gen(function* () {
    const explore = yield* Agent.use.get("explore")
    expect(explore).toBeDefined()

    const parentSessionPermission: PermissionV1.Ruleset = []
    const subagentSessionPermission = deriveSubagentSessionPermission({
      parentAgent: undefined,
      parentSessionPermission,
      subagent: explore!,
    })
    const effective = Permission.merge(explore!.permission, subagentSessionPermission)

    expect(Permission.evaluate("edit", "/x.ts", effective).action).toBe("deny")
  }),
)

it.instance(
  "custom subagent can explicitly enable edits denied to its parent agent",
  () =>
    Effect.gen(function* () {
      const planAgent = yield* Agent.use.get("plan")
      const my = yield* Agent.use.get("my_subagent")
      expect(planAgent).toBeDefined()
      expect(my).toBeDefined()

      const parentSessionPermission: PermissionV1.Ruleset = []
      const subagentSessionPermission = deriveSubagentSessionPermission({
        parentAgent: undefined,
        parentSessionPermission,
        subagent: my!,
      })
      const effective = Permission.merge(my!.permission, subagentSessionPermission)

      expect(Permission.evaluate("edit", "/some/file.ts", planAgent!.permission).action).toBe("deny")
      expect(Permission.evaluate("edit", "/some/file.ts", effective).action).toBe("allow")
      expect(Permission.disabled(["edit", "write", "apply_patch"], effective)).toEqual(new Set())
    }),
  {
    config: {
      agent: {
        my_subagent: {
          description: "A user-defined subagent",
          mode: "subagent",
          permission: {
            edit: "allow",
          },
        },
      },
    },
  },
)

it.effect("subagent self permissions are preserved", () =>
  Effect.sync(() => {
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
        edit: "allow",
      },
    })

    const effective = Permission.merge(
      executor.permission,
      deriveSubagentSessionPermission({
        parentAgent: undefined,
        parentSessionPermission: [],
        subagent: executor,
      }),
    )

    expect(Permission.evaluate("read", "README.md", effective).action).toBe("allow")
    expect(Permission.evaluate("bash", "git status", effective).action).toBe("allow")
    expect(Permission.evaluate("task", "worker", effective).action).toBe("allow")
    expect(Permission.evaluate("task", "other", effective).action).toBe("deny")
    expect(Permission.disabled(["edit", "write", "apply_patch"], effective)).toEqual(new Set())
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
        parentAgent: undefined,
        parentSessionPermission: Permission.fromConfig({ bash: "deny" }),
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
    const parentWithMcpAllows: PermissionV1.Ruleset = Permission.fromConfig({
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
    const parentWithWildcard: PermissionV1.Ruleset = Permission.fromConfig({
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
    const parentSession: PermissionV1.Ruleset = Permission.fromConfig({
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
