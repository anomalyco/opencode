import { describe, expect } from "bun:test"
import type { PromptResponse, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import { Duration, Effect } from "effect"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"
import { createAcpClient } from "./acp-test-client"
import { initialize, newSession, verifierConfig } from "./helpers"

type Message = {
  id?: number
  method?: string
  params?: { sessionId?: string }
  result?: unknown
}

describe("acp nested permissions", () => {
  cliIt.live(
    "routes a nested permission through the managed session",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const raw = yield* opencode.acp({
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              ...verifierConfig(llm.url),
              // Required: the default of 1 stops the child from delegating, so
              // the write permission would come from the child and the test would
              // pass on depth-1 routing without ever reaching a grandchild.
              subagent_depth: 2,
              permission: { task: "allow", edit: "ask" },
              agent: {
                nested: {
                  description: "Delegates nested test work.",
                  mode: "subagent",
                  permission: { task: "allow", edit: "ask" },
                },
              },
            }),
          },
        })
        const acp = createAcpClient(raw)
        yield* initialize(acp)
        const session = yield* newSession(acp, home)

        yield* llm.tool("task", {
          description: "delegate once",
          prompt: "Delegate the file write to another agent.",
          subagent_type: "nested",
        })
        yield* llm.tool("task", {
          description: "delegate twice",
          prompt: "Write nested-denied.txt.",
          subagent_type: "nested",
        })
        yield* llm.tool("write", { filePath: "nested-denied.txt", content: "blocked" })
        yield* llm.text("grandchild done")
        yield* llm.text("child done")
        yield* llm.text("root done")

        const promptID = 9999
        yield* raw.send({
          jsonrpc: "2.0",
          id: promptID,
          method: "session/prompt",
          params: { sessionId: session.sessionId, prompt: [{ type: "text", text: "delegate twice" }] },
        })

        const permissionSessions: string[] = []
        const outcome = yield* Effect.gen(function* () {
          while (true) {
            const message = (yield* raw.receive.pipe(Effect.timeout(Duration.seconds(10)))) as Message
            if (message.method === "session/request_permission" && message.id !== undefined) {
              if (message.params?.sessionId) permissionSessions.push(message.params.sessionId)
              yield* raw.send({
                jsonrpc: "2.0",
                id: message.id,
                result: { outcome: { outcome: "selected", optionId: "reject" } } satisfies RequestPermissionResponse,
              })
              continue
            }
            if (message.id === promptID) return message
          }
        }).pipe(Effect.timeout(Duration.seconds(20)), Effect.exit)

        expect(outcome._tag).toBe("Success")
        if (outcome._tag !== "Success") return
        expect((outcome.value.result as PromptResponse | undefined)?.stopReason).toBeDefined()
        // The prompt is displayed against the managed root even though it
        // originated two levels down, which is the whole point of the routing.
        expect(permissionSessions).toEqual([session.sessionId])
        // Only a grandchild is ever prompted with the second delegation, so its
        // presence proves the permission came from depth 2 rather than the child.
        const inputs = JSON.stringify(yield* llm.inputs)
        expect(inputs).toContain("Write nested-denied.txt.")
        expect(inputs).not.toContain("depth limit")
        expect(yield* Effect.promise(() => Bun.file(path.join(home, "nested-denied.txt")).exists())).toBe(false)
      }),
    40_000,
  )
})
