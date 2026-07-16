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
import { Skill } from "../src/skill"
import { optional } from "../src/schema"

describe("contract hygiene", () => {
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

  test("skill names and descriptions enforce documented bounds", () => {
    const decode = Schema.decodeUnknownOption(Skill.Info)
    const input = (name: string, description: string) => ({
      name,
      description,
      location: "/tmp/SKILL.md",
      content: "# Skill",
    })

    expect(decode(input("a", "x")).valueOrUndefined).toBeDefined()
    expect(decode(input(`a${"b".repeat(63)}`, "x".repeat(1024))).valueOrUndefined).toBeDefined()
    expect(decode(input("", "x")).valueOrUndefined).toBeUndefined()
    expect(decode(input(`a${"b".repeat(64)}`, "x")).valueOrUndefined).toBeUndefined()
    for (const name of ["Invalid-name", "invalid_name", "-invalid", "invalid-", "invalid--name"]) {
      expect(decode(input(name, "x")).valueOrUndefined).toBeUndefined()
    }
    expect(
      decode({ name: "valid-name", location: "/tmp/SKILL.md", content: "# Skill" }).valueOrUndefined,
    ).toBeUndefined()
    expect(decode(input("valid-name", "")).valueOrUndefined).toBeUndefined()
    expect(decode(input("valid-name", "x".repeat(1025))).valueOrUndefined).toBeUndefined()
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
      Skill.Name,
      Skill.Description,
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
