import { describe, expect } from "bun:test"
import { Effect } from "effect"
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk"
import type { AntigravityACP } from "@opencode/core/plugin/provider/antigravity/antigravity/acp"
import { AntigravityCatalog } from "@opencode/core/plugin/provider/antigravity/antigravity/catalog"
import { AntigravitySession } from "@opencode/core/plugin/provider/antigravity/antigravity/session"
import { AntigravityLanguageModel } from "@opencode/core/plugin/provider/antigravity/language-model/antigravity-language-model"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

// The list the Antigravity CLI reports for a signed-in account.
const models = [
  { slug: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
  { slug: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
  { slug: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
  { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
  { slug: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
  { slug: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
]

describe("AntigravityCatalog", () => {
  it.effect("groups the effort levels of one model into a single model", () =>
    Effect.gen(function* () {
      const groups = yield* Effect.sync(() => AntigravityCatalog.group(models))
      expect(groups.length).toBe(4)
      const flash = groups.find((group) => group.id === "gemini-3.8-flash")
      expect(flash?.variants.map((variant) => variant.id)).toEqual(["high", "medium", "low"])
      expect(flash?.variants.map((variant) => variant.slug)).toEqual([
        "gemini-3.8-flash-high",
        "gemini-3.8-flash-medium",
        "gemini-3.8-flash-low",
      ])
      const model = yield* Effect.sync(() => AntigravityCatalog.toModel(flash!))
      expect(String(model.id)).toBe("gemini-3.8-flash")
      expect(model.name).toBe("Gemini 3.8 Flash")
      expect(model.variants.map((variant) => String(variant.id))).toEqual(["high", "medium", "low"])
      expect(model.variants.map((variant) => variant.settings?.effort)).toEqual(["high", "medium", "low"])
    }),
  )

  it.effect("keeps a model with one effort level as one model without variants", () =>
    Effect.gen(function* () {
      const groups = yield* Effect.sync(() => AntigravityCatalog.group(models))
      const sonnet = groups.find((group) => group.id === "claude-sonnet-4-6")
      expect(sonnet?.variants.length).toBe(1)
      const model = yield* Effect.sync(() => AntigravityCatalog.toModel(sonnet!))
      expect(String(model.id)).toBe("claude-sonnet-4-6")
      expect(model.name).toBe("Claude Sonnet 4.6 (Thinking)")
      expect(model.variants).toEqual([])
    }),
  )

  it.effect("drops the effort suffix only when the model id ends with it", () =>
    Effect.gen(function* () {
      const groups = yield* Effect.sync(() => AntigravityCatalog.group(models))
      expect(groups.map((group) => group.id)).toEqual([
        "gemini-3.8-flash",
        "claude-sonnet-4-6",
        "claude-opus-4-6",
        "gpt-oss-120b",
      ])
    }),
  )

  it.effect("resolves the id the CLI accepts for a model and an effort", () =>
    Effect.gen(function* () {
      const groups = yield* Effect.sync(() => AntigravityCatalog.group(models))
      expect(AntigravityCatalog.resolveSlug(groups, "gemini-3.8-flash", "low")).toBe("gemini-3.8-flash-low")
      expect(AntigravityCatalog.resolveSlug(groups, "gemini-3.8-flash", "high")).toBe("gemini-3.8-flash-high")
      // The CLI's own default is the highest effort it offers.
      expect(AntigravityCatalog.resolveSlug(groups, "gemini-3.8-flash")).toBe("gemini-3.8-flash-high")
      // A model with one effort level has nothing to choose between.
      expect(AntigravityCatalog.resolveSlug(groups, "claude-opus-4-6")).toBe("claude-opus-4-6-thinking")
      expect(AntigravityCatalog.resolveSlug(groups, "gpt-oss-120b")).toBe("gpt-oss-120b-medium")
      expect(AntigravityCatalog.resolveSlug(groups, "not-a-model")).toBeUndefined()
    }),
  )
  it.effect("renders the agent's answer as text", () =>
    Effect.sync(() => {
      const parts = AntigravityLanguageModel.makeRenderer().push({ kind: "message", text: "hello" })
      expect(parts).toEqual([{ type: "text-delta", id: "text", delta: "hello" }])
    }),
  )

  it.effect("reports a tool call once, when it completes, under the name it first had", () =>
    Effect.sync(() => {
      const renderer = AntigravityLanguageModel.makeRenderer()
      const parts = [
        ...renderer.push({
          kind: "tool-call",
          call: { toolCallId: "call-1", toolName: "read_file", status: "pending", title: "read" },
        }),
        ...renderer.push({
          kind: "tool-call-update",
          call: { toolCallId: "call-1", toolName: "Read /tmp/x", args: { Path: "/tmp/x" }, status: "in_progress" },
        }),
        ...renderer.push({ kind: "tool-call-update", call: { toolCallId: "call-1", status: "completed" } }),
        ...renderer.push({ kind: "tool-call-update", call: { toolCallId: "call-1", status: "completed" } }),
        ...renderer.end(),
      ]
      expect(parts.length).toBe(2)
      expect(parts[0]).toMatchObject({
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "read_file",
        input: JSON.stringify({ Path: "/tmp/x" }),
        providerExecuted: true,
      })
      expect(parts[1]).toMatchObject({
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "read_file",
        isError: false,
      })
    }),
  )

  it.effect("marks a failed tool as an error", () =>
    Effect.sync(() => {
      const renderer = AntigravityLanguageModel.makeRenderer()
      renderer.push({ kind: "tool-call", call: { toolCallId: "call-2", toolName: "write_file", status: "pending" } })
      const parts = renderer.push({ kind: "tool-call-update", call: { toolCallId: "call-2", status: "failed" } })
      expect(parts[1]).toMatchObject({ type: "tool-result", isError: true, result: { status: "failed" } })
    }),
  )

  it.effect("settles a tool still running when the turn ends as incomplete", () =>
    Effect.sync(() => {
      const renderer = AntigravityLanguageModel.makeRenderer()
      expect(
        renderer.push({ kind: "tool-call", call: { toolCallId: "call-3", toolName: "run", status: "pending" } }),
      ).toEqual([])
      const parts = renderer.end()
      expect(parts.length).toBe(2)
      expect(parts[1]).toMatchObject({ type: "tool-result", isError: true, result: { status: "incomplete" } })
      expect(renderer.end()).toEqual([])
    }),
  )

  it.effect("maps the CLI's stop reason to a finish reason", () =>
    Effect.sync(() => {
      const unified = (reason: string) => AntigravityLanguageModel.finishReason(reason).unified
      expect(unified("end_turn")).toBe("stop")
      expect(unified("max_tokens")).toBe("length")
      expect(unified("max_turn_requests")).toBe("length")
      expect(unified("refusal")).toBe("content-filter")
      expect(unified("cancelled")).toBe("other")
      expect(AntigravityLanguageModel.finishReason("max_tokens").raw).toBe("max_tokens")
    }),
  )

  it.effect("reads the user's text out of the prompt", () =>
    Effect.sync(() => {
      const text = AntigravityLanguageModel.readPrompt({
        prompt: [
          { role: "system", content: "you are an agent" },
          { role: "user", content: [{ type: "text", text: "say hi" }] },
        ],
      })
      expect(text).toBe("say hi")
    }),
  )
})

const permissionRequest = (
  toolCall: Partial<RequestPermissionRequest["toolCall"]>,
  options: RequestPermissionRequest["options"] = [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
): RequestPermissionRequest => ({ sessionId: "cli-1", toolCall: { toolCallId: "t", ...toolCall }, options })

describe("AntigravitySession permissions", () => {
  it.effect("maps the agent's tool kinds onto OpenCode's permission actions", () =>
    Effect.sync(() => {
      const edit = AntigravitySession.toPermission(
        permissionRequest({ kind: "edit", title: "edit", locations: [{ path: "/repo/a.ts" }] }),
      )
      expect(edit).toMatchObject({ action: "edit", resources: ["/repo/a.ts"] })
      const shell = AntigravitySession.toPermission(
        permissionRequest({ kind: "execute", title: "run", rawInput: { command: ["git", "status"] } }),
      )
      expect(shell).toMatchObject({ action: "bash", resources: ["git status"] })
      expect(AntigravitySession.toPermission(permissionRequest({ kind: "search", title: "find" }))).toMatchObject({
        action: "grep",
        resources: ["find"],
      })
      expect(AntigravitySession.toPermission(permissionRequest({}))).toMatchObject({
        action: "antigravity",
        resources: ["*"],
      })
    }),
  )

  it.effect("answers with an allow option when allowed and a reject option otherwise", () =>
    Effect.sync(() => {
      const request = permissionRequest({ kind: "edit" })
      expect(AntigravitySession.choose(request, true)).toEqual({ outcome: { outcome: "selected", optionId: "allow" } })
      expect(AntigravitySession.choose(request, false)).toEqual({
        outcome: { outcome: "selected", optionId: "reject" },
      })
      expect(AntigravitySession.choose(permissionRequest({}, []), true)).toEqual({ outcome: { outcome: "cancelled" } })
    }),
  )
})

interface FakeCLI {
  readonly connection: AntigravitySession.Connection
  readonly calls: string[]
  readonly permission: () => AntigravityACP.Options["permission"]
  readonly die: () => void
}

const fakeCLI = (
  index: number,
  permission: AntigravityACP.Options["permission"],
  onPrompt?: (cli: FakeCLI, sessionId: string) => Promise<void>,
): FakeCLI => {
  let opened = 0
  let exit!: () => void
  const calls: string[] = []
  const closed = new Promise<void>((resolve) => (exit = resolve))
  const cli: FakeCLI = {
    calls,
    permission: () => permission,
    die: () => exit(),
    connection: {
      closed,
      newSession: async () => {
        opened += 1
        const sessionId = `cli${index}-s${opened}`
        calls.push(`new ${sessionId}`)
        return {
          sessionId,
          models: models.map((model) => ({ slug: model.slug, name: model.name })),
          currentModel: "gemini-3.8-flash-high",
        }
      },
      setModel: async (sessionId, modelId) => {
        calls.push(`model ${sessionId} ${modelId}`)
      },
      closeSession: async (sessionId) => {
        calls.push(`close ${sessionId}`)
      },
      prompt: async (sessionId) => {
        calls.push(`prompt ${sessionId}`)
        await onPrompt?.(cli, sessionId)
        return { stopReason: "end_turn", usage: undefined }
      },
      close: async () => {
        calls.push("exit")
      },
    },
  }
  return cli
}

const sessions = (
  options: Partial<AntigravitySession.Options> = {},
  onPrompt?: (cli: FakeCLI, sessionId: string) => Promise<void>,
) => {
  const clis: FakeCLI[] = []
  const session = AntigravitySession.make({
    directory: "/repo",
    ...options,
    connect: async (acp) => {
      const cli = fakeCLI(clis.length + 1, acp.permission, onPrompt)
      clis.push(cli)
      return cli.connection
    },
  })
  return { session, clis }
}

const signal = new AbortController().signal
const turn = (sessionID: string | undefined, model = "gemini-3.8-flash", effort?: string) => ({
  sessionID,
  kind: sessionID === undefined ? undefined : "primary",
  agent: "build",
  model,
  effort,
  prompt: "hi",
})

describe("AntigravitySession", () => {
  it.effect("keeps one CLI conversation per OpenCode session and switches its model only on a change", () =>
    Effect.promise(async () => {
      const { session, clis } = sessions()
      await session.run(turn("ses_a"), () => {}, signal)
      await session.run(turn("ses_a"), () => {}, signal)
      await session.run(turn("ses_b", "gemini-3.8-flash", "low"), () => {}, signal)
      await session.run(turn("ses_a", "claude-opus-4-6"), () => {}, signal)
      expect(clis.length).toBe(1)
      expect(clis[0].calls).toEqual([
        "new cli1-s1",
        "prompt cli1-s1",
        "prompt cli1-s1",
        "new cli1-s2",
        "model cli1-s2 gemini-3.8-flash-low",
        "prompt cli1-s2",
        "model cli1-s1 claude-opus-4-6-thinking",
        "prompt cli1-s1",
      ])
    }),
  )

  it.effect("runs a request outside a session in a conversation it closes afterwards", () =>
    Effect.promise(async () => {
      const { session, clis } = sessions()
      await session.run(turn(undefined), () => {}, signal)
      expect(clis[0].calls).toEqual(["new cli1-s1", "prompt cli1-s1", "close cli1-s1"])
    }),
  )

  it.effect("closes the conversation of a deleted session", () =>
    Effect.promise(async () => {
      const { session, clis } = sessions()
      await session.run(turn("ses_a"), () => {}, signal)
      await session.remove("ses_a")
      await session.run(turn("ses_a"), () => {}, signal)
      expect(clis[0].calls).toEqual(["new cli1-s1", "prompt cli1-s1", "close cli1-s1", "new cli1-s2", "prompt cli1-s2"])
    }),
  )

  it.effect("starts a new CLI after the old one exits", () =>
    Effect.promise(async () => {
      const { session, clis } = sessions()
      await session.run(turn("ses_a"), () => {}, signal)
      clis[0].die()
      await clis[0].connection.closed
      await Promise.resolve()
      await session.run(turn("ses_a"), () => {}, signal)
      expect(clis.length).toBe(2)
      expect(clis[1].calls).toEqual(["new cli2-s1", "prompt cli2-s1"])
    }),
  )

  it.effect("checks the agent's permission requests against the turn's OpenCode session", () =>
    Effect.promise(async () => {
      const checks: AntigravitySession.PermissionCheck[] = []
      const answers: unknown[] = []
      const { session } = sessions(
        {
          assert: async (check) => {
            checks.push(check)
            return check.action !== "bash"
          },
        },
        async (cli, sessionId) => {
          const ask = cli.permission()!
          answers.push(await ask({ ...permissionRequest({ kind: "edit", title: "edit" }), sessionId }))
          answers.push(await ask({ ...permissionRequest({ kind: "execute", title: "rm" }), sessionId }))
          answers.push(await ask(permissionRequest({ kind: "edit" })))
        },
      )
      await session.run(turn("ses_a"), () => {}, signal)
      expect(checks.map((check) => [check.sessionID, check.agent, check.action])).toEqual([
        ["ses_a", "build", "edit"],
        ["ses_a", "build", "bash"],
      ])
      expect(answers).toEqual([
        { outcome: { outcome: "selected", optionId: "allow" } },
        { outcome: { outcome: "selected", optionId: "reject" } },
        { outcome: { outcome: "selected", optionId: "reject" } },
      ])
    }),
  )

  it.effect("reports a changed model list once", () =>
    Effect.promise(async () => {
      const reported: number[] = []
      const { session } = sessions({ onModels: (groups) => reported.push(groups.length) })
      await session.run(turn("ses_a"), () => {}, signal)
      await session.run(turn("ses_b"), () => {}, signal)
      expect(reported).toEqual([4])
      expect(session.groups().length).toBe(4)
    }),
  )
})
