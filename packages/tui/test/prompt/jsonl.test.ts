import { expect, test } from "bun:test"
import { MAX_FRECENCY_ENTRIES, parseFrecency } from "../../src/prompt/frecency"
import { MAX_STASH_ENTRIES, parsePromptStash } from "../../src/prompt/stash"

test("stash JSONL skips corruption and retains newest entries", () => {
  const entries = Array.from({ length: MAX_STASH_ENTRIES + 2 }, (_, index) =>
    JSON.stringify({ input: String(index), parts: [], timestamp: index }),
  )
  entries.splice(2, 0, "broken")
  const result = parsePromptStash(entries.join("\n"))
  expect(result).toHaveLength(MAX_STASH_ENTRIES)
  expect(result[0]?.input).toBe("2")
})

test("frecency JSONL skips corruption, keeps latest path state, and limits entries", () => {
  const entries = Array.from({ length: MAX_FRECENCY_ENTRIES + 1 }, (_, index) =>
    JSON.stringify({ path: String(index), frequency: 1, lastOpen: index }),
  )
  entries.push("broken", JSON.stringify({ path: "1000", frequency: 2, lastOpen: 2000 }))
  const result = parseFrecency(entries.join("\n"))
  expect(result).toHaveLength(MAX_FRECENCY_ENTRIES)
  expect(result[0]).toEqual({ path: "1000", frequency: 2, lastOpen: 2000 })
  expect(result.some((entry) => entry.path === "0")).toBe(false)
})
