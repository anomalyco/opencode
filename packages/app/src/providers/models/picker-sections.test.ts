import { expect, test } from "bun:test"
import { FREE_GROUP_KEY, pickerSections, signInAccounts, splitFreeModels } from "./picker-sections"

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

test("lists the workspace's providers together, OpenCode's own then Go's first, and the free models last", () => {
  const list = sections()
  expect(list.map((section) => section.key)).toEqual(["opencode", "opencode-go", "console-google", "anthropic", "free"])
  expect(list.map((section) => section.workspace)).toEqual(["lead", "sub", "sub", undefined, undefined])
  expect(list[0].items).toEqual([opus])
  expect(list[4]).toEqual({ key: "free", list: "free", items: [pickle] })
})

test("the workspace's first listed provider heads its group when OpenCode has no paid models left", () => {
  const list = pickerSections({ groups, all, favorites: [opus], recent: [], searching: false })
  expect(list.map((section) => [section.key, section.workspace])).toEqual([
    ["favorite", undefined],
    ["opencode-go", "lead"],
    ["console-google", "sub"],
    ["anthropic", undefined],
    ["free", undefined],
  ])
})

test("a favorite free model leaves the Free group, which stays last while searching", () => {
  expect(sections({ favorites: [pickle] }).map((section) => section.key)).toEqual([
    "favorite",
    "opencode",
    "opencode-go",
    "console-google",
    "anthropic",
  ])
  expect(sections({ favorites: [pickle], searching: true }).map((section) => section.key)).toEqual([
    "opencode",
    "opencode-go",
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

test("the account menu lists only sign-in accounts, and none while an API key is active", () => {
  const account = (id: string, method: "oauth" | "key") => ({ type: "credential" as const, id, method, label: id })
  const personal = account("personal", "oauth")
  const key = account("key", "key")
  const acme = account("acme", "oauth")

  expect(signInAccounts([personal, key, acme])).toEqual([personal, acme])
  expect(signInAccounts([personal, key])).toEqual([personal])
  expect(signInAccounts([key, personal])).toEqual([])
  expect(signInAccounts([])).toEqual([])
})
