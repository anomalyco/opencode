/**
 * @spec-handoff
 * @interface TaskTool input schema — OPTIONAL `model` parameter
 *   model?: string   // format "providerID/modelID", e.g. "anthropic/claude-sonnet-4"
 *   Lives in BaseParameterFields (src/tool/task.ts:53-56) so it flows into BOTH
 *   `BaseParameters` (jsonSchema) and `Parameters`.
 *
 * @behavior
 *   1. model OMITTED → subagent runs on `agent.model` if set, else inherits the parent
 *      assistant message's { providerID, modelID }. The `model` passed to ops.prompt
 *      equals that inherited/agent model; `variant` stays the parent variant when the
 *      agent has no model of its own.
 *   2. model = VALID "providerID/modelID" → overrides BOTH agent.model and parent
 *      inheritance. Parsed with Provider.parseModel and validated with Provider.getModel.
 *      The `model` passed to ops.prompt equals the parsed { providerID, modelID }, and
 *      `variant` becomes undefined (treated like an explicit agent-model override). The
 *      override beats the subagent's OWN configured model, not just parent inheritance.
 *   --- DIFFERENTIATED failure messages (replaces the single generic "Invalid task model
 *       …: expected \"providerID/modelID\" naming a known provider and model." string). A
 *       failed override surfaces exactly ONE of three messages, chosen by the impl from the
 *       FAILURE SHAPE, never by matching on message substrings:
 *
 *       (A) FORMAT — malformed input caught by the LOCAL format guard BEFORE any provider
 *           lookup: no-slash (parseModel yields an empty modelID), empty string, empty
 *           segment ("anthropic/"), or a prototype-chain key ("anthropic/__proto__",
 *           "__proto__/x", "anthropic/toString", "anthropic/valueOf"). Message:
 *             Invalid task model "<requested>": expected "provider/model" format, e.g. "anthropic/claude-sonnet-4".
 *           Contains "format"; must NOT read as "unavailable"; must NOT leak a raw
 *           "Cannot read properties of undefined" TypeError. The guard uses a
 *           prototype-membership check (`segment in {}`), so inherited members like
 *           toString/valueOf are rejected too — a fixed denylist is insufficient.
 *
 *       (B) UNAVAILABLE provider — a WELL-FORMED string whose providerID is NOT among the
 *           configured providers (Provider.list() membership). getModel raises
 *           ModelNotFoundError; the impl confirms the providerID is ABSENT from list() and
 *           emits:
 *             Model unavailable: provider "<providerID>" is not configured.
 *           plus, when the error carries suggestions, ` Did you mean: <s1, s2, …>?`.
 *           Contains "is not configured" + the provider name + suggestion names; NOT "format".
 *
 *       (C) UNAVAILABLE model — a WELL-FORMED string whose providerID IS configured
 *           (PRESENT in Provider.list()) but whose modelID is missing. getModel raises
 *           ModelNotFoundError; the impl confirms the providerID is PRESENT in list() and
 *           emits:
 *             Model unavailable: model "<modelID>" is not available for provider "<providerID>".
 *           plus the same ` Did you mean: <s1, s2, …>?` suggestions clause. Contains
 *           "is not available for provider" + the model + provider names + suggestion names.
 *
 *       SUGGESTIONS CLAUSE (cases B and C) — the ` Did you mean: …?` tail is CONDITIONAL on
 *       `error.suggestions && error.suggestions.length`:
 *         • Populated (length ≥ 1) → ` Did you mean: <s1, s2, …>?` where the names are
 *           `suggestions.join(", ")` — a ", " separator that preserves the array order. A
 *           SINGLE-element array therefore renders with NO comma ("Did you mean: anthropic?").
 *         • EMPTY array ([]) OR OMITTED (undefined) → the FALSE branch: NO clause is appended;
 *           the base message stands alone with no "Did you mean" text. Both falsey shapes are
 *           exercised so the conditional's false arm is not an assertion vacuum.
 *
 *       Discrimination is by the ModelNotFoundError TAG ("ProviderModelNotFoundError") plus
 *       Provider.list() membership on the impl side — NOT by message substrings. Tests
 *       assert only the user-facing message TEXT (the contract the user sees).
 *
 *   3. model = unknown provider (well-formed) → case (B). ops.prompt is never called and NO
 *      child subagent session is created (validation short-circuits before spawning).
 *   4. model = unknown model in a KNOWN provider (well-formed) → case (C). ops.prompt is
 *      never called and NO child session is created.
 *   5. model = malformed string with no "/", "" (empty string), or empty segment → case (A).
 *      Empty is NOT treated as "omitted": the gate is `params.model !== undefined`, not a
 *      truthiness check, so an empty string never silently inherits. ops.prompt is never
 *      called.
 *   6. model = prototype-polluting key ("anthropic/__proto__", "__proto__/x") OR an inherited
 *      Object.prototype method name as the modelID ("anthropic/toString", "anthropic/valueOf")
 *      → case (A). Must NOT bypass validation (treating an inherited Object.prototype member
 *      as a "found" model) and must NOT surface a raw "Cannot read properties of undefined"
 *      TypeError. ops.prompt is never called and NO child session is created.
 *   7. model = VALID multi-slash modelID, e.g. "openrouter/anthropic/claude-3.5" →
 *      providerID is the FIRST segment ("openrouter"); modelID is the remainder joined
 *      back with "/" ("anthropic/claude-3.5"). Resolves and is passed through to ops.prompt
 *      exactly as { providerID: "openrouter", modelID: "anthropic/claude-3.5" }.
 *
 * @edge-cases
 *   - Only a present (`!== undefined`) model string triggers validation; omission alone
 *     preserves the inheritance behavior. An empty string is present → it validates → fails.
 *   - Override validation runs through Provider.getModel BEFORE the child session is created
 *     and BEFORE ops.prompt — a failed validation must short-circuit so neither happens.
 *   - The error message must surface the user-supplied model string for actionability,
 *     including for prototype-polluting keys (no raw TypeError leakage).
 *   - Case (B) vs (C) is decided by Provider.list() membership of the parsed providerID, NOT
 *     by inspecting the ModelNotFoundError fields or message text. The mock harness therefore
 *     EXCLUDES the case-(B) providerID from list() and INCLUDES the case-(C) providerID.
 *   - ModelNotFoundError raised for cases (B)/(C) carries a `suggestions` array whose
 *     CONTENT is varied per request by the mock so BOTH arms of the conditional clause are
 *     covered: NON-EMPTY (multi- and single-element) exercises the rendered ` Did you mean:
 *     …?` tail and its ", " join, while EMPTY ([]) and OMITTED (undefined) exercise the false
 *     branch where no clause is appended. A uniformly non-empty fixture would leave the false
 *     branch an assertion vacuum.
 *
 * @helpers Provider.parseModel, Provider.getModel, Provider.list, Provider.ModelNotFoundError
 * @see src/provider/provider.ts (getModel record lookup: provider.ts:1747-1768;
 *      parseModel split-on-"/": provider.ts:1944)
 */
