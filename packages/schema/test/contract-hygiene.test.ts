import { describe, expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { Agent } from "../src/agent.js"
import { FileSystem } from "../src/filesystem.js"
import { Form } from "../src/form.js"
import { Mcp } from "../src/mcp.js"
import { Model } from "../src/model.js"
import { Project } from "../src/project.js"
import { Provider } from "../src/provider.js"
import { Pty } from "../src/pty.js"
import { Question } from "../src/question.js"
import { Session } from "../src/session.js"
import { SessionMessage } from "../src/session-message.js"
import { SessionPending } from "../src/session-pending.js"
import { FileDiff } from "../src/file-diff.js"
import { Money } from "../src/money.js"
import { Skill } from "../src/skill.js"
import { Shell } from "../src/shell.js"
import { PersistedRevert } from "../src/session-revert.js"
import { optional } from "../src/schema.js"

describe("contract hygiene", () => {
  test("keeps absolute costs distinct from model rates", () => {
    const usd = Money.USD.make(1)
    const rate = Money.USDPerMillionTokens.make(1)
    // @ts-expect-error Model rates are not absolute costs.
    const invalidUSD: Money.USD = rate
    // @ts-expect-error Absolute costs are not model rates.
    const invalidRate: Money.USDPerMillionTokens = usd

    expect(invalidUSD).toBe(Money.USD.make(1))
    expect(invalidRate).toBe(Money.USDPerMillionTokens.make(1))
    expect(Money.USD.zero).toBe(Money.USD.make(0))
    expect(Money.USDPerMillionTokens.zero).toBe(Money.USDPerMillionTokens.make(0))
  })

  test("optional properties preserve transformations and omit undefined while encoding", () => {
    const Value = Schema.Struct({ value: optional(Schema.FiniteFromString) })
    expect(Schema.decodeUnknownSync(Value)({ value: "1" })).toEqual({ value: 1 })
    expect(Schema.encodeSync(Value)({ value: 1 })).toEqual({ value: "1" })
    expect(Schema.encodeSync(Value)({ value: undefined })).toEqual({})
    expect(
      Schema.encodeSync(SessionPending.SyntheticData)({
        text: "completed",
        description: undefined,
        metadata: undefined,
      }),
    ).toEqual({ text: "completed" })
  })

  test("forms require at least one field", () => {
    expect(() =>
      Schema.decodeUnknownSync(Form.Info)({
        id: Form.ID.create(),
        sessionID: "global",
        title: "Empty form",
        fields: [],
      }),
    ).toThrow()
    expect(
      Schema.decodeUnknownSync(Form.Info)({
        id: Form.ID.create(),
        sessionID: "global",
        title: "External form",
        fields: [{ key: "authorization", type: "external", url: "https://example.com" }],
      }).fields,
    ).toHaveLength(1)
    expect(() =>
      Schema.decodeUnknownSync(Form.Info)({
        id: Form.ID.create(),
        sessionID: "global",
        title: "External form",
        fields: [{ type: "external", url: "https://example.com" }],
      }),
    ).toThrow()
  })

  test("model defaults and provider overlays preserve public invariants", () => {
    const id = Model.ID.make("model")
    expect(Model.Info.empty(Provider.ID.make("provider"), id)).toMatchObject({ modelID: id, variants: [] })
    expect(() =>
      Schema.decodeUnknownSync(Provider.Info)({
        id: "provider",
        name: "Provider",
        package: "native",
        settings: { invalid: 1n },
      }),
    ).toThrow()
  })

  test("current ID constructors expose create", () => {
    expect(Question.ID.create()).toStartWith("que_")
    expect(Pty.ID.create()).toStartWith("pty_")
  })

  test("reusable public identifiers are stable and unique", () => {
    const identifiers = [
      Agent.Color,
      FileSystem.Submatch,
      Form.Field,
      Form.Fields,
      Form.Info,
      Form.ExternalField,
      Mcp.Resource,
      Mcp.ResourceTemplate,
      Mcp.ResourceCatalog,
      Mcp.ResourceContentPart,
      Mcp.ResourceContent,
      Model.Ref,
      Model.Capabilities,
      Model.Cost,
      Model.Variant,
      Project.Current,
      Project.Directory,
      Project.DirectoriesInput,
      Project.Directories,
      Project.Icon,
      Project.Commands,
      Project.Time,
      Project.Info,
      Pty.Info,
      Session.ListAnchor,
      Session.Revert,
      SessionPending.UserData,
      SessionPending.SyntheticData,
      SessionPending.User,
      SessionPending.Synthetic,
    ].map((schema) => schema.ast.annotations?.identifier)

    expect(identifiers.every((identifier) => typeof identifier === "string")).toBe(true)
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })

  test("current source avoids Any and mutable contract wrappers", async () => {
    const files = [...new Bun.Glob("*.ts").scanSync(new URL("../src", import.meta.url).pathname)].filter(
      (file) => !file.endsWith("-v1.ts"),
    )
    const source = await Promise.all(
      files.map((file) => Bun.file(new URL(`../src/${file}`, import.meta.url)).text()),
    ).then((values) => values.join("\n"))

    expect(source).not.toContain("Schema.Any")
    expect(source).not.toContain("Schema.mutable")
  })

  test("assistant content keeps only domain identities", () => {
    expect(SessionMessage.AssistantText.make({ type: "text", text: "hello" })).toEqual({
      type: "text",
      text: "hello",
    })
    expect(
      SessionMessage.AssistantReasoning.make({ type: "reasoning", text: "thinking", state: { id: "opaque" } }),
    ).toEqual({ type: "reasoning", text: "thinking", state: { id: "opaque" } })
    expect(
      SessionMessage.AssistantTool.make({
        type: "tool",
        id: "call_1",
        name: "search",
        executed: true,
        providerState: { itemId: "item_1" },
        state: { status: "streaming", input: "" },
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ).not.toHaveProperty("provider")
  })

  test("reviewed session contracts use their canonical current shapes", () => {
    expect(SessionMessage.Info.ast.annotations?.identifier).toBe("Session.Message.Info")
    expect(SessionPending.Info.ast.annotations?.identifier).toBe("SessionPending.Info")
    expect(Money.USD).not.toBe(Money.USDPerMillionTokens)
    expect(
      FileDiff.Info.make({ file: "src/index.ts", patch: "@@", additions: 1, deletions: 0, status: "modified" }),
    ).toEqual({ file: "src/index.ts", patch: "@@", additions: 1, deletions: 0, status: "modified" })
    expect(
      SessionMessage.Shell.make({
        id: SessionMessage.ID.make("msg_shell"),
        type: "shell",
        shellID: Shell.ID.make("sh_test"),
        command: "pwd",
        status: "exited",
        exit: 0,
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ).not.toHaveProperty("shell")
    expect(
      SessionMessage.Skill.make({
        id: SessionMessage.ID.make("msg_skill"),
        type: "skill",
        skill: Skill.ID.make("effect"),
        name: Skill.Name.make("Effect"),
        text: "Use Effect",
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ).toMatchObject({ skill: "effect", name: "Effect" })
    expect(
      SessionMessage.CompactionFailed.make({
        id: SessionMessage.ID.make("msg_compaction"),
        type: "compaction",
        status: "failed",
        reason: "manual",
        error: { type: "compaction.failed", message: "failed" },
        time: { created: DateTime.makeUnsafe(0) },
      }),
    ).not.toHaveProperty("summary")
  })

  test("keeps shared persisted revert compatibility", () => {
    expect(
      Schema.decodeUnknownSync(Session.Revert)({
        messageID: "msg_legacy",
        snapshot: "tree",
        diff: "legacy patch",
      }),
    ).not.toHaveProperty("diff")

    const revert = Schema.decodeUnknownSync(PersistedRevert)({
      messageID: "msg_legacy",
      snapshot: "tree",
      diff: "legacy patch",
      files: [{ path: "src/index.ts", status: "modified", additions: 1, deletions: 0, patch: "@@" }],
    })
    expect(String(revert.messageID)).toBe("msg_legacy")
    expect(String(revert.snapshot)).toBe("tree")
    expect(revert.files).toEqual([
      { file: "src/index.ts", status: "modified", additions: 1, deletions: 0, patch: "@@" },
    ])
    expect(Schema.encodeSync(PersistedRevert)(revert)).toEqual({
      messageID: "msg_legacy",
      snapshot: "tree",
      files: [{ file: "src/index.ts", status: "modified", additions: 1, deletions: 0, patch: "@@" }],
    })
  })
})
