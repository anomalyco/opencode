import { describe, expect, test } from "bun:test"
import { createOntology } from "../src/objects.ts"
import { obj } from "../src/ontology.ts"
import { answerAction, defaultActions, setPropertyAction, updateSkillAction } from "../src/actions.ts"

describe("actions", () => {
  test("registry lists and filters by target type", () => {
    const reg = defaultActions()
    expect(reg.list().map((a) => a.name).sort()).toEqual(["answer", "set-property", "update-skill"])
    // Skill gets update-skill plus the "*" actions
    expect(reg.forType("Skill").map((a) => a.name).sort()).toEqual(["answer", "set-property", "update-skill"])
    expect(reg.forType("Tool").map((a) => a.name).sort()).toEqual(["answer", "set-property"])
  })

  test("answer action validates and proposes", async () => {
    expect(answerAction.validate?.({ text: "" })).toMatch(/required/)
    const change = await answerAction.propose({ ontology: createOntology(), query: "q" }, { text: "hi" })
    expect(change).toEqual({ kind: "answer", summary: "answer the query", answer: "hi" })
  })

  test("set-property proposes an update with before/after", async () => {
    const o = createOntology()
    o.upsert(obj("Skill", "k1", { description: "old" }))
    const change = await setPropertyAction.propose({ ontology: o, query: "q" }, {
      id: "k1",
      property: "description",
      value: "new",
    })
    expect(change.kind).toBe("update-property")
    expect(change.before).toBe("old")
    expect(change.after).toBe("new")
  })

  test("update-skill resolves the skill path", async () => {
    const o = createOntology()
    o.upsert(obj("Skill", "k1", { name: "git", path: "/x/SKILL.md" }))
    const change = await updateSkillAction.propose({ ontology: o, query: "q" }, {
      skillId: "k1",
      newBody: "# better",
    })
    expect(change.kind).toBe("update-skill")
    expect(change.skillPath).toBe("/x/SKILL.md")
    expect(change.newBody).toBe("# better")
  })

  test("update-skill on a missing object is a noop", async () => {
    const change = await updateSkillAction.propose({ ontology: createOntology(), query: "q" }, {
      skillId: "ghost",
      newBody: "x",
    })
    expect(change.kind).toBe("noop")
  })
})