import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { Cause, Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"

import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Provider } from "@/provider/provider"
import { ProviderTest } from "../fake/provider"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    EventV2Bridge.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    Database.defaultLayer,
    RuntimeFlags.layer(flags),
  ).pipe(Layer.provide(Ripgrep.defaultLayer))

const it = testEffect(layer())
const background = testEffect(layer({ experimentalBackgroundSubagents: true }))

// A model the Task tool's `model` override is allowed to resolve to.
// Distinct from `ref` (the inherited parent/seed model) so override vs. inheritance
// can be told apart by the captured ops.prompt input.
const overrideRef = {
  providerID: ProviderV2.ID.make("anthropic"),
  modelID: ModelV2.ID.make("claude-sonnet-4"),
}

// A second valid model whose modelID itself contains slashes. parseModel keeps the
// FIRST "/" segment as the providerID and joins the rest back as the modelID, so the
// string "openrouter/anthropic/claude-3.5" must resolve to this pair.
const multiSlashRef = {
  providerID: ProviderV2.ID.make("openrouter"),
  modelID: ModelV2.ID.make("anthropic/claude-3.5"),
}

// Known-model catalog for the override-validation tests. Declared as plain object
// literals ON PURPOSE: the real Provider.getModel resolves models with record lookups
// (`s.providers[providerID]` provider.ts:1749, then `provider.models[modelID]`
// provider.ts:1760). A prototype key like "__proto__" therefore resolves through
// Object.prototype here exactly as it would against real provider state, which is what
// lets the prototype-key tests exercise the genuine lookup hazard instead of a
// pre-sanitized mock.
const knownModels: Record<string, { models: Record<string, Provider.Model> }> = {
  anthropic: {
    models: {
      "claude-sonnet-4": ProviderTest.model({ id: overrideRef.modelID, providerID: overrideRef.providerID }),
    },
  },
  openrouter: {
    models: {
      "anthropic/claude-3.5": ProviderTest.model({ id: multiSlashRef.modelID, providerID: multiSlashRef.providerID }),
    },
  },
}

