import { describe, expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { PersistentPty } from "@opencode/core/persistent-pty"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { ReadTerminalTool } from "@opencode/core/tool/plugin/read-terminal"
import { execute } from "@opencode/core/tool/runtime"
import { Document, Event, Info } from "@opencode/schema/config"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool as ToolSchema } from "@opencode/schema/tool"
import { Effect, Layer } from "effect"
import { fakeDaemon } from "./fixture/persistent-pty-daemon"
import { it } from "./lib/effect"
import { makePluginTestLayer } from "./plugin/fixture"

const sessionID = Session.ID.make("ses_read_terminal")

const context = {
  sessionID,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_read_terminal"),
  id: ToolSchema.CallID.make("call_read_terminal"),
  progress: () => Effect.void,
}

const enabled = () =>
  new Document({
    type: "document",
    info: new Info({ experimental: { terminal_read: true } }),
  })

const permissionLayer = (input: { assertions?: Permission.AssertInput[]; deny?: boolean } = {}) =>
  Layer.succeed(
    Permission.Service,
    Permission.Service.of({
      close: Effect.void,
      ask: (request) => Effect.succeed({ id: request.id ?? Permission.ID.create(), effect: "ask" }),
      assert: (request) => {
        input.assertions?.push(request)
        if (!input.deny) return Effect.void
        return Effect.fail(
          new Permission.BlockedError({
            permission: request.action,
            resources: [...request.resources],
            rules: [],
          }),
        )
      },
      assertNotDenied: () => Effect.void,
      allows: () => Effect.succeed(false),
      reply: () => Effect.void,
      get: () => Effect.succeed(undefined),
      forSession: () => Effect.succeed([]),
      list: () => Effect.succeed([]),
      nested: () => Effect.void,
    }),
  )

const register = Effect.gen(function* () {
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins, ReadTerminalTool.Plugin.id)
  yield* ReadTerminalTool.Plugin.effect(host)
  const tools = yield* Tool.Service
  return (yield* tools.list()).find((tool) => tool.name === "read_terminal")
})

type Daemon = Effect.Success<ReturnType<typeof fakeDaemon>>

const testLayer = (daemon: Daemon, permission = permissionLayer()) =>
  makePluginTestLayer(permission, undefined, [PersistentPty.node.replace(PersistentPty.configured(daemon.options))])

describe("ReadTerminalTool", () => {
  it.live("stays unregistered when the flag is off", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        expect(yield* register).toBeUndefined()
      }).pipe(Effect.provide(testLayer(daemon)))
    }),
  )

  it.live("appears when the flag is enabled without registering again", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        const bus = yield* Bus.Service
        const tools = yield* Tool.Service
        expect(yield* register).toBeUndefined()

        yield* (yield* Config.Test).setEntries([enabled()])
        yield* bus.publish(Event.Updated, {})

        for (let attempt = 0; attempt < 200; attempt++) {
          if ((yield* tools.list()).some((tool) => tool.name === "read_terminal")) return
          yield* Effect.sleep("10 millis")
        }
        throw new Error("Timed out waiting for read_terminal registration")
      }).pipe(Effect.provide(testLayer(daemon)))
    }),
  )

  it.live("reads the visible terminal and records the permission", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      const assertions: Permission.AssertInput[] = []
      yield* Effect.gen(function* () {
        yield* (yield* Config.Test).setEntries([enabled()])
        const pty = yield* PersistentPty.Service
        const terminal = yield* pty.create(sessionID, {
          args: [],
          cwd: daemon.options.root,
          title: "Build",
          env: {},
        })
        yield* pty.control(terminal.id, "test", 80, 24)
        daemon.setRows(terminal.id, ["one", "two", "three"])

        const tool = yield* register
        if (!tool) throw new Error("expected read_terminal tool")

        const result = yield* execute(tool, {}, context)
        const content = result.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

        expect(content).toBe('Terminal "Build" · /tmp · 80x24\n\none\ntwo\nthree')
        expect(result.metadata).toEqual({
          ptyID: terminal.id,
          title: "Build",
          cwd: "/tmp",
          cols: 80,
          rows: 24,
          cursor: { x: 0, y: 2 },
        })
        expect(assertions).toHaveLength(1)
        expect(assertions[0]).toMatchObject({
          action: "terminal",
          resources: [`terminal:${terminal.id}`],
          save: [`terminal:${terminal.id}`],
          sessionID,
        })
      }).pipe(Effect.provide(testLayer(daemon, permissionLayer({ assertions }))))
    }),
  )

  it.live("passes lines through to the daemon", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        yield* (yield* Config.Test).setEntries([enabled()])
        const pty = yield* PersistentPty.Service
        const terminal = yield* pty.create(sessionID, {
          args: [],
          cwd: daemon.options.root,
          title: "Build",
          env: {},
        })
        yield* pty.control(terminal.id, "test", 80, 24)
        daemon.setRows(terminal.id, ["one", "two", "three"])

        const tool = yield* register
        if (!tool) throw new Error("expected read_terminal tool")

        const result = yield* execute(tool, { lines: 2 }, context)
        const content = result.content?.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")

        expect(content).toContain("two\nthree")
        expect(content).not.toContain("one")
        expect(daemon.requests.findLast((request) => request.op === "read_rows")?.rows).toBe(2)
      }).pipe(Effect.provide(testLayer(daemon)))
    }),
  )

  it.live("fails cleanly when no terminal is visible", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        yield* (yield* Config.Test).setEntries([enabled()])

        const tool = yield* register
        if (!tool) throw new Error("expected read_terminal tool")

        const error = yield* execute(tool, {}, context).pipe(Effect.flip)

        expect(error).toMatchObject({
          _tag: "Tool.Error",
          message:
            "No terminal is visible in this session. Ask the user to open one in the terminal panel, then try again.",
        })
      }).pipe(Effect.provide(testLayer(daemon)))
    }),
  )

  it.live("reports a denied terminal read", () =>
    Effect.gen(function* () {
      const daemon = yield* fakeDaemon()
      yield* Effect.gen(function* () {
        yield* (yield* Config.Test).setEntries([enabled()])
        const pty = yield* PersistentPty.Service
        const terminal = yield* pty.create(sessionID, {
          args: [],
          cwd: daemon.options.root,
          title: "Build",
          env: {},
        })
        yield* pty.control(terminal.id, "test", 80, 24)
        daemon.setRows(terminal.id, ["one", "two"])

        const tool = yield* register
        if (!tool) throw new Error("expected read_terminal tool")

        const error = yield* execute(tool, {}, context).pipe(Effect.flip)

        expect(error).toMatchObject({ _tag: "Tool.Error", message: "Permission denied: terminal" })
      }).pipe(Effect.provide(testLayer(daemon, permissionLayer({ deny: true }))))
    }),
  )
})
