// End-to-end coverage for `opencode run --attach ... --auto` against a
// long-running server. See opencode#47545: the point of moving auto approval
// into the server is that `permission.asked` keeps meaning "a human must
// respond", and that one run invocation cannot put a shared server into auto
// mode for everyone else or leave it that way after it exits.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"

type Lease = { id: string; scope: { type: string; sessionID?: string }; ttl: number }

function leases(url: string, directory: string) {
  return Effect.promise(
    async () =>
      (await (
        await fetch(new URL("/permission/auto", url), { headers: { "x-opencode-directory": directory } })
      ).json()) as Lease[],
  )
}

// Collects every event the server publishes for the lifetime of the scope, the
// way an external integration such as Warp or Orca would consume them.
function watchEvents(url: string, directory: string) {
  return Effect.gen(function* () {
    const seen: Array<{ type: string; properties: Record<string, unknown> }> = []
    const controller = new AbortController()
    yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const response = await fetch(new URL("/event", url), {
          headers: { "x-opencode-directory": directory },
          signal: controller.signal,
        })
        const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
        void (async () => {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) return
            for (const line of chunk.value.split("\n")) {
              if (!line.startsWith("data: ")) continue
              seen.push(JSON.parse(line.slice(6)))
            }
          }
        })().catch(() => {})
      }),
      () => Effect.sync(() => controller.abort()),
    )
    return seen
  })
}

describe("opencode run --attach --auto", () => {
  cliIt.live(
    "auto-approves only its own session and gives the lease back when it exits",
    ({ llm, opencode, home }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve()
        const events = yield* watchEvents(server.url, home)

        // The tool sleeps so the lease is observable while the run is running.
        yield* llm.push(reply().tool("bash", { command: "sleep 2", description: "Sleep briefly" }))
        yield* llm.text("finished")

        const handle = yield* opencode.startRun("use a tool", {
          extraArgs: ["--attach", server.url, "--auto"],
        })

        const held = yield* Effect.gen(function* () {
          while (true) {
            const current = yield* leases(server.url, home)
            if (current.length > 0) return current
            yield* Effect.sleep("100 millis")
          }
        }).pipe(
          Effect.timeoutOrElse({
            duration: "30 seconds",
            orElse: () => Effect.fail(new Error("run --auto never acquired a lease")),
          }),
        )

        // Scoped to the run's own session, so unrelated sessions on this
        // server keep asking.
        expect(held).toHaveLength(1)
        expect(held[0]!.scope.type).toBe("session")
        expect(held[0]!.scope.sessionID).toStartWith("ses_")

        const result = yield* handle.result
        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("finished")

        // Nothing a human had to answer, and no leftover authority.
        expect(events.filter((event) => event.type === "permission.asked")).toEqual([])
        expect(yield* leases(server.url, home)).toEqual([])
      }),
    120_000,
  )
})
