import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Artifact } from "../src/artifact"
import { ProjectID } from "../src/project-id"

describe("artifact contract", () => {
  test("declares exactly the thirteen artifact types from the specification", () => {
    expect([...Artifact.Type.literals]).toEqual([
      "PLAN",
      "ARCHITECTURE",
      "CODE_DIFF",
      "TEST_RESULT",
      "BROWSER_RECORDING",
      "SCREENSHOT",
      "LOG",
      "SECURITY_REPORT",
      "PERFORMANCE_REPORT",
      "DATABASE_REPORT",
      "BUILD_REPORT",
      "DEPLOY_REPORT",
      "FINAL_WALKTHROUGH",
    ])
    const decode = Schema.decodeUnknownSync(Artifact.Type)
    expect(decode("BROWSER_RECORDING")).toBe("BROWSER_RECORDING")
    expect(() => decode("browser_recording")).toThrow()
    expect(() => decode("NOT_A_TYPE")).toThrow()
  })

  test("status is the closed lowercase review lifecycle", () => {
    expect([...Artifact.Status.literals]).toEqual(["draft", "ready", "approved", "rejected", "archived"])
    expect(() => Schema.decodeUnknownSync(Artifact.Status)("DRAFT")).toThrow()
  })

  test("id constructors emit and validate their exact prefixes", () => {
    const id = Artifact.ID.create()
    expect(id).toStartWith("art_")
    expect(Schema.decodeUnknownSync(Artifact.ID)(id)).toBe(id)
    expect(() => Schema.decodeUnknownSync(Artifact.ID)("psv_123")).toThrow()
    expect(() => Schema.decodeUnknownSync(Artifact.ID)("art")).toThrow()

    const commentID = Artifact.CommentID.create()
    expect(commentID).toStartWith("cmt_")
    expect(Schema.decodeUnknownSync(Artifact.CommentID)(commentID)).toBe(commentID)
    expect(() => Schema.decodeUnknownSync(Artifact.CommentID)("art_123")).toThrow()
  })

  test("info encodes without undefined optional keys", () => {
    const info: Artifact.Info = {
      id: Artifact.ID.create(),
      projectID: ProjectID.global,
      name: "browser evidence",
      type: "BROWSER_RECORDING",
      status: "draft",
      version: 1,
      content: "recorded a full pass",
      timeCreated: 1,
      timeUpdated: 1,
      comments: [],
    }
    const encoded = Schema.encodeSync(Artifact.Info)(info)
    expect("sessionID" in encoded).toBe(false)
    expect("agent" in encoded).toBe(false)
    expect("task" in encoded).toBe(false)
    expect("diff" in encoded).toBe(false)
    expect(encoded).toMatchObject({ type: "BROWSER_RECORDING", status: "draft", version: 1 })
  })

  test("public identifiers are stable and domain qualified", () => {
    const identifiers = [Artifact.Info, Artifact.Comment, Artifact.Type, Artifact.Status].map(
      (schema) => schema.ast.annotations?.identifier,
    )
    expect(identifiers).toEqual(["Artifact.Info", "Artifact.Comment", "Artifact.Type", "Artifact.Status"])
    expect(new Set(identifiers).size).toBe(identifiers.length)
  })
})
