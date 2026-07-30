import { describe, expect } from "bun:test"
import type { LoadSessionResponse, PromptResponse } from "@agentclientprotocol/sdk"
import { Duration, Effect } from "effect"
import { Subagent } from "@/acp/subagent"
import { cliIt } from "../../lib/cli-process"
import { createAcpClient, expectOk } from "./acp-test-client"
import { expectErrorCode, initialize, newSession, verifierConfig } from "./helpers"

type Response<T = unknown> = {
  readonly jsonrpc: "2.0"
  readonly id: number
  readonly result?: T
  readonly error?: unknown
}

type Notification<T = unknown> = {
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly params?: T
}

type Request<T = unknown> = {
  readonly jsonrpc: "2.0"
  readonly id: number | string
  readonly method: string
  readonly params?: T
}

describe("opencode acp subagent extension subprocess", () => {
  cliIt.live(
    "lists, subscribes, updates, and loads a child transcript over ndjson",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const handle = yield* opencode.acp({
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              ...verifierConfig(llm.url),
              permission: { task: "allow" },
            }),
          },
        })
        const acp = createAcpClient(handle)
        const initialized = yield* initialize(acp)
        expect(initialized._meta).toEqual({
          "opencode.dev/subagents": {
            version: 1,
            list: true,
            subscribe: true,
          },
        })

        const empty = Subagent.decodeSnapshot(expectOk(yield* acp.request("_opencode/subagents/list", {})))
        expect(empty.nodes).toEqual([])

        const root = yield* newSession(acp, home)
        const listed = Subagent.decodeSnapshot(expectOk(yield* acp.request("_opencode/subagents/list", {})))
        expect(listed.nodes).toHaveLength(1)
        expect(listed.nodes[0]).toMatchObject({
          sessionId: root.sessionId,
          rootSessionId: root.sessionId,
        })
        const rootCwd = listed.nodes[0]?.cwd
        expect(rootCwd).toBeDefined()
        if (!rootCwd) return

        const missing = yield* acp.request("_opencode/subagents/missing", {})
        expectErrorCode(missing.error, -32601)

        yield* llm.tool("task", {
          description: "inspect child",
          prompt: "return the child transcript fixture",
          subagent_type: "general",
        })
        yield* llm.text("child transcript fixture")
        yield* llm.text("parent complete")

        yield* handle.send({
          jsonrpc: "2.0",
          id: 100,
          method: "_opencode/subagents/subscribe",
          params: { rootSessionId: root.sessionId },
        })
        yield* handle.send({
          jsonrpc: "2.0",
          id: 101,
          method: "session/prompt",
          params: {
            sessionId: root.sessionId,
            prompt: [{ type: "text", text: "delegate this task" }],
          },
        })

        const subscribed = yield* subscribeBeforeUpdate(handle.receive, 100, 101)
        expect(subscribed.response.error).toBeUndefined()
        Subagent.decodeSnapshot(subscribed.response.result)

        const observed = yield* collectPromptAndChildUpdate(handle.receive, 101, root.sessionId, subscribed.prompt)
        expect(observed.prompt.error).toBeUndefined()
        expect(observed.prompt.result).toMatchObject({ stopReason: "end_turn" })
        const update = Subagent.decodeUpdate(observed.update.params)
        const child = update.upsert.find((node) => node.parentSessionId === root.sessionId)
        expect(child).toBeDefined()
        if (!child) return
        expect(child.cwd).toBe(rootCwd)

        yield* handle.send({
          jsonrpc: "2.0",
          id: 102,
          method: "session/load",
          params: {
            cwd: child.cwd,
            sessionId: child.sessionId,
            mcpServers: [],
          },
        })
        const loaded = yield* collectLoadAndTranscript(handle.receive, 102, child.sessionId)
        expect(loaded.response.error).toBeUndefined()
        expect(loaded.response.result?.configOptions).toBeDefined()
        expect(loaded.transcript).toBe("child transcript fixture")
      }),
    60_000,
  )

  cliIt.live(
    "loads a running child on its root connection and keeps permissions and transcript live",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const handle = yield* opencode.acp({
          env: {
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              ...verifierConfig(llm.url),
              permission: {
                task: "allow",
                bash: "ask",
              },
            }),
          },
        })
        const acp = createAcpClient(handle)
        yield* initialize(acp)
        const root = yield* newSession(acp, home)

        yield* llm.tool("task", {
          description: "inspect live child",
          prompt: "request both shell permissions, then report",
          subagent_type: "general",
        })
        yield* llm.tool("bash", {
          command: "printf permission-before-load",
          description: "First child command",
        })
        yield* llm.tool("bash", {
          command: "printf permission-after-load",
          description: "Second child command",
        })
        yield* llm.text("child live after load")
        yield* llm.text("parent complete")

        yield* handle.send({
          jsonrpc: "2.0",
          id: 200,
          method: "_opencode/subagents/subscribe",
          params: { rootSessionId: root.sessionId },
        })
        yield* handle.send({
          jsonrpc: "2.0",
          id: 201,
          method: "session/prompt",
          params: {
            sessionId: root.sessionId,
            prompt: [{ type: "text", text: "delegate this live task" }],
          },
        })

        const opening = yield* collectRunningChildAndPermission(handle.receive, 200, root.sessionId)
        expect(opening.subscribe.error).toBeUndefined()
        expect(opening.child.phase).toBe("running")
        expect(opening.permission.params?.sessionId).toBe(opening.child.sessionId)

        yield* handle.send({
          jsonrpc: "2.0",
          id: 202,
          method: "session/load",
          params: {
            cwd: opening.child.cwd,
            sessionId: opening.child.sessionId,
            mcpServers: [],
          },
        })
        const loaded = yield* collectResponse<LoadSessionResponse>(handle.receive, 202)
        expect(loaded.error).toBeUndefined()

        yield* selectPermission(handle, opening.permission.id)
        const secondPermission = yield* collectPermission(handle.receive, opening.child.sessionId)
        expect(secondPermission.id).not.toBe(opening.permission.id)
        yield* selectPermission(handle, secondPermission.id)

        const completed = yield* collectLiveChildDeltaAndPrompt(
          handle.receive,
          201,
          opening.child.sessionId,
          "child live after load",
        )
        expect(completed.prompt.error).toBeUndefined()
        expect(completed.prompt.result).toMatchObject({ stopReason: "end_turn" })
        expect(completed.childText).toBe("child live after load")
      }),
    90_000,
  )
})