// Real, NON-EMPTY suggestion strings the mock attaches to ModelNotFoundError. The impl
// surfaces these in the " Did you mean: …?" clause; tests assert their presence by name.
// Leaving these empty/undefined would make the suggestion assertions vacuous.
const providerSuggestions = ["anthropic", "openrouter"]
const modelSuggestions = ["claude-sonnet-4", "claude-haiku-4"]

// Sentinel suggestion fixtures keyed by a request identifier, so ONE mock can drive BOTH
// the populated " Did you mean: …?" clause AND its FALSE branch without per-test rewiring.
// The impl renders the clause only when `suggestions && suggestions.length`, so an empty
// array AND an omitted (undefined) field must BOTH suppress it. A single-element array
// pins the no-comma rendering ("Did you mean: anthropic?"). Keys absent here fall back to
// the default NON-EMPTY suggestions above.
//   - case B (provider not configured), keyed by the parsed providerID:
const providerSuggestionsByID: Record<string, string[] | undefined> = {
  "bogus-empty": [], //            false branch: empty array → no clause
  "bogus-single": ["anthropic"], // single element → clause has no ", " separator
}
//   - case C (model missing in a known provider), keyed by the parsed modelID:
const modelSuggestionsByID: Record<string, string[] | undefined> = {
  "ghost-undefined": undefined, // false branch: omitted suggestions → no clause
}

// What resolver.list() reports as CONFIGURED. The impl discriminates UNAVAILABLE case B
// (provider ABSENT here → "provider … is not configured") from case C (provider PRESENT
// here but the model missing → "model … is not available for provider …") by list()
// MEMBERSHIP — not by message substrings. So "anthropic"/"openrouter" are present (case C
// source: e.g. "anthropic/ghost-model") and "bogus" is absent (case B source).
const configuredProviders: Record<ProviderV2.ID, Provider.Info> = {
  [overrideRef.providerID]: ProviderTest.info(
    { id: overrideRef.providerID },
    knownModels.anthropic.models[overrideRef.modelID],
  ),
  [multiSlashRef.providerID]: ProviderTest.info(
    { id: multiSlashRef.providerID },
    knownModels.openrouter.models[multiSlashRef.modelID],
  ),
}

// Mirror Provider.getModel (provider.ts:1747-1768): a missing provider OR a missing model
// raises a REAL ModelNotFoundError (tag "ProviderModelNotFoundError") carrying a NON-EMPTY
// suggestions array; whatever the records resolve is treated as a found model — including
// anything reachable via the prototype chain. The record lookups are deliberately unguarded
// so prototype-polluting keys behave as they do in production (they never reach here anyway:
// the impl's local format guard rejects them first — case A). `list()` returns the configured
// providers so the impl can tell case B (absent) from case C (present) by membership.
const providerMock = Layer.mock(Provider.Service)({
  list: () => Effect.succeed(configuredProviders),
  getModel: (providerID, modelID) =>
    Effect.gen(function* () {
      const provider = knownModels[providerID]
      // Case B source: provider not in the catalog → suggest known provider names. The
      // suggestions VARY by providerID so a single mock exercises the populated clause,
      // the empty-array false branch, and the single-element (no-comma) rendering.
      if (!provider) {
        const suggestions = Object.hasOwn(providerSuggestionsByID, providerID)
          ? providerSuggestionsByID[providerID]
          : providerSuggestions
        return yield* Effect.fail(new Provider.ModelNotFoundError({ providerID, modelID, suggestions }))
      }
      const info = provider.models[modelID]
      // Case C source: provider known, model missing → suggest known model names. The
      // suggestions VARY by modelID so a single mock exercises the populated clause and
      // the omitted-suggestions (undefined) false branch.
      if (!info) {
        const suggestions = Object.hasOwn(modelSuggestionsByID, modelID)
          ? modelSuggestionsByID[modelID]
          : modelSuggestions
        return yield* Effect.fail(new Provider.ModelNotFoundError({ providerID, modelID, suggestions }))
      }
      return info
    }),
})

const withModel = testEffect(Layer.mergeAll(layer(), providerMock))

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const seed = Effect.fn("TaskToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void; text?: string }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        return reply(input, opts?.text ?? "done")
      }),
  }
}

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

