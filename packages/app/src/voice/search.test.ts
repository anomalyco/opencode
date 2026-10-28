import { expect, test } from "bun:test"
import { matchModels, SessionSearch } from "./search"

const session = (title: string, directory = "/home/alex/code/opencode") => ({ title, location: { directory } })

test("ranks a title that is the spoken name above titles that only mention it", () => {
  const search = new SessionSearch("hex")
  const titles = ["Explore hex transcript storage (@explore subagent)", "HEX", "Review hex dictation PR"]

  expect(titles.toSorted((a, b) => (search.score(session(b)) ?? 0) - (search.score(session(a)) ?? 0))[0]).toBe("HEX")
})

test("drops filler words, so 'the desktop session' finds DESKTOP", () => {
  const search = new SessionSearch("the desktop session")

  expect(search.terms).toEqual(["desktop"])
  expect(search.score(session("DESKTOP"))).toBe(100)
  expect(search.score(session("Mobile layout"))).toBeUndefined()
})

test("matches the project folder and tolerates one misheard letter", () => {
  expect(new SessionSearch("kindle").score(session("Import books", "/home/alex/code/kindle-agent"))).toBe(55)
  expect(new SessionSearch("scrawel").score(session("Scrawl capture"))).toBe(55)
})

test("matches models by name, keeping version dots", () => {
  const models = [
    { id: "gpt-5.4", name: "GPT-5.4", providerID: "openai" },
    { id: "gpt-5.5", name: "GPT-5.5", providerID: "openai" },
    { id: "claude-opus-4", name: "Claude Opus 4", providerID: "anthropic" },
  ]

  expect(matchModels(models, "gpt 5.5").map((model) => model.id)).toEqual(["gpt-5.5", "gpt-5.4"])
  expect(matchModels(models, "opus").map((model) => model.id)).toEqual(["claude-opus-4"])
})
