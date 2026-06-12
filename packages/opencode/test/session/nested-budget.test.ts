import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import type { ToolExecutionOptions } from "ai"
import type { Agent } from "@/agent/agent"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Session } from "@/session/session"
import type { SessionProcessor } from "@/session/processor"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import type { TaskPromptOps } from "@/tool/task"
import { SessionTools } from "@/session/tools"
import { SubagentLimits } from "@/session/subagent-limits"
import { McpLazyActivation } from "@/session/mcp-lazy"
import { MessageID, SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

// Design-final §4.3 (Ü3): permission asks of nested subagents are routed to
// the root session (permissionSessionID). Without attribution, UIs and
// third-party clients lose WHO asked — so the ctx.ask wiring in
// SessionTools.resolve attaches origin metadata (originSessionID /
// originAgent / originDepth) whenever the ask is routed away from the asking
// session. These tests pin EXACTLY that wiring; the real lineage walk is
// covered by session-lineage.test.ts, so Session.Service is a stub here.
const it = testEffect(Layer.mergeAll(McpLazyActivation.defaultLayer))

const ROOT = SessionID.make("ses_origin_root")
const MID = SessionID.make("ses_origin_mid")
const LEAF = SessionID.make("ses_origin_leaf")

// A registry tool whose execute immediately asks — the seam under test.
const probeTool: Tool.Def = {
  id: "origin_probe",
  description: "asks for permission and returns",
  parameters: Schema.Struct({}),
  jsonSchema: { type: "object", properties: {} },
  execute: (_args, ctx) =>
    Effect.gen(function* () {
      yield* ctx.ask({ permission: "origin_probe", patterns: ["p"], always: [], metadata: { base: "keep" } })
      return { title: "probe", metadata: {}, output: "ok" }
    }),
}

const registryStub = ToolRegistry.Service.of({
  tools: () => Effect.succeed([probeTool]),
} as unknown as ToolRegistry.Interface)

const pluginStub = Plugin.Service.of({
  trigger: (() => Effect.succeed({})) as unknown as Plugin.Interface["trigger"],
} as unknown as Plugin.Interface)

const mcpStub = MCP.Service.of({
  tools: () => Effect.succeed({}),
} as unknown as MCP.Interface)

const truncateStub = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed("/tmp/unused"),
  output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  limits: () => Effect.succeed({ maxLines: 2000, maxBytes: 51200 }),
} as unknown as Truncate.Interface)

function capturePermission() {
  const asks: PermissionV1.AskInput[] = []
  const stub = Permission.Service.of({
    ask: (input: PermissionV1.AskInput) => Effect.sync(() => void asks.push(input)),
    reply: () => Effect.void,
    list: () => Effect.succeed([]),
  } as unknown as Permission.Interface)
  return { asks, stub }
}

/** Session.Service stub: only `lineage` is consumed by the wiring under test. */
const sessionStub = (lineage?: Session.Interface["lineage"]) =>
  Session.Service.of({
    lineage:
      lineage ??
      (() => Effect.die(new Error("lineage must not be walked for this resolve"))),
  } as unknown as Session.Interface)

/** A lineage chain as `Session.lineage` returns it: self → root. */
const chainOf = (...ids: SessionID[]) => ids.map((id) => ({ id }) as Session.Info)

const fakeModel = { providerID: "test", api: { id: "test-model" } } as Provider.Model

function resolveInput(session: { id: SessionID; parentID?: SessionID }, permissionSessionID?: SessionID) {
  return {
    agent: { name: "build", mode: "primary", permission: [], options: {} } as Agent.Info,
    model: fakeModel,
    session: session as Session.Info,
    permissionSessionID,
    processor: {
      message: { id: MessageID.make("msg_origin_test") } as SessionV1.Assistant,
      updateToolCall: () => Effect.succeed(undefined),
      completeToolCall: () => Effect.void,
    } as unknown as Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">,
    bypassAgentCheck: false,
    messages: [] as SessionV1.WithParts[],
    promptOps: {} as TaskPromptOps,
  }
}

const provideStubs =
  (permission: Permission.Service["Service"], session: Session.Service["Service"]) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.provideService(Plugin.Service, pluginStub),
      Effect.provideService(Permission.Service, permission),
      Effect.provideService(ToolRegistry.Service, registryStub),
      Effect.provideService(MCP.Service, mcpStub),
      Effect.provideService(Truncate.Service, truncateStub),
      Effect.provideService(Session.Service, session),
    )