type PermissionRequestParams = {
  readonly sessionId: string
}

function collectRunningChildAndPermission(receive: Effect.Effect<unknown>, subscribeId: number, rootSessionId: string) {
  return Effect.gen(function* () {
    let subscribe: Response<Subagent.Snapshot> | undefined
    let child: Subagent.Node | undefined
    let permission: Request<PermissionRequestParams> | undefined
    while (!subscribe || !child || !permission) {
      const message = yield* receive.pipe(Effect.timeout(Duration.seconds(20)))
      if (isResponse<Subagent.Snapshot>(message) && message.id === subscribeId) {
        subscribe = message
      }
      if (isNotification<Subagent.Update>(message) && message.method === "_opencode/subagents/update") {
        const update = Subagent.decodeUpdate(message.params)
        child ??= update.upsert.find(
          (node) => node.rootSessionId === rootSessionId && node.parentSessionId === rootSessionId,
        )
      }
      if (
        isRequest<PermissionRequestParams>(message) &&
        message.method === "session/request_permission" &&
        message.params?.sessionId !== rootSessionId
      ) {
        permission = message
      }
    }
    return { subscribe, child, permission }
  })
}

function collectResponse<T>(receive: Effect.Effect<unknown>, id: number) {
  return Effect.gen(function* () {
    while (true) {
      const message = yield* receive.pipe(Effect.timeout(Duration.seconds(20)))
      if (isResponse<T>(message) && message.id === id) return message
    }
  })
}

function selectPermission(handle: { send: (message: object) => Effect.Effect<void> }, id: number | string) {
  return handle.send({
    jsonrpc: "2.0",
    id,
    result: {
      outcome: {
        outcome: "selected",
        optionId: "once",
      },
    },
  })
}

