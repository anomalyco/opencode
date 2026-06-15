import { describe, expect, test } from "bun:test"
import { createOntology } from "../src/objects.ts"
import { obj } from "../src/ontology.ts"
import { setPropertyAction, updateSkillAction } from "../src/actions.ts"
import { AutoReviewer, PermissionReviewer, merge, openBranch, review } from "../src/governance.ts"

describe("governance", () => {
  test("AutoReviewer approves allowlisted permissions and rejects others", async () => {
    const branch = openBranch(setPropertyAction, { kind: "noop", summary: "x" })
    const approved = await review(branch, new AutoReviewer(["aip.object.update"]))
    expect(approved.status).toBe("approved")
    const rejected = await review(branch, new AutoReviewer([]))
    expect(rejected.status).toBe("rejected")
    expect(rejected.feedback).toMatch(/not in allowlist/)
  })

  test("PermissionReviewer maps ask replies to decisions", async () => {
    const branch = openBranch(updateSkillAction, { kind: "noop", summary: "x" })
    expect((await review(branch, new PermissionReviewer(async () => "always"))).status).toBe("approved")
    expect((await review(branch, new PermissionReviewer(async () => "once"))).status).toBe("approved")
    expect((await review(branch, new PermissionReviewer(async () => "reject"))).status).toBe("rejected")
  })

  test("merge of an unapproved branch does nothing", () => {
    const branch = openBranch(setPropertyAction, { kind: "update-property", summary: "x", targetId: "k1", property: "p", value: 1 })
    const res = merge(branch, { ontology: createOntology() })
    expect(res.merged).toBe(false)
  })

  test("merge applies an approved property update to the ontology", async () => {
    const ontology = createOntology()
    ontology.upsert(obj("Skill", "k1", { passRate: 0.2 }))
    const branch = openBranch(setPropertyAction, {
      kind: "update-property",
      summary: "set passRate",
      targetId: "k1",
      property: "passRate",
      value: 0.9,
    })
    const approved = await review(branch, new AutoReviewer(["aip.object.update"]))
    const res = merge(approved, { ontology })
    expect(res.merged).toBe(true)
    expect(res.branch.status).toBe("merged")
    expect(ontology.property("k1", "passRate")).toBe(0.9)
  })

  test("merge of an approved skill change produces a diff and stages (no write)", async () => {
    const branch = openBranch(updateSkillAction, {
      kind: "update-skill",
      summary: "rewrite",
      targetId: "k1",
      skillPath: "/tmp/should-not-write.md",
      before: "old line",
      newBody: "new line",
    })
    const approved = await review(branch, new AutoReviewer(["aip.skill.update"]))
    const res = merge(approved, { ontology: createOntology() }) // write defaults off
    expect(res.merged).toBe(true)
    expect(res.effect).toContain("staged")
    expect(res.diff).toContain("- old line")
    expect(res.diff).toContain("+ new line")
  })
})