const callOptions = { toolCallId: "call_origin_test", messages: [] } as unknown as ToolExecutionOptions

const runProbe = (
  input: ReturnType<typeof resolveInput>,
  permission: Permission.Service["Service"],
  session: Session.Service["Service"],
) =>
  Effect.gen(function* () {
    const tools = yield* SessionTools.resolve(input)
    expect(tools["origin_probe"]).toBeDefined()
    yield* Effect.promise(() => Promise.resolve(tools["origin_probe"].execute!({}, callOptions)))
  }).pipe(provideStubs(permission, session))

describe("SessionTools.resolve ask origin metadata", () => {
  it.instance("routed ask from depth 3 carries originSessionID/originAgent/originDepth", () =>
    Effect.gen(function* () {
      const { asks, stub } = capturePermission()
      const session = sessionStub(() => Effect.succeed(chainOf(LEAF, MID, ROOT)))
      yield* runProbe(resolveInput({ id: LEAF, parentID: MID }, ROOT), stub, session)
      expect(asks).toHaveLength(1)
      const ask = asks[0]!
      expect(ask.sessionID).toBe(ROOT)
      // base request metadata is preserved, origin fields are added
      expect(ask.metadata.base).toBe("keep")
      expect(ask.metadata.originSessionID).toBe(LEAF)
      expect(ask.metadata.originAgent).toBe("build")
      expect(ask.metadata.originDepth).toBe(3)
    }),
  )

  // Since T6.5 the lineage walk happens for EVERY resolve of a child session
  // (the registry's depth filter needs it), so the stub must serve a chain —
  // the pinned behavior is that an unrouted ask gains NO origin fields.
  it.instance("unrouted ask (no permissionSessionID) stays byte-identical: no origin fields", () =>
    Effect.gen(function* () {
      const { asks, stub } = capturePermission()
      const session = sessionStub(() => Effect.succeed(chainOf(LEAF, MID, ROOT)))
      yield* runProbe(resolveInput({ id: LEAF, parentID: MID }), stub, session)
      expect(asks).toHaveLength(1)
      const ask = asks[0]!
      expect(ask.sessionID).toBe(LEAF)
      expect(ask.metadata).toEqual({ base: "keep" })
    }),
  )

  it.instance("permissionSessionID equal to the session id adds no origin fields", () =>
    Effect.gen(function* () {
      const { asks, stub } = capturePermission()
      const session = sessionStub(() => Effect.succeed(chainOf(LEAF, MID, ROOT)))
      yield* runProbe(resolveInput({ id: LEAF, parentID: MID }, LEAF), stub, session)
      expect(asks).toHaveLength(1)
      expect(asks[0]!.sessionID).toBe(LEAF)
      expect(asks[0]!.metadata).toEqual({ base: "keep" })
    }),
  )

  it.instance("routed ask from a root session reports depth 1 without a lineage walk", () =>
    Effect.gen(function* () {
      const { asks, stub } = capturePermission()
      // parentID undefined ⇒ depth 1 by definition; the stub dies if walked.
      yield* runProbe(resolveInput({ id: LEAF }, ROOT), stub, sessionStub())
      expect(asks).toHaveLength(1)
      expect(asks[0]!.metadata.originSessionID).toBe(LEAF)
      expect(asks[0]!.metadata.originDepth).toBe(1)
    }),
  )

  it.instance("a failed lineage walk omits originDepth but never fails the ask", () =>
    Effect.gen(function* () {
      const { asks, stub } = capturePermission()
      const session = sessionStub(() => Effect.fail(SubagentLimits.lineageError({ sessionID: LEAF })))
      yield* runProbe(resolveInput({ id: LEAF, parentID: MID }, ROOT), stub, session)
      expect(asks).toHaveLength(1)
      const ask = asks[0]!
      expect(ask.sessionID).toBe(ROOT)
      expect(ask.metadata.originSessionID).toBe(LEAF)
      expect(ask.metadata.originAgent).toBe("build")
      expect("originDepth" in ask.metadata).toBe(false)
    }),
  )
})
