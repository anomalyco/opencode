import { describe, expect } from "bun:test"
import type { CreateElicitationRequest, InitializeResponse, NewSessionResponse, PromptResponse } from "@agentclientprotocol/sdk"
import { Duration, Effect } from "effect"
import { cliIt, type AcpHandle } from "../../lib/cli-process"
import { verifierConfig } from "./helpers"

// Minimal duplex JSON-RPC driver that handles inbound requests from opencode
// (e.g. elicitation/create) without touching the shared AcpClient
// infrastructure. Lives here only — no changes to shared test helpers.
type InboundHandler = (params: unknown) => unknown | Promise<unknown>

function makeDriver(acp: AcpHandle) {
  let nextId = 1
  const pending = new Map<number, (msg: unknown) => void>()
  const inbound = new Map<string, InboundHandler>()

  // Fan-out loop: response → resolve pending, inbound request → call handler, else discard.
  async function loop() {
    while (true) {
      let msg: unknown
      try {
        msg = await Effect.runPromise(acp.receive)
      } catch {
        break
      }
      if (!msg || typeof msg !== "object") continue

      const m = msg as Record<string, unknown>

      // Inbound request from opencode: has id + method, no result/error
      if ("id" in m && "method" in m && !("result" in m) && !("error" in m)) {
        const handler = inbound.get(m.method as string)
        if (handler) {
          Promise.resolve(handler(m.params)).then((result) => {
            void Effect.runPromise(acp.send({ jsonrpc: "2.0", id: m.id, result: result ?? {} }))
          })
        }
        continue
      }

      // Response to one of our outbound requests
      if ("id" in m && ("result" in m || "error" in m)) {
        const resolve = pending.get(m.id as number)
        if (resolve) {
          pending.delete(m.id as number)
          resolve(msg)
        }
      }
    }
  }

  void loop()

  function send<T>(method: string, params?: unknown): Promise<{ result?: T; error?: unknown }> {
    return new Promise((resolve) => {
      const id = nextId++
      pending.set(id, (msg) => resolve(msg as { result?: T; error?: unknown }))
      void Effect.runPromise(
        acp.send(params !== undefined ? { jsonrpc: "2.0", id, method, params } : { jsonrpc: "2.0", id, method }),
      )
    })
  }

  function on(method: string, handler: InboundHandler) {
    inbound.set(method, handler)
    return () => inbound.delete(method)
  }

  return { send, on }
}

function ok<T>(response: { result?: T; error?: unknown }): T {
  expect(response.error).toBeUndefined()
  expect(response.result).toBeDefined()
  return response.result as T
}

describe("opencode acp elicitation subprocess", () => {
  cliIt.live(
    "forwards question tool to elicitation/create and unblocks on accept",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const handle = yield* opencode.acp({
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)),
            OPENCODE_ENABLE_QUESTION_TOOL: "1",
          },
        })
        const driver = makeDriver(handle)

        ok(
          yield* Effect.promise(() =>
            driver.send<InitializeResponse>("initialize", {
              protocolVersion: 1,
              clientCapabilities: { _meta: { "terminal-auth": true }, elicitation: { form: {} } },
              clientInfo: { name: "opencode-elicitation-test", version: "0.1.0" },
            }),
          ),
        )

        const session = ok(
          yield* Effect.promise(() => driver.send<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] })),
        )

        const elicitations: CreateElicitationRequest[] = []
        driver.on("elicitation/create", (params) => {
          elicitations.push(params as CreateElicitationRequest)
          return { action: "accept", content: { Environment: "staging" } }
        })

        // LLM turn 1: calls question tool. Turn 2: responds with the accepted answer.
        yield* llm.tool("question", {
          questions: [
            {
              question: "Which environment?",
              header: "Environment",
              options: [
                { label: "staging", description: "Staging environment" },
                { label: "production", description: "Production environment" },
              ],
            },
          ],
        })
        yield* llm.text("Deploying to staging.")

        const response = ok(
          yield* Effect.promise(() =>
            Promise.race([
              driver.send<PromptResponse>("session/prompt", {
                sessionId: session.sessionId,
                prompt: [{ type: "text", text: "Which environment should I deploy to?" }],
              }),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000)),
            ]),
          ),
        )

        expect(response.stopReason).toBe("end_turn")
        expect(elicitations).toHaveLength(1)
        expect(elicitations[0]).toMatchObject({
          mode: "form",
          sessionId: session.sessionId,
          requestedSchema: {
            type: "object",
            properties: {
              Environment: { type: "string", enum: ["staging", "production"] },
            },
          },
        })
      }),
    60_000,
  )

  cliIt.live(
    "auto-rejects question tool when client does not advertise elicitation support",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const handle = yield* opencode.acp({
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)),
            OPENCODE_ENABLE_QUESTION_TOOL: "1",
          },
        })
        const driver = makeDriver(handle)

        ok(
          yield* Effect.promise(() =>
            driver.send<InitializeResponse>("initialize", {
              protocolVersion: 1,
              // No elicitation capability
              clientCapabilities: { _meta: { "terminal-auth": true } },
              clientInfo: { name: "opencode-no-elicitation-test", version: "0.1.0" },
            }),
          ),
        )

        const session = ok(
          yield* Effect.promise(() => driver.send<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] })),
        )

        const elicitations: unknown[] = []
        driver.on("elicitation/create", (params) => {
          elicitations.push(params)
          return { action: "accept", content: {} }
        })

        yield* llm.tool("question", {
          questions: [
            { question: "Which env?", header: "Env", options: [{ label: "prod", description: "Prod" }] },
          ],
        })
        yield* llm.text("Proceeding without answer.")

        const response = ok(
          yield* Effect.promise(() =>
            Promise.race([
              driver.send<PromptResponse>("session/prompt", {
                sessionId: session.sessionId,
                prompt: [{ type: "text", text: "Which environment?" }],
              }),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000)),
            ]),
          ),
        )

        expect(response.stopReason).toBe("end_turn")
        expect(elicitations).toHaveLength(0)
      }),
    60_000,
  )

  cliIt.live(
    "continues session after client declines elicitation",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const handle = yield* opencode.acp({
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url)),
            OPENCODE_ENABLE_QUESTION_TOOL: "1",
          },
        })
        const driver = makeDriver(handle)

        ok(
          yield* Effect.promise(() =>
            driver.send<InitializeResponse>("initialize", {
              protocolVersion: 1,
              clientCapabilities: { _meta: { "terminal-auth": true }, elicitation: { form: {} } },
              clientInfo: { name: "opencode-decline-test", version: "0.1.0" },
            }),
          ),
        )

        const session = ok(
          yield* Effect.promise(() => driver.send<NewSessionResponse>("session/new", { cwd: home, mcpServers: [] })),
        )

        driver.on("elicitation/create", () => ({ action: "decline" }))

        yield* llm.tool("question", {
          questions: [
            { question: "Which env?", header: "Env", options: [{ label: "prod", description: "Prod" }] },
          ],
        })
        yield* llm.text("Understood, proceeding without input.")

        const response = ok(
          yield* Effect.promise(() =>
            Promise.race([
              driver.send<PromptResponse>("session/prompt", {
                sessionId: session.sessionId,
                prompt: [{ type: "text", text: "Which environment?" }],
              }),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000)),
            ]),
          ),
        )

        expect(response.stopReason).toBe("end_turn")
      }),
    60_000,
  )
})
