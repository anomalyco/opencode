import { expect, test } from "bun:test"
import path from "path"
import { CandidateCard } from "../../src/product/candidate-card"
import { tmpdir } from "../fixture/fixture"

const sample = {
  id: "jane-doe",
  stage: "screen",
  score: 4,
  source: "referral",
  ats_id: "ash_123",
  extra: { name: "Jane Doe", team: "platform" },
  body: "# Jane Doe\n\nStrong backend.\n",
}

test("parse reads frontmatter fields and extra keys", () => {
  const text = `---
id: jane-doe
stage: screen
score: 4
source: referral
ats_id: ash_123
name: Jane Doe
team: platform
---

# Jane Doe

Strong backend.
`
  expect(CandidateCard.parse(text)).toEqual(sample)
})

test("parse returns undefined without frontmatter or id", () => {
  expect(CandidateCard.parse("# just a note\n")).toBeUndefined()
  expect(CandidateCard.parse("---\nstage: sourced\n---\n\nbody\n")).toBeUndefined()
})

test("parse skips comments and invalid score", () => {
  const card = CandidateCard.parse(`---
id: x
# ignore
score: nope
foo: bar
---
body
`)
  expect(card).toEqual({
    id: "x",
    stage: undefined,
    score: undefined,
    source: undefined,
    ats_id: undefined,
    extra: { foo: "bar" },
    body: "body\n",
  })
})

test("serialize writes known fields then sorted extras", () => {
  expect(CandidateCard.serialize(sample)).toBe(`---
id: jane-doe
stage: screen
score: 4
source: referral
ats_id: ash_123
name: Jane Doe
team: platform
---

# Jane Doe

Strong backend.
`)
})

test("stub defaults stage and heading", () => {
  expect(CandidateCard.stub("c1")).toBe(`---
id: c1
stage: sourced
---

# c1
`)
  expect(CandidateCard.stub("c2", { name: "Pat", stage: "phone", source: "linkedin", ats_id: "a1" })).toBe(`---
id: c2
stage: phone
source: linkedin
ats_id: a1
name: Pat
---

# Pat
`)
})

test("parse(serialize(card)) roundtrips", () => {
  expect(CandidateCard.parse(CandidateCard.serialize(sample))).toEqual(sample)
  expect(CandidateCard.parse(CandidateCard.stub("c1"))).toEqual({
    id: "c1",
    stage: "sourced",
    score: undefined,
    source: undefined,
    ats_id: undefined,
    extra: {},
    body: "# c1\n",
  })
})

test("write and read roundtrip a card on disk", async () => {
  await using tmp = await tmpdir()
  await Bun.write(path.join(tmp.path, "candidates/.gitkeep"), "")
  const file = await CandidateCard.write(tmp.path, sample)
  expect(path.basename(file)).toBe("jane-doe.md")
  expect(await CandidateCard.read(tmp.path, "jane-doe")).toEqual(sample)
  const listed = await CandidateCard.list(tmp.path)
  expect(listed).toEqual([sample])
})