function collectPermission(receive: Effect.Effect<unknown>, sessionId: string) {
  return Effect.gen(function* () {
    while (true) {
      const message = yield* receive.pipe(Effect.timeout(Duration.seconds(20)))
      if (
        isRequest<PermissionRequestParams>(message) &&
        message.method === "session/request_permission" &&
        message.params?.sessionId === sessionId
      ) {
        return message
      }
    }
  })
}

function collectLiveChildDeltaAndPrompt(
  receive: Effect.Effect<unknown>,
  promptId: number,
  childSessionId: string,
  expectedText: string,
) {
  return Effect.gen(function* () {
    let prompt: Response<PromptResponse> | undefined
    let childText: string | undefined
    while (!prompt || childText !== expectedText) {
      const message = yield* receive.pipe(Effect.timeout(Duration.seconds(20)))
      if (isResponse<PromptResponse>(message) && message.id === promptId) prompt = message
      if (
        isNotification<{
          sessionId: string
          update: { sessionUpdate: string; content?: { type: string; text?: string } }
        }>(message) &&
        message.method === "session/update" &&
        message.params?.sessionId === childSessionId &&
        message.params.update.sessionUpdate === "agent_message_chunk"
      ) {
        childText = `${childText ?? ""}${message.params.update.content?.text ?? ""}`
      }
    }
    return { prompt, childText }
  })
}

function subscribeBeforeUpdate(receive: Effect.Effect<unknown>, subscribeId: number, promptId: number) {
  return Effect.gen(function* () {
    let prompt: Response<PromptResponse> | undefined
    while (true) {
      const message = yield* receive.pipe(Effect.timeout(Duration.seconds(15)))
      if (isNotification(message) && message.method === "_opencode/subagents/update") {
        return yield* Effect.die(new Error("subagent update arrived before subscribe response"))
      }
      if (isResponse<PromptResponse>(message) && message.id === promptId) prompt = message
      if (isResponse<Subagent.Snapshot>(message) && message.id === subscribeId) {
        return { response: message, prompt }
      }
    }
  })
}

function collectPromptAndChildUpdate(
  receive: Effect.Effect<unknown>,
  id: number,
  rootSessionId: string,
  initialPrompt?: Response<PromptResponse>,
) {
  return Effect.gen(function* () {
    let prompt = initialPrompt
    let update: Notification<Subagent.Update> | undefined
    while (!prompt || !update) {
      const message = yield* receive.pipe(Effect.timeout(Duration.seconds(15)))
      if (isResponse<PromptResponse>(message) && message.id === id) prompt = message
      if (
        isNotification<Subagent.Update>(message) &&
        message.method === "_opencode/subagents/update" &&
        message.params?.upsert.some((node) => node.parentSessionId === rootSessionId)
      ) {
        update = message
      }
    }
    return { prompt, update }
  })
}

function collectLoadAndTranscript(receive: Effect.Effect<unknown>, id: number, sessionId: string) {
  return Effect.gen(function* () {
    let response: Response<LoadSessionResponse> | undefined
    let transcript: string | undefined
    while (!response || !transcript) {
      const message = yield* receive.pipe(Effect.timeout(Duration.seconds(15)))
      if (isResponse<LoadSessionResponse>(message) && message.id === id) response = message
      if (
        isNotification<{
          sessionId: string
          update: { sessionUpdate: string; content?: { type: string; text?: string } }
        }>(message) &&
        message.method === "session/update" &&
        message.params?.sessionId === sessionId &&
        message.params.update.sessionUpdate === "agent_message_chunk"
      ) {
        transcript = message.params.update.content?.text
      }
    }
    return { response, transcript }
  })
}

function isResponse<T>(input: unknown): input is Response<T> {
  return !!input && typeof input === "object" && "jsonrpc" in input && "id" in input
}

function isNotification<T>(input: unknown): input is Notification<T> {
  return !!input && typeof input === "object" && "jsonrpc" in input && "method" in input && !("id" in input)
}

function isRequest<T>(input: unknown): input is Request<T> {
  return !!input && typeof input === "object" && "jsonrpc" in input && "method" in input && "id" in input
}
