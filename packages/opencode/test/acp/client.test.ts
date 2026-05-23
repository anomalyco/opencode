import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { ACPClient } from "@/acp/client"
import { Bus } from "@/bus"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageV2 } from "@/session/message-v2"
import { MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionRevert } from "@/session/revert"
import { SessionSummary } from "@/session/summary"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"

const layer = Layer.mergeAll(
  Session.defaultLayer,
  SessionRevert.defaultLayer,
  SessionSummary.defaultLayer,
  ACPClient.defaultLayer,
  Bus.defaultLayer,
)

const it = testEffect(layer)

const model = {
  providerID: ProviderID.make("acp"),
  modelID: ModelID.make("remote"),
}

it.instance("runs a prompt against a stdio ACP server and stores streamed parts", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const server = path.join(test.directory, "fake-acp-server.js")
    yield* Effect.promise(() => fs.writeFile(server, fakeServerSource))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({
          acp: {
            fake: {
              type: "local",
              command: [process.execPath, server],
              timeout: 5000,
            },
          },
        }),
      ),
    )

    const sessions = yield* Session.Service
    const acp = yield* ACPClient.Service
    const info = yield* sessions.create({
      title: "ACP client test",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      agent: "fake-acp",
      model: { id: model.modelID, providerID: model.providerID },
    })

    const user: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: info.id,
      role: "user",
      time: { created: Date.now() },
      agent: "fake-acp",
      model,
    }
    yield* sessions.updateMessage(user)
    const userPart = yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID: info.id,
      messageID: user.id,
      type: "text",
      text: "hello",
    })

    const assistant: MessageV2.Assistant = {
      id: MessageID.ascending(),
      parentID: user.id,
      role: "assistant",
      mode: "fake-acp",
      agent: "fake-acp",
      path: { cwd: test.directory, root: test.directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.modelID,
      providerID: model.providerID,
      time: { created: Date.now() },
      sessionID: info.id,
    }
    yield* sessions.updateMessage(assistant)

    const result = yield* acp.run({
      server: "fake",
      agent: {
        name: "fake-acp",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      session: info,
      user: { info: user, parts: [userPart] },
      assistant,
    })

    expect(result.finish).toBe("stop")
    const messages = yield* sessions.messages({ sessionID: info.id })
    const stored = messages.find((message) => message.info.id === assistant.id)
    expect(stored?.parts.some((part) => part.type === "text" && part.text === "hello from acp")).toBe(true)
    expect(stored?.parts.some((part) => part.type === "file" && part.mime === "image/png")).toBe(true)
    expect(stored?.parts.some((part) => part.type === "step-start")).toBe(true)
    expect(stored?.parts.some((part) => part.type === "step-finish")).toBe(true)
    expect(
      stored?.parts.some(
        (part) => part.type === "reasoning" && part.text === "thinking" && part.time.end !== undefined,
      ),
    ).toBe(true)
    expect(
      stored?.parts.some(
        (part) => part.type === "tool" && part.callID === "call_1" && part.state.status === "completed",
      ),
    ).toBe(true)
    const toolIndex = stored?.parts.findIndex((part) => part.type === "tool" && part.callID === "call_1") ?? -1
    const finalTextIndex =
      stored?.parts.findIndex((part) => part.type === "text" && part.text === "final from acp") ?? -1
    expect(finalTextIndex).toBeGreaterThan(toolIndex)

    const secondUser: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: info.id,
      role: "user",
      time: { created: Date.now() },
      agent: "fake-acp",
      model,
    }
    yield* sessions.updateMessage(secondUser)
    const secondUserPart = yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID: info.id,
      messageID: secondUser.id,
      type: "text",
      text: "second turn",
    })
    const secondAssistant: MessageV2.Assistant = {
      ...assistant,
      id: MessageID.ascending(),
      parentID: secondUser.id,
      time: { created: Date.now() },
    }
    yield* sessions.updateMessage(secondAssistant)
    yield* acp.run({
      server: "fake",
      agent: {
        name: "fake-acp",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      session: info,
      user: { info: secondUser, parts: [secondUserPart] },
      assistant: secondAssistant,
    })
    const afterSecond = yield* sessions.messages({ sessionID: info.id })
    const storedSecond = afterSecond.find((message) => message.info.id === secondAssistant.id)
    expect(storedSecond?.parts.some((part) => part.type === "text" && part.text === "hello from acp")).toBe(true)
  }),
)

