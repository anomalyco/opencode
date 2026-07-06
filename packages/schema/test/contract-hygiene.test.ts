import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Agent } from "../src/agent.js"
import { FileSystem } from "../src/filesystem.js"
import { Model } from "../src/model.js"
import { Project } from "../src/project.js"
import { Provider } from "../src/provider.js"
import { Pty } from "../src/pty.js"
import { Question } from "../src/question.js"
import { Session } from "../src/session.js"
import { SessionTodo } from "../src/session-todo.js"
import { optional } from "../src/schema.js"

describe("contract hygiene", () => {
  test("optional properties preserve transformations and omit undefined while encoding", () => {
    const Value = Schema.Struct({ value: optional(Schema.FiniteFromString) })
    expect(Schema.decodeUnknownSync(Value)({ value: "1" })).toEqual({ value: 1 })
    expect(Schema.encodeSync(Value)({ value: 1 })).toEqual({ value: "1" })
    expect(Schema.encodeSync(Value)({ value: undefined })).toEqual({})
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
