// Subprocess integration tests for `opencode run` on resumed sessions. The
// non-interactive deny rules were applied only on session create, so a
// session created elsewhere (over HTTP) and resumed with --session kept the
// question tool live, and an asked question blocked the run forever.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"

const createSession = (url: string) =>
  Effect.promise(() =>
    fetch(`${url}/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).then((res) => {
      expect(res.ok).toBe(true)
      return res.json() as Promise<{ id: string }>
    }),
  )

describe("opencode run --session (externally created session)", () => {
  cliIt.concurrent(
    "applies the non-interactive deny rules to a resumed session",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        const created = yield* createSession(server.url)
        yield* llm.text("resumed reply")
        const result = yield* opencode.run("say hi", {
          extraArgs: ["--attach", server.url, "--session", created.id],
        })
        opencode.expectExit(result, 0)
        const session = yield* Effect.promise(() =>
          fetch(`${server.url}/session/${created.id}`).then((res) => {
            expect(res.ok).toBe(true)
            return res.json() as Promise<{ permission?: { permission: string; action: string; pattern: string }[] }>
          }),
        )
        // exact tail matters: the resume path's idempotence check keys on it
        expect((session.permission ?? []).slice(-3)).toEqual([
          { permission: "question", action: "deny", pattern: "*" },
          { permission: "plan_enter", action: "deny", pattern: "*" },
          { permission: "plan_exit", action: "deny", pattern: "*" },
        ])
      }),
    120_000,
  )

  cliIt.concurrent(
    "does not hang when the model asks a question on a resumed session",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        const created = yield* createSession(server.url)
        yield* llm.push(
          reply().tool("question", {
            questions: [
              {
                question: "Red or blue?",
                header: "Color",
                options: [
                  { label: "Red", description: "red" },
                  { label: "Blue", description: "blue" },
                ],
              },
            ],
          }),
        )
        yield* llm.text("moving on")
        const result = yield* opencode.run("ask me something", {
          extraArgs: ["--attach", server.url, "--session", created.id],
          timeoutMs: 30_000,
        })
        opencode.expectExit(result, 0)
      }),
    120_000,
  )
})
