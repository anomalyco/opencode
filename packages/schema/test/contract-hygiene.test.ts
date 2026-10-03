import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent"
import { FileSystem } from "../src/filesystem"
import { Model } from "../src/model"
import { Project } from "../src/project"
import { Pty } from "../src/pty"
import { Question } from "../src/question"
import { Session } from "../src/session"
import { SessionEvent } from "../src/session-event"
import { SessionTodo } from "../src/session-todo"
import { optional } from "../src/schema"
import { Permission } from "../src/permission"
import { PermissionV1 } from "../src/permission-v1"
import { SessionID } from "../src/session-id"

describe("contract hygiene", () => {
  test("permission reasons encode only when supplied", () => {
    const current = {
      id: Permission.ID.create("per_current"),
      sessionID: SessionID.make("ses_test"),
      action: "read",
      resources: ["README.md"],
    }
    const legacy = {
      id: PermissionV1.ID.ascending("per_legacy"),
      sessionID: SessionID.make("ses_test"),
      permission: "read",
      patterns: ["README.md"],
      metadata: {},
      always: [],
    }

    for (const [schema, request] of [
      [Permission.Request, current],
      [PermissionV1.Request, legacy],
    ] as const) {
      expect(Schema.encodeSync(schema)({ ...request, reason: "Read the project instructions." })).toHaveProperty(
        "reason",
        "Read the project instructions.",
      )
      expect(Schema.encodeSync(schema)({ ...request, reason: " " })).toHaveProperty("reason", " ")
      expect(Schema.encodeSync(schema)({ ...request, reason: undefined })).not.toHaveProperty("reason")
    }
  })

  test("optional properties preserve transformations and omit undefined while encoding", () => {
    const Value = Schema.Struct({ value: optional(Schema.FiniteFromString) })
    expect(Schema.decodeUnknownSync(Value)({ value: "1" })).toEqual({ value: 1 })
    expect(Schema.encodeSync(Value)({ value: 1 })).toEqual({ value: "1" })
    expect(Schema.encodeSync(Value)({ value: undefined })).toEqual({})
  })

  test("todo status and priority preserve arbitrary strings", () => {
    const decode = Schema.decodeUnknownSync(SessionTodo.Info)
    expect(decode({ content: "ship", status: "waiting", priority: "urgent" })).toEqual({
      content: "ship",
      status: "waiting",
      priority: "urgent",
    })
  })

  test("current ID constructors expose create", () => {
    expect(Question.ID.create()).toStartWith("que_")
    expect(Pty.ID.create()).toStartWith("pty_")
  })

  test("reusable public identifiers are stable and unique", () => {
    const identifiers = [
      Agent.Color,
      FileSystem.Submatch,
      Model.Ref,
      Model.Capabilities,
      Model.Cost,
      Model.Api,
      Project.Icon,
      Project.Commands,
      Project.Time,
      Project.Info,
      Pty.Info,
      Session.ListAnchor,
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
})