it.instance("stores a visible fallback when ACP completes without message chunks", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const server = path.join(test.directory, "silent-acp-server.js")
    yield* Effect.promise(() => fs.writeFile(server, silentServerSource))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({
          acp: {
            silent: {
              type: "local",
              command: [process.execPath, server],
              timeout: 5000,
            },
          },
        }),
      ),
    )

    const sessions = yield* Session.Service
    const acp = yield* ACPClient.Service
    const info = yield* sessions.create({
      title: "silent ACP client test",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      agent: "silent-acp",
      model: { id: model.modelID, providerID: model.providerID },
    })
    const user: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: info.id,
      role: "user",
      time: { created: Date.now() },
      agent: "silent-acp",
      model,
    }
    yield* sessions.updateMessage(user)
    const userPart = yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID: info.id,
      messageID: user.id,
      type: "text",
      text: "ok",
    })
    const assistant: MessageV2.Assistant = {
      id: MessageID.ascending(),
      parentID: user.id,
      role: "assistant",
      mode: "silent-acp",
      agent: "silent-acp",
      path: { cwd: test.directory, root: test.directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.modelID,
      providerID: model.providerID,
      time: { created: Date.now() },
      sessionID: info.id,
    }
    yield* sessions.updateMessage(assistant)

    yield* acp.run({
      server: "silent",
      agent: {
        name: "silent-acp",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      session: info,
      user: { info: user, parts: [userPart] },
      assistant,
    })

    const messages = yield* sessions.messages({ sessionID: info.id })
    const stored = messages.find((message) => message.info.id === assistant.id)
    expect(stored?.parts.some((part) => part.type === "text" && part.text === "Done.")).toBe(true)
  }),
)

it.instance(
  "captures and reverts ACP client file writes",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const server = path.join(test.directory, "write-acp-server.js")
      const target = path.join(test.directory, "acp-write.txt")
      yield* Effect.promise(() => fs.writeFile(server, writeServerSource))
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(test.directory, "opencode.json"),
          JSON.stringify({
            acp: {
              writer: {
                type: "local",
                command: [process.execPath, server],
                environment: { TARGET_FILE: target },
                timeout: 5000,
              },
            },
          }),
        ),
      )

      const sessions = yield* Session.Service
      const revert = yield* SessionRevert.Service
      const acp = yield* ACPClient.Service
      const info = yield* sessions.create({
        title: "ACP writer test",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        agent: "writer-acp",
        model: { id: model.modelID, providerID: model.providerID },
      })
      const user: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID: info.id,
        role: "user",
        time: { created: Date.now() },
        agent: "writer-acp",
        model,
      }
      yield* sessions.updateMessage(user)
      const userPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        sessionID: info.id,
        messageID: user.id,
        type: "text",
        text: "write a file",
      })
      const assistant: MessageV2.Assistant = {
        id: MessageID.ascending(),
        parentID: user.id,
        role: "assistant",
        mode: "writer-acp",
        agent: "writer-acp",
        path: { cwd: test.directory, root: test.directory },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: model.modelID,
        providerID: model.providerID,
        time: { created: Date.now() },
        sessionID: info.id,
      }
      yield* sessions.updateMessage(assistant)

      yield* acp.run({
        server: "writer",
        agent: {
          name: "writer-acp",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        },
        session: info,
        user: { info: user, parts: [userPart] },
        assistant,
      })

      const content = yield* Effect.promise(() => fs.readFile(target, "utf8"))
      expect(content).toBe("written by acp")
      const messages = yield* sessions.messages({ sessionID: info.id })
      const stored = messages.find((message) => message.info.id === assistant.id)
      expect(stored?.parts.some((part) => part.type === "patch" && part.files.includes(target))).toBe(true)

      yield* revert.revert({ sessionID: info.id, messageID: user.id })
      const exists = yield* Effect.promise(() =>
        fs
          .access(target)
          .then(() => true)
          .catch(() => false),
      )
      expect(exists).toBe(false)
    }),
  { git: true },
)

