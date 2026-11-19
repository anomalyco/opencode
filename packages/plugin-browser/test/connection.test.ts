import { expect, test } from "bun:test"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { Effect, Stream } from "effect"
import { BrowserConnection } from "../src/connection.js"

// An attached session's grant makes core resolve every browser call to allow, so the plugin's `evaluate` hook is what
// applies the agent's own rules. When it cannot read them, the grant must not decide alone.
test("a browser call is refused when the session's rules cannot be read", async () => {
  const hooks: ((event: PermissionEvaluation) => Effect.Effect<void>)[] = []

  const ctx = {
    agent: { transform: () => Effect.void },
    permission: {
      hook: (_name: "evaluate", hook: (event: PermissionEvaluation) => Effect.Effect<void>) =>
        Effect.sync(() => void hooks.push(hook)),
    },
    session: {
      get: () => Effect.fail(new Error("The session store is unavailable.")),
      hook: () => Effect.void,
    },
    storage: { scan: () => Effect.succeed({ entries: [] }) },
    location: { directory: "/workspace" },
    rpc: { register: () => Effect.succeed({ events: { emit: () => Effect.void } }) },
    event: { subscribe: () => Stream.empty },
  }

  const evaluated = await Effect.runPromise(
    Effect.gen(function* () {
      // SAFETY: the connection calls only these members while it is made and while its `evaluate` hook runs.
      yield* BrowserConnection.make(ctx as unknown as Parameters<typeof BrowserConnection.make>[0])

      const event: PermissionEvaluation = {
        // SAFETY: the hook passes the ID to `session.get` and reads nothing of it.
        sessionID: "ses_unreadable" as PermissionEvaluation["sessionID"],
        action: "browser",
        resources: ["tabs.list"],
        effect: "allow",
      }

      yield* Effect.forEach(hooks, (hook) => hook(event))

      return event
    }).pipe(Effect.scoped),
  )

  expect(hooks).toHaveLength(1)
  expect(evaluated.effect).toBe("deny")
  expect(evaluated.message).toBe("Browser permissions could not be read; no action ran.")
})