describe("tool.task", () => {
  it.instance(
    "description sorts subagents by name and is stable across calls",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const get = Effect.fnUntraced(function* () {
          const tools = yield* registry.tools({ ...ref, agent: build })
          return tools.find((tool) => tool.id === TaskTool.id)?.description ?? ""
        })
        const first = yield* get()
        const second = yield* get()

        expect(first).toBe(second)

        const alpha = first.indexOf("- alpha: Alpha agent")
        const explore = first.indexOf("- explore:")
        const general = first.indexOf("- general:")
        const zebra = first.indexOf("- zebra: Zebra agent")

        expect(alpha).toBeGreaterThan(-1)
        expect(explore).toBeGreaterThan(alpha)
        expect(general).toBeGreaterThan(explore)
        expect(zebra).toBeGreaterThan(general)
      }),
    {
      config: {
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance(
    "description hides denied subagents for the caller",
    () =>
      Effect.gen(function* () {
        const agent = yield* Agent.Service
        const build = yield* agent.get("build")
        const registry = yield* ToolRegistry.Service
        const description =
          (yield* registry.tools({ ...ref, agent: build })).find((tool) => tool.id === TaskTool.id)?.description ?? ""

        expect(description).toContain("- alpha: Alpha agent")
        expect(description).not.toContain("- zebra: Zebra agent")
      }),
    {
      config: {
        permission: {
          task: {
            "*": "allow",
            zebra: "deny",
          },
        },
        agent: {
          zebra: {
            description: "Zebra agent",
            mode: "subagent",
          },
          alpha: {
            description: "Alpha agent",
            mode: "subagent",
          },
        },
      },
    },
  )

  it.instance("execute resumes an existing task session from task_id", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "Existing child" })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "resumed", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: child.id,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(child.id)
      expect(result.metadata.sessionId).toBe(child.id)
      expect(result.output).toContain(`<task id="${child.id}" state="completed">`)
      expect(seen?.sessionID).toBe(child.id)
      expect(seen?.variant).toBe("xhigh")
    }),
  )

  it.instance("execute asks by default and skips checks when bypassed", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const calls: unknown[] = []
      const promptOps = stubOps()

      const exec = (extra?: Record<string, any>) =>
        def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: (input) =>
              Effect.sync(() => {
                calls.push(input)
              }),
          },
        )

      yield* exec()
      yield* exec({ bypassAgentCheck: true })

      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({
        permission: "task",
        patterns: ["general"],
        always: ["*"],
        metadata: {
          description: "inspect bug",
          subagent_type: "general",
        },
      })
    }),
  )

  it.instance("execute cancels child session when abort signal fires", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = defer<SessionPrompt.PromptInput>()
      const cancelled = defer<SessionID>()
      const abort = new AbortController()
      const promptOps: TaskPromptOps = {
        cancel: (sessionID) =>
          Effect.sync(() => {
            cancelled.resolve(sessionID)
          }),
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) =>
          Effect.promise(() => {
            ready.resolve(input)
            return cancelled.promise
          }).pipe(Effect.as(reply(input, "cancelled"))),
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: abort.signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      const input = yield* Effect.promise(() => ready.promise)
      abort.abort()
      expect(yield* Effect.promise(() => cancelled.promise)).toBe(input.sessionID)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.instance("execute creates a child when task_id does not exist", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ text: "created", onPrompt: (input) => (seen = input) })

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          task_id: "ses_missing",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
      expect(result.metadata.sessionId).not.toBe("ses_missing")
      expect(result.output).toContain(`<task id="${result.metadata.sessionId}" state="completed">`)
      expect(seen?.sessionID).toBe(result.metadata.sessionId)
    }),
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "reviewer",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const child = yield* sessions.get(result.metadata.sessionId)
        expect(child.parentID).toBe(chat.id)
        expect(child.agent).toBe("reviewer")
        expect(child.permission).toEqual([
          {
            permission: "todowrite",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "bash",
            pattern: "*",
            action: "deny",
          },
          {
            permission: "read",
            pattern: "*",
            action: "deny",
          },
        ])
        expect(seen?.tools).toBeUndefined()
      }),
    {
      config: {
        agent: {
          reviewer: {
            mode: "subagent",
            permission: {
              task: "allow",
            },
          },
        },
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  it.instance("rejects background execution when the experiment is disabled", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            background: true,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )

  it.instance("promotes a running foreground task without restarting it", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const ready = yield* Deferred.make<void>()
      const done = yield* Deferred.make<void>()
      const injected = yield* Deferred.make<SessionPrompt.PromptInput>()
      let runs = 0
      const promptOps: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            return Deferred.succeed(injected, input).pipe(Effect.as(reply(input, "injected")))
          }
          return Effect.gen(function* () {
            runs += 1
            yield* Deferred.succeed(ready, undefined)
            yield* Deferred.await(done)
            return reply(input, "background done")
          })
        },
      }

      const fiber = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(ready)
      const job = (yield* jobs.list())[0]
      expect(job).toBeDefined()
      if (!job) throw new Error("task job not found")
      expect(job.metadata?.parentSessionId).toBe(chat.id)
      yield* jobs.promote(job.id)

      const result = yield* Fiber.join(fiber)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect((yield* jobs.get(result.metadata.sessionId))?.status).toBe("running")
      expect(runs).toBe(1)

      yield* Deferred.succeed(done, undefined)
      expect((yield* jobs.wait({ id: result.metadata.sessionId })).info?.output).toBe("background done")
      expect((yield* Deferred.await(injected)).parts[0]?.type).toBe("text")
      expect(runs).toBe(1)
    }),
  )

  background.instance("execute launches background tasks without waiting for completion", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const job = yield* jobs.get(result.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain(`state="running"`)
      expect(job?.status).toBe("running")
    }),
  )

  background.instance("background task completion waits for running updates", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      const first = defer<void>()
      const second = defer<void>()
      const updated = defer<SessionPrompt.PromptInput>()
      const injected = defer<SessionPrompt.PromptInput>()
      let prompts = 0
      const promptOps: TaskPromptOps = {
        ...stubOps(),
        prompt: (input) => {
          if (input.sessionID === chat.id) {
            injected.resolve(input)
            return Effect.succeed(reply(input, "done"))
          }
          prompts++
          if (prompts === 1) return Effect.promise(() => first.promise).pipe(Effect.as(reply(input, "first done")))
          updated.resolve(input)
          return Effect.promise(() => second.promise).pipe(Effect.as(reply(input, "second done")))
        },
      }
      const context = {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      }

      const started = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        context,
      )
      const result = yield* def.execute(
        {
          description: "add investigation scope",
          prompt: "also inspect cancellation",
          subagent_type: "general",
          task_id: started.metadata.sessionId,
        },
        context,
      )

      expect(result.metadata.sessionId).toBe(started.metadata.sessionId)
      expect(result.metadata.background).toBe(true)
      expect(result.output).toContain("Background task updated")
      first.resolve()
      expect((yield* jobs.get(started.metadata.sessionId))?.status).toBe("running")
      expect((yield* Effect.promise(() => updated.promise)).parts).toEqual([
        { type: "text", text: "also inspect cancellation" },
      ])

      second.resolve()
      const waited = yield* jobs.wait({ id: started.metadata.sessionId, timeout: 1_000 })
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("second done")
      const notification = yield* Effect.promise(() => injected.promise)
      expect(notification.variant).toBe("xhigh")
      expect(notification.parts[0]?.type).toBe("text")
      if (notification.parts[0]?.type === "text") expect(notification.parts[0].text).toContain("second done")
    }),
  )

  background.instance("background tasks complete through the background job service", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "background done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
      expect(waited.info?.output).toBe("background done")
    }),
  )

  background.instance("background task completion does not wait for the parent async prompt", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps({ text: "background done" }),
              prompt: (input) =>
                input.sessionID === chat.id ? Effect.never : Effect.succeed(reply(input, "background done")),
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("completed")
    }),
  )

  background.instance("removing the parent session cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("removing the child task session cancels its running background task", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* sessions.remove(result.metadata.sessionId)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  background.instance("cancelling the parent run cancels running background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
          background: true,
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: {
            promptOps: {
              ...stubOps(),
              prompt: () => Effect.never,
            } satisfies TaskPromptOps,
          },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      yield* runState.cancel(chat.id)
      const waited = yield* jobs.wait({ id: result.metadata.sessionId, timeout: 1_000 })
      expect(waited.timedOut).toBe(false)
      expect(waited.info?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a child run cancels its own pre-runner task job", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })

      yield* runState.cancel(child.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
    }),
  )

  it.instance("cancelling a parent run recursively cancels descendant background tasks", () =>
    Effect.gen(function* () {
      const jobs = yield* BackgroundJob.Service
      const runState = yield* SessionRunState.Service
      const sessions = yield* Session.Service
      const { chat } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const grandchild = yield* sessions.create({ parentID: child.id, title: "grandchild" })

      yield* jobs.start({
        id: child.id,
        type: "task",
        metadata: { parentSessionId: chat.id, sessionId: child.id },
        run: Effect.never,
      })
      yield* jobs.start({
        id: grandchild.id,
        type: "task",
        metadata: { parentSessionId: child.id, sessionId: grandchild.id },
        run: Effect.never,
      })

      yield* runState.cancel(chat.id)

      expect((yield* jobs.get(child.id))?.status).toBe("cancelled")
      expect((yield* jobs.get(grandchild.id))?.status).toBe("cancelled")
    }),
  )
})

