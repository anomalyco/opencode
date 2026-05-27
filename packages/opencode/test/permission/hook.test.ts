import { beforeEach, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { Bus } from "../../src/bus"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { testEffect } from "../lib/effect"
import { SessionID } from "../../src/session/schema"

// Regression coverage for Issue #227: the `permission.ask` plugin hook must
// fire from inside `Permission.Service.ask`, so that any caller (tools.ts,
// subtask path, MCP, …) automatically goes through plugin escalation without
// each caller wiring `plugin.trigger` itself.
//
// The previous wiring lived in `session/prompt.ts` and got silently dropped
// during the upstream v1.15.10 sync (PR #226), turning the
// `permission-policy` plugin into dead code. These tests fail if that
// regression returns.

type HookHandler = (
  input: { type: string; pattern: string | string[] | undefined },
  output: { status: "ask" | "deny" | "allow" },
) => void

// Per-test handler swapped in via beforeEach. Stored on a holder rather than
// captured by the layer so the layer can stay frozen across tests.
const holder: { handler: HookHandler | null } = { handler: null }

const bus = Bus.layer
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const fakePlugin = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    trigger: ((name: string, input: any, output: any) => {
      if (name === "permission.ask" && holder.handler) holder.handler(input, output)
      return Effect.succeed(output)
    }) as any,
    list: () => Effect.succeed([]),
    init: () => Effect.void,
  }),
)
const env = Layer.mergeAll(
  Permission.layer.pipe(Layer.provide(bus), Layer.provide(fakePlugin)),
  bus,
  CrossSpawnSpawner.defaultLayer,
  InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
)
const it = testEffect(env)

beforeEach(() => {
  holder.handler = null
})

const allowAll: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "allow" }]
const denyAll: Permission.Ruleset = [{ permission: "bash", pattern: "*", action: "deny" }]

const baseInput = (overrides?: Partial<Parameters<Permission.Interface["ask"]>[0]>) => ({
  permission: "bash",
  patterns: ["*"],
  sessionID: SessionID.make("ses_hook_test"),
  metadata: {},
  always: ["*"],
  ruleset: allowAll,
  ...overrides,
})

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 40; i++) {
      const list = yield* permission.list()
      if (list.length === count) return list
      yield* Effect.sleep("25 millis")
    }
    return yield* Effect.fail(new Error(`timed out waiting for ${count} pending request(s)`))
  })

it.instance("fires permission.ask hook for every pattern that the config ruleset resolves to allow", () =>
  Effect.gen(function* () {
    const seen: Array<{ type: string; pattern: string | string[] | undefined }> = []
    holder.handler = (input) => {
      seen.push({ type: input.type, pattern: input.pattern })
    }
    const permission = yield* Permission.Service
    yield* permission.ask(baseInput({ patterns: ["foo", "bar"] }))
    expect(seen).toEqual([
      { type: "bash", pattern: "foo" },
      { type: "bash", pattern: "bar" },
    ])
  }))

it.instance("does not fire the hook when the config ruleset resolves the pattern to deny", () =>
  Effect.gen(function* () {
    let calls = 0
    holder.handler = () => {
      calls++
    }
    const permission = yield* Permission.Service
    const exit = yield* permission.ask(baseInput({ ruleset: denyAll })).pipe(Effect.exit)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(calls).toBe(0)
  }))

it.instance("escalates allow -> ask when the hook raises the status, leaving the request pending", () =>
  Effect.gen(function* () {
    holder.handler = (_input, output) => {
      output.status = "ask"
    }
    const permission = yield* Permission.Service
    const fiber = yield* permission.ask(baseInput({ patterns: ["ls"] })).pipe(Effect.forkScoped)
    const pending = yield* waitForPending(1)
    expect(pending[0].permission).toBe("bash")
    expect(pending[0].patterns).toEqual(["ls"])
    yield* permission.reply({ requestID: pending[0].id, reply: "reject" })
    yield* Fiber.await(fiber)
  }))

it.instance("leaves the request as allow when the hook keeps the status at allow", () =>
  Effect.gen(function* () {
    holder.handler = (_input, _output) => {
      // explicitly no-op: keep status === "allow"
    }
    const permission = yield* Permission.Service
    // No fork: a non-escalated allow returns immediately.
    yield* permission.ask(baseInput({ patterns: ["ls"] }))
    const pending = yield* permission.list()
    expect(pending).toHaveLength(0)
  }))

it.instance("preserves in-session always-allow approvals on top of hook escalation", () =>
  Effect.gen(function* () {
    // Phase 1: hook escalates allow → ask, user replies with `always`, which
    // installs an `approved` rule for this (permission, pattern).
    holder.handler = (_input, output) => {
      output.status = "ask"
    }
    const permission = yield* Permission.Service
    const firstFiber = yield* permission.ask(baseInput({ patterns: ["ls"] })).pipe(Effect.forkScoped)
    const pending = yield* waitForPending(1)
    yield* permission.reply({ requestID: pending[0].id, reply: "always" })
    yield* Fiber.await(firstFiber)

    // Phase 2: a second ask for the same pattern should resolve via the
    // in-session approved ruleset (which evaluates AFTER the hook escalation)
    // and not land in pending.
    yield* permission.ask(baseInput({ patterns: ["ls"] }))
    const stillPending = yield* permission.list()
    expect(stillPending).toHaveLength(0)
  }))
