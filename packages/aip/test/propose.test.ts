import { describe, expect, test } from "bun:test"
import { MockLLMClient } from "@opencode-ai/evolve"
import { createOntology } from "../src/objects.ts"
import { obj } from "../src/ontology.ts"
import { expand } from "../src/graph.ts"
import { defaultActions } from "../src/actions.ts"
import { buildProposePrompt, parseProposal, propose } from "../src/propose.ts"

function fixture() {
  const o = createOntology()
  o.upsert(obj("Session", "s1", { title: "root" }))
    .upsert(obj("Agent", "a1", { name: "build" }))
    .upsert(obj("Skill", "k1", { name: "git-commit" }))
    .link("runs", "s1", "a1")
    .link("has-skill", "a1", "k1")
  return o
}

describe("propose", () => {
  const actions = defaultActions()
  const subgraph = expand(fixture(), "s1", 2)

  test("prompt lists the subgraph and available actions", () => {
    const req = buildProposePrompt({ query: "do it", subgraph, actions })
    expect(req.prompt).toContain("Session s1")
    expect(req.prompt).toContain("update-skill")
  })

  test("parseProposal extracts JSON (fenced or raw)", () => {
    expect(parseProposal('```json\n{"action":"answer","params":{"text":"hi"}}\n```')).toEqual({
      action: "answer",
      params: { text: "hi" },
      rationale: undefined,
    })
    expect(parseProposal("noise {\"action\":\"answer\",\"params\":{}} tail")?.action).toBe("answer")
    expect(parseProposal("not json")).toBeUndefined()
  })

  test("propose validates a known action", async () => {
    const llm = new MockLLMClient(() =>
      JSON.stringify({ action: "set-property", params: { id: "k1", property: "description", value: "x" } }),
    )
    const res = await propose(llm, { query: "q", subgraph, actions })
    expect(res.proposal.action).toBe("set-property")
    expect(res.validationError).toBeUndefined()
  })

  test("propose surfaces validation errors", async () => {
    const llm = new MockLLMClient(() => JSON.stringify({ action: "answer", params: { text: "" } }))
    const res = await propose(llm, { query: "q", subgraph, actions })
    expect(res.validationError).toMatch(/required/)
  })

  test("propose flags unknown actions", async () => {
    const llm = new MockLLMClient(() => JSON.stringify({ action: "nuke", params: {} }))
    const res = await propose(llm, { query: "q", subgraph, actions })
    expect(res.validationError).toMatch(/unknown action/)
  })

  test("propose falls back to an answer on prose replies", async () => {
    const llm = new MockLLMClient(() => "I think you should rebase.")
    const res = await propose(llm, { query: "q", subgraph, actions })
    expect(res.proposal.action).toBe("answer")
    expect(res.proposal.params.text).toBe("I think you should rebase.")
  })
})