describe("tool.task model override", () => {
  // Behavior 1 — omitting `model` preserves inheritance. The captured ops.prompt input
  // uses the parent/seed model and keeps the parent variant (the "general" agent has no
  // model of its own).
  withModel.instance("omitting model preserves inherited parent model and variant", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      yield* def.execute(
        {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "general",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(seen?.model).toEqual(ref)
      expect(seen?.variant).toBe("xhigh")
    }),
  )

  // Behavior 2 — a valid "providerID/modelID" overrides both agent.model and parent
  // inheritance. The captured model equals Provider.parseModel(params.model), and variant
  // is undefined (treated like an explicit agent-model override).
  withModel.instance("valid model param overrides agent and parent inheritance", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      // Stored in a const so the extra `model` key is accepted by width subtyping.
      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "anthropic/claude-sonnet-4",
      }

      yield* def.execute(params, {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      })

      expect(seen?.model).toEqual(overrideRef)
      expect(seen?.variant).toBeUndefined()
    }),
  )

  // Case B — UNAVAILABLE provider. A well-formed "providerID/modelID" whose providerID is
  // NOT among the configured providers (resolver.list()). getModel raises a real
  // ModelNotFoundError; the impl, seeing the providerID ABSENT from list(), surfaces the
  // "provider … is not configured" message plus a " Did you mean: …?" suggestion clause.
  // It is NOT a FORMAT error (the string is well-formed).
  withModel.instance("unavailable provider fails with a 'not configured' message and suggestions", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "bogus/does-not-exist",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("is not configured")
      expect(rendered).toContain("bogus")
      expect(rendered).toContain("Did you mean")
      // Pin the exact join: a ", " separator preserving fixture order (not a bare list).
      expect(rendered).toContain("Did you mean: anthropic, openrouter")
      // Anti-vacuum guard: a fixture emptied by accident must not let the loop pass silently.
      expect(providerSuggestions.length).toBeGreaterThan(0)
      for (const suggestion of providerSuggestions) expect(rendered).toContain(suggestion)
      expect(rendered).not.toContain("format")
      expect(prompted).toBe(false)
    }),
  )

  // Case C — UNAVAILABLE model in a KNOWN provider. "anthropic" IS configured (present in
  // resolver.list()), but "ghost-model" is not one of its models. getModel raises a real
  // ModelNotFoundError; the impl, seeing the providerID PRESENT in list(), surfaces the
  // "model … is not available for provider …" message plus a " Did you mean: …?" clause.
  withModel.instance("unavailable model in a known provider fails with a model-level message and suggestions", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "anthropic/ghost-model",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("is not available for provider")
      expect(rendered).toContain("ghost-model")
      expect(rendered).toContain("anthropic")
      expect(rendered).toContain("Did you mean")
      // Pin the exact join: a ", " separator preserving fixture order (not a bare list).
      expect(rendered).toContain("Did you mean: claude-sonnet-4, claude-haiku-4")
      // Anti-vacuum guard: a fixture emptied by accident must not let the loop pass silently.
      expect(modelSuggestions.length).toBeGreaterThan(0)
      for (const suggestion of modelSuggestions) expect(rendered).toContain(suggestion)
      expect(rendered).not.toContain("format")
      expect(prompted).toBe(false)
    }),
  )

  // Case B, FALSE suggestions branch — `error.suggestions` is an EMPTY array, so the
  // `error.suggestions && error.suggestions.length ? …` clause renders nothing. The
  // "provider … is not configured" message must stand alone with NO " Did you mean: …?"
  // tail. This pins the untested false arm of the conditional suffix.
  withModel.instance("unavailable provider with empty suggestions omits the 'Did you mean' clause", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "bogus-empty/does-not-exist",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("is not configured")
      expect(rendered).toContain("bogus-empty")
      expect(rendered).not.toContain("Did you mean")
      expect(rendered).not.toContain("format")
      expect(prompted).toBe(false)
    }),
  )

  // Case C, FALSE suggestions branch — `error.suggestions` is OMITTED (undefined), so the
  // `error.suggestions && …` clause short-circuits and renders nothing. The "model … is not
  // available for provider …" message must stand alone with NO " Did you mean: …?" tail.
  withModel.instance("unavailable model with omitted suggestions omits the 'Did you mean' clause", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "anthropic/ghost-undefined",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("is not available for provider")
      expect(rendered).toContain("ghost-undefined")
      expect(rendered).toContain("anthropic")
      expect(rendered).not.toContain("Did you mean")
      expect(rendered).not.toContain("format")
      expect(prompted).toBe(false)
    }),
  )

  // Suggestions JOIN format, single element — a ONE-element suggestions array renders with
  // NO ", " separator: "Did you mean: anthropic?" exactly. This complements the multi-element
  // B/C tests (which pin the ", " separator) by pinning the degenerate single-suggestion case.
  withModel.instance("single suggestion renders without a comma separator", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "bogus-single/does-not-exist",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("is not configured")
      // Exactly one suggestion → the clause ends right after the name, with no ", ".
      expect(rendered).toContain("Did you mean: anthropic?")
      expect(rendered).not.toContain("Did you mean: anthropic,")
      expect(prompted).toBe(false)
    }),
  )

  // Case A — FORMAT error. A string with no "/" makes parseModel yield an empty modelID,
  // caught by the LOCAL format guard BEFORE any provider lookup. The message names the bad
  // value and the expected "provider/model" format; it must NOT read as "unavailable".
  withModel.instance("malformed model without a slash fails with a FORMAT error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "not-a-valid-model",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain('Invalid task model "not-a-valid-model"')
      expect(rendered).toContain("format")
      expect(rendered).not.toContain("unavailable")
      expect(prompted).toBe(false)
    }),
  )

  // Case A (M1) — the gate is `params.model !== undefined`, so an empty string counts as
  // PRESENT: it hits the FORMAT guard (empty segments) and fails rather than silently
  // inheriting. ops.prompt is never called.
  withModel.instance("empty-string model fails with a FORMAT error instead of inheriting", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain('Invalid task model ""')
      expect(rendered).toContain("format")
      expect(rendered).not.toContain("unavailable")
      expect(prompted).toBe(false)
    }),
  )

  // Case A — FORMAT error. An empty trailing segment ("anthropic/") leaves modelID empty;
  // the format guard rejects it BEFORE any provider lookup, even though "anthropic" is a
  // configured provider. This is a FORMAT failure, not an UNAVAILABLE one.
  withModel.instance("empty-segment model (anthropic/) fails with a FORMAT error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "anthropic/",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain('Invalid task model "anthropic/"')
      expect(rendered).toContain("format")
      expect(rendered).not.toContain("unavailable")
      expect(prompted).toBe(false)
    }),
  )

  // Behavior 6 (M3) — prototype-polluting keys are rejected. The provider mock resolves
  // models with the same unguarded record lookup the real Provider.getModel uses, so a
  // naive lookup would resolve Object.prototype as a "found" model for "anthropic/__proto__".
  // Validation rejects it with a clear error naming the offending value, and ops.prompt is
  // never called.
  withModel.instance("prototype-key model param (anthropic/__proto__) fails clearly", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "anthropic/__proto__",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("anthropic/__proto__")
      expect(rendered).toContain("format")
      expect(rendered).not.toContain("unavailable")
      expect(prompted).toBe(false)
    }),
  )

  // Behavior 6 (M3) — prototype-polluting keys are rejected. With "__proto__" as the
  // providerID a naive record lookup would resolve Object.prototype as the provider, then
  // read `provider.models` (undefined) and index it, surfacing a raw
  // "Cannot read properties of undefined" TypeError. Validation instead fails with a clear
  // error naming the offending value, and ops.prompt is never called.
  withModel.instance("prototype-key model param (__proto__/x) fails with an actionable error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "__proto__/x",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
      expect(rendered).toContain("__proto__/x")
      expect(rendered).toContain("format")
      expect(rendered).not.toContain("unavailable")
      expect(rendered).not.toContain("Cannot read properties of undefined")
      expect(prompted).toBe(false)
    }),
  )

  // Behavior 7 (M6) — a VALID model whose modelID itself contains slashes resolves and is
  // passed through to ops.prompt verbatim. parseModel keeps only the FIRST segment as the
  // providerID and joins the rest as the modelID, so "openrouter/anthropic/claude-3.5"
  // must reach ops.prompt as { providerID: "openrouter", modelID: "anthropic/claude-3.5" }.
  withModel.instance("valid multi-slash modelID resolves and is passed through verbatim", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "openrouter/anthropic/claude-3.5",
      }

      yield* def.execute(params, {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      })

      expect(seen?.model).toEqual(multiSlashRef)
      expect(seen?.variant).toBeUndefined()
    }),
  )

  // Behavior 2 (M6) — the explicit override beats the subagent's OWN configured model, not
  // merely parent inheritance. The "scoped" subagent is configured with its own model
  // (anthropic/claude-sonnet-4); calling Task with a DIFFERENT valid model
  // (openrouter/anthropic/claude-3.5) must send the explicit override — not the agent's own
  // model and not the inherited parent model — to ops.prompt.
  withModel.instance(
    "explicit model param beats the subagent's own configured model",
    () =>
      Effect.gen(function* () {
        const { chat, assistant } = yield* seed()
        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const params = {
          description: "inspect bug",
          prompt: "look into the cache key path",
          subagent_type: "scoped",
          model: "openrouter/anthropic/claude-3.5",
        }

        yield* def.execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })

        // The explicit override wins over the agent's own model (overrideRef) and over the
        // inherited parent model (ref).
        expect(seen?.model).toEqual(multiSlashRef)
        expect(seen?.model).not.toEqual(overrideRef)
        expect(seen?.variant).toBeUndefined()
      }),
    {
      config: {
        agent: {
          scoped: {
            mode: "subagent",
            model: "anthropic/claude-sonnet-4",
          },
        },
      },
    },
  )

  // Behavior 3/5 (M5) — model validation runs BEFORE child-session creation, so an invalid
  // model short-circuits before any child session is created and never leaves an orphan
  // child session behind.
  withModel.instance("invalid model param creates no child session (validates first)", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let prompted = false
      const promptOps = stubOps({ onPrompt: () => (prompted = true) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "bogus/does-not-exist",
      }

      const exit = yield* def
        .execute(params, {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        })
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(prompted).toBe(false)
      // Observe the side effect directly: a failed validation must not spawn a child.
      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(0)
    }),
  )

  // Behavior 6 (F1) — inherited Object.prototype method names as the modelID must be
  // rejected. "anthropic" is a known provider, but "toString"/"valueOf" are NOT real models:
  // an unguarded `provider.models[modelID]` lookup resolves the inherited Object.prototype
  // method (a truthy function) and a denylist of only ""/__proto__/constructor/prototype
  // would treat it as a "found" model, BYPASSING validation. The spec requires a
  // prototype-membership check (e.g. Object.hasOwn) so these fail with the actionable
  // "Invalid task model" error, ops.prompt is never called, and no child session is created.
  for (const inherited of ["toString", "valueOf"]) {
    withModel.instance(
      `inherited-prototype-method modelID (anthropic/${inherited}) fails and creates no child session`,
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const { chat, assistant } = yield* seed()
          const tool = yield* TaskTool
          const def = yield* tool.init()
          let prompted = false
          const promptOps = stubOps({ onPrompt: () => (prompted = true) })

          const params = {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
            model: `anthropic/${inherited}`,
          }

          const exit = yield* def
            .execute(params, {
              sessionID: chat.id,
              messageID: assistant.id,
              agent: "build",
              abort: new AbortController().signal,
              extra: { promptOps },
              messages: [],
              metadata: () => Effect.void,
              ask: () => Effect.void,
            })
            .pipe(Effect.exit)

          expect(Exit.isFailure(exit)).toBe(true)
          const rendered = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
          expect(rendered).toContain("Invalid task model")
          expect(rendered).toContain("format")
          expect(rendered).not.toContain("unavailable")
          expect(rendered).toContain(`anthropic/${inherited}`)
          expect(prompted).toBe(false)
          // A bypassed validation would spawn an orphan child — assert zero directly.
          const kids = yield* sessions.children(chat.id)
          expect(kids).toHaveLength(0)
        }),
    )
  }

  // GREEN no-regression — a VALID override still routes to ops.prompt AND creates the child
  // subagent session. Differentiating the FAILURE messages (cases A/B/C) must not regress
  // the happy path: the parsed { providerID, modelID } reaches ops.prompt and exactly one
  // child session is spawned under the parent.
  withModel.instance("valid model override routes to ops.prompt and creates the child session", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let seen: SessionPrompt.PromptInput | undefined
      const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

      const params = {
        description: "inspect bug",
        prompt: "look into the cache key path",
        subagent_type: "general",
        model: "anthropic/claude-sonnet-4",
      }

      const result = yield* def.execute(params, {
        sessionID: chat.id,
        messageID: assistant.id,
        agent: "build",
        abort: new AbortController().signal,
        extra: { promptOps },
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      })

      // Routed to ops.prompt with the parsed override model.
      expect(seen?.model).toEqual(overrideRef)
      // And a single child subagent session was created under the parent.
      const kids = yield* sessions.children(chat.id)
      expect(kids).toHaveLength(1)
      expect(kids[0]?.id).toBe(result.metadata.sessionId)
    }),
  )
})