it.instance("runs ACP terminal commands through a shell", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const server = path.join(test.directory, "terminal-acp-server.js")
    yield* Effect.promise(() => fs.writeFile(server, terminalServerSource))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({
          acp: {
            terminal: {
              type: "local",
              command: [process.execPath, server],
              timeout: 5000,
            },
          },
        }),
      ),
    )

    const sessions = yield* Session.Service
    const acp = yield* ACPClient.Service
    const info = yield* sessions.create({
      title: "terminal ACP client test",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      agent: "terminal-acp",
      model: { id: model.modelID, providerID: model.providerID },
    })
    const user: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: info.id,
      role: "user",
      time: { created: Date.now() },
      agent: "terminal-acp",
      model,
    }
    yield* sessions.updateMessage(user)
    const userPart = yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID: info.id,
      messageID: user.id,
      type: "text",
      text: "run shell",
    })
    const assistant: MessageV2.Assistant = {
      id: MessageID.ascending(),
      parentID: user.id,
      role: "assistant",
      mode: "terminal-acp",
      agent: "terminal-acp",
      path: { cwd: test.directory, root: test.directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.modelID,
      providerID: model.providerID,
      time: { created: Date.now() },
      sessionID: info.id,
    }
    yield* sessions.updateMessage(assistant)

    yield* acp.run({
      server: "terminal",
      agent: {
        name: "terminal-acp",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      session: info,
      user: { info: user, parts: [userPart] },
      assistant,
    })

    const messages = yield* sessions.messages({ sessionID: info.id })
    const stored = messages.find((message) => message.info.id === assistant.id)
    expect(stored?.parts.some((part) => part.type === "text" && part.text.includes("shell-ok"))).toBe(true)
  }),
)

it.instance("prepare creates remote ACP session and exposes config options without running a prompt", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const server = path.join(test.directory, "prepare-acp-server.js")
    yield* Effect.promise(() => fs.writeFile(server, configOptionServerSource))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({
          acp: {
            prepare: {
              type: "local",
              command: [process.execPath, server],
              timeout: 5000,
            },
          },
        }),
      ),
    )

    const sessions = yield* Session.Service
    const acp = yield* ACPClient.Service
    const bus = yield* Bus.Service
    const events: ACPClient.ACPStatePayload[] = []
    yield* bus.subscribeCallback(ACPClient.Event.StateUpdated, (event) => {
      events.push(event.properties)
    })

    const info = yield* sessions.create({
      title: "prepare test",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      agent: "prepare-acp",
      model: { id: model.modelID, providerID: model.providerID },
    })

    const result = yield* acp.prepare({
      server: "prepare",
      agent: {
        name: "prepare-acp",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      session: info,
    })

    expect(result.sessionID).toBe(info.id)
    const modelOption = (result.configOptions as Array<{ id: string; currentValue: string }> | undefined)?.find(
      (option) => option.id === "model",
    )
    expect(modelOption?.currentValue).toBe("alpha[]")

    yield* Effect.promise(async () => {
      const deadline = Date.now() + 2000
      while (events.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })
    expect(events.length).toBeGreaterThan(0)
    expect(events[events.length - 1]?.sessionID).toBe(info.id)
  }),
)

