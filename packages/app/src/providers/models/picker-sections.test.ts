import { expect, test } from "bun:test"
import { FREE_GROUP_KEY, pickerSections, splitFreeModels } from "./picker-sections"

const provider = (id: string, name: string, integrationID = id) => ({ id, name, integrationID })

const root = provider("opencode", "NVIDIA / OpenCode", "opencode")

const go = provider("opencode-go", "NVIDIA / OpenCode Go", "opencode")

const google = provider("console-google", "NVIDIA / Google", "opencode")

const anthropic = provider("anthropic", "Anthropic")

const model = (p: { id: string; name: string; integrationID: string }, id: string, input = 1) => ({
  id,
  provider: p,
  cost: { input },
})

const pickle = model(root, "big-pickle", 0)

const opus = model(root, "claude-opus")

const kimi = model(go, "kimi")

const gemini = model(google, "gemini")

const sonnet = model(anthropic, "sonnet")

const groups = [
  { category: "opencode-go", items: [kimi] },
  { category: "opencode", items: [pickle, opus] },
  { category: "anthropic", items: [sonnet] },
  { category: "console-google", items: [gemini] },
]

const all = [kimi, pickle, opus, sonnet, gemini]

const sections = (input: { favorites?: (typeof all)[number][]; searching?: boolean } = {}) =>
  pickerSections({ groups, all, favorites: input.favorites ?? [], recent: [], searching: input.searching ?? false })

test("lists the workspace's providers together and the free models last, in a group of their own", () => {
  const list = sections()
  expect(list.map((section) => section.key)).toEqual(["opencode-go", "opencode", "console-google", "anthropic", "free"])
  expect(list[1].items).toEqual([opus])
  expect(list[4]).toEqual({ key: "free", list: "free", items: [pickle] })
})

test("a favorite free model leaves the Free group, which stays last while searching", () => {
  expect(sections({ favorites: [pickle] }).map((section) => section.key)).toEqual([
    "favorite",
    "opencode-go",
    "opencode",
    "console-google",
    "anthropic",
  ])
  expect(sections({ favorites: [pickle], searching: true }).map((section) => section.key)).toEqual([
    "opencode-go",
    "opencode",
    "console-google",
    "anthropic",
    "free",
  ])
})

test("the free group keeps OpenCode's key only when OpenCode has no paid models listed", () => {
  expect(splitFreeModels(groups).free?.category).toBe(FREE_GROUP_KEY)
  expect(splitFreeModels([{ category: "opencode", items: [pickle] }])).toEqual({
    groups: [],
    free: { category: "opencode", items: [pickle] },
  })
  expect(splitFreeModels([{ category: "anthropic", items: [sonnet] }])).toEqual({
    groups: [{ category: "anthropic", items: [sonnet] }],
    free: undefined,
  })
})