it.instance("updates ACP config option current value and publishes state event", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    const server = path.join(test.directory, "config-acp-server.js")
    yield* Effect.promise(() => fs.writeFile(server, configOptionServerSource))
    yield* Effect.promise(() =>
      fs.writeFile(
        path.join(test.directory, "opencode.json"),
        JSON.stringify({
          acp: {
            config: {
              type: "local",
              command: [process.execPath, server],
              timeout: 5000,
            },
          },
        }),
      ),
    )

    const sessions = yield* Session.Service
    const acp = yield* ACPClient.Service
    const bus = yield* Bus.Service
    const events: ACPClient.ACPStatePayload[] = []
    yield* bus.subscribeCallback(ACPClient.Event.StateUpdated, (event) => {
      events.push(event.properties)
    })

    const info = yield* sessions.create({
      title: "config option test",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      agent: "config-acp",
      model: { id: model.modelID, providerID: model.providerID },
    })
    const user: MessageV2.User = {
      id: MessageID.ascending(),
      sessionID: info.id,
      role: "user",
      time: { created: Date.now() },
      agent: "config-acp",
      model,
    }
    yield* sessions.updateMessage(user)
    const userPart = yield* sessions.updatePart({
      id: PartID.ascending(),
      sessionID: info.id,
      messageID: user.id,
      type: "text",
      text: "hello",
    })
    const assistant: MessageV2.Assistant = {
      id: MessageID.ascending(),
      parentID: user.id,
      role: "assistant",
      mode: "config-acp",
      agent: "config-acp",
      path: { cwd: test.directory, root: test.directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.modelID,
      providerID: model.providerID,
      time: { created: Date.now() },
      sessionID: info.id,
    }
    yield* sessions.updateMessage(assistant)

    yield* acp.run({
      server: "config",
      agent: {
        name: "config-acp",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      session: info,
      user: { info: user, parts: [userPart] },
      assistant,
    })

    const eventsBefore = events.length
    const response = yield* acp.setConfigOption({
      sessionID: info.id,
      configID: "model",
      value: "beta[]",
    })

    expect(response.configOptions).toBeDefined()
    const modelOption = (response.configOptions as Array<{ id: string; currentValue: string }>).find(
      (option) => option.id === "model",
    )
    expect(modelOption?.currentValue).toBe("beta[]")

    yield* Effect.promise(async () => {
      const deadline = Date.now() + 2000
      while (events.length <= eventsBefore && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    })
    expect(events.length).toBeGreaterThan(eventsBefore)
    const lastEvent = events[events.length - 1]
    expect(lastEvent?.sessionID).toBe(info.id)
    const eventModel = (lastEvent?.configOptions as Array<{ id: string; currentValue: string }> | undefined)?.find(
      (option) => option.id === "model",
    )
    expect(eventModel?.currentValue).toBe("beta[]")
  }),
)

const fakeServerSource = `
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  const lines = buffer.split("\\n")
  buffer = lines.pop() ?? ""
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "fake-acp", title: "Fake ACP", version: "1.0.0" },
          authMethods: [],
        },
      })
      continue
    }
    if (message.method === "session/new") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          sessionId: "remote_1",
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              type: "select",
              currentValue: "ask",
              options: [{ value: "ask", name: "Ask" }],
            },
          ],
        },
      })
      continue
    }
    if (message.method === "session/prompt") {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello from acp" },
          },
        },
      })
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "thinking" },
          },
        },
      })
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [{ name: "joke", description: "Tell a joke" }],
          },
        },
      })
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
          },
        },
      })
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call_1",
            title: "Fake tool",
            kind: "read",
            status: "pending",
            rawInput: { path: "README.md" },
          },
        },
      })
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_1",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "done" } }],
            rawOutput: { ok: true },
          },
        },
      })
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "final from acp" },
          },
        },
      })
      setTimeout(() => {
        write({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } })
      }, 50)
    }
  }
})
`

const silentServerSource = `
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  const lines = buffer.split("\\n")
  buffer = lines.pop() ?? ""
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "silent-acp", title: "Silent ACP", version: "1.0.0" },
          authMethods: [],
        },
      })
      continue
    }
    if (message.method === "session/new") {
      write({ jsonrpc: "2.0", id: message.id, result: { sessionId: "remote_silent" } })
      continue
    }
    if (message.method === "session/prompt") {
      write({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } })
    }
  }
})
`

const writeServerSource = `
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
let buffer = ""
let pendingPromptId
let pendingSessionId
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  const lines = buffer.split("\\n")
  buffer = lines.pop() ?? ""
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "writer-acp", title: "Writer ACP", version: "1.0.0" },
          authMethods: [],
        },
      })
      continue
    }
    if (message.method === "session/new") {
      write({ jsonrpc: "2.0", id: message.id, result: { sessionId: "remote_writer" } })
      continue
    }
    if (message.method === "session/prompt") {
      pendingPromptId = message.id
      pendingSessionId = message.params.sessionId
      write({
        jsonrpc: "2.0",
        id: 100,
        method: "fs/write_text_file",
        params: { sessionId: pendingSessionId, path: process.env.TARGET_FILE, content: "written by acp" },
      })
      continue
    }
    if (message.id === 100 && pendingPromptId !== undefined) {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: pendingSessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "wrote file" },
          },
        },
      })
      write({ jsonrpc: "2.0", id: pendingPromptId, result: { stopReason: "end_turn" } })
      pendingPromptId = undefined
    }
  }
})
`

const configOptionServerSource = `
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
let buffer = ""
let configOptions = [
  {
    id: "model",
    name: "Model",
    type: "select",
    category: "model",
    currentValue: "alpha[]",
    options: [
      { value: "alpha[]", name: "Alpha" },
      { value: "beta[]", name: "Beta" },
    ],
  },
]
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  const lines = buffer.split("\\n")
  buffer = lines.pop() ?? ""
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "config-acp", title: "Config ACP", version: "1.0.0" },
          authMethods: [],
        },
      })
      continue
    }
    if (message.method === "session/new") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: { sessionId: "remote_config", configOptions },
      })
      continue
    }
    if (message.method === "session/prompt") {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "ack" },
          },
        },
      })
      write({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } })
      continue
    }
    if (message.method === "session/set_config_option") {
      const target = configOptions.find((option) => option.id === message.params.configId)
      if (target) target.currentValue = message.params.value
      write({ jsonrpc: "2.0", id: message.id, result: { configOptions } })
      continue
    }
  }
})
`

const terminalServerSource = `
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
let buffer = ""
let promptId
let sessionId
let terminalId
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  const lines = buffer.split("\\n")
  buffer = lines.pop() ?? ""
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === "initialize") {
      write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {},
          agentInfo: { name: "terminal-acp", title: "Terminal ACP", version: "1.0.0" },
          authMethods: [],
        },
      })
      continue
    }
    if (message.method === "session/new") {
      write({ jsonrpc: "2.0", id: message.id, result: { sessionId: "remote_terminal" } })
      continue
    }
    if (message.method === "session/prompt") {
      promptId = message.id
      sessionId = message.params.sessionId
      write({
        jsonrpc: "2.0",
        id: 200,
        method: "terminal/create",
        params: { sessionId, command: "echo shell-ok | cat", cwd: process.cwd(), outputByteLimit: 10000 },
      })
      continue
    }
    if (message.id === 200) {
      terminalId = message.result.terminalId
      write({ jsonrpc: "2.0", id: 201, method: "terminal/wait_for_exit", params: { sessionId, terminalId } })
      continue
    }
    if (message.id === 201) {
      write({ jsonrpc: "2.0", id: 202, method: "terminal/output", params: { sessionId, terminalId } })
      continue
    }
    if (message.id === 202) {
      write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: message.result.output },
          },
        },
      })
      write({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } })
    }
  }
})
`
