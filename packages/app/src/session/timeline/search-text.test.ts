import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { searchableSources } from "./search-machine"
import { createSearchText, SEARCH_TEXT_SLICE } from "./search-text"

const user = (id: string, text: string): SessionMessageInfo => ({ id, type: "user", time: { created: 1 }, text })

const reply = (id: string, text: string, completed = true): SessionMessageInfo => ({
  id,
  type: "assistant",
  time: completed ? { created: 2, completed: 3 } : { created: 2 },
  agent: "build",
  model: { id: "fixture", providerID: "fixture" },
  content: [{ type: "text", text }],
})

// A worker that answers when the test says so. What it shows of a source: the source without its asterisks.
function worker() {
  const asked: { sources: readonly string[]; answer: () => Promise<void>; fail: () => Promise<void> }[] = []
  const changes = { count: 0 }

  const cache = createSearchText({
    read: (sources) =>
      new Promise<readonly string[]>((resolve, reject) =>
        asked.push({
          sources,
          answer: async () => resolve(sources.map((source) => source.replaceAll("*", ""))),
          fail: async () => reject(new Error("the worker is down")),
        }),
      ),
    changed: () => (changes.count += 1),
  })

  // The driver gives the cache the sources of a transcript.
  const text = {
    prime: (messages: SessionMessageInfo[]) => cache.prime(searchableSources(messages)),
    parts: (messages: SessionMessageInfo[]) => cache.parts(searchableSources(messages)),
    rendered: cache.rendered,
  }

  return { text, asked, changes }
}

const lowers = (parts: readonly { lower: string }[]) => parts.map((part) => part.lower)

test("a part counts as its source until the worker has read it, then as what it shows", async () => {
  const { text, asked, changes } = worker()
  const messages = [user("msg_u1", "Make it **Bold**"), reply("msg_a1", "It is **Bold** now")]

  const before = text.parts(messages)
  expect(lowers(before)).toEqual(["make it **bold**", "it is **bold** now"])
  // A prompt shows its text as it was typed, so only the reply is read.
  expect(asked.map((item) => item.sources)).toEqual([["It is **Bold** now"]])

  await asked[0].answer()
  expect(changes.count).toBe(1)
  const after = text.parts(messages)
  expect(lowers(after)).toEqual(["make it **bold**", "it is bold now"])
  // Only the part whose text changed is a new object, so only that part is counted again.
  expect(after[0]).toBe(before[0])
  expect(after[1]).not.toBe(before[1])
  expect(asked).toHaveLength(1)
})

test("Find opening has the transcript read before a query needs it", async () => {
  const { text, asked, changes } = worker()
  const messages = [reply("msg_a1", "It is **Bold** now")]

  text.prime(messages)
  await asked[0].answer()
  // No text was given out yet, so nothing has to be counted again.
  expect(changes.count).toBe(0)
  expect(lowers(text.parts(messages))).toEqual(["it is bold now"])
  expect(asked).toHaveLength(1)
})

test("the worker reads one slice at a time, oldest part first", async () => {
  const { text, asked } = worker()
  const long = "x".repeat(SEARCH_TEXT_SLICE / 2 + 1)
  const messages = [
    reply("msg_a1", long + "1"),
    reply("msg_a2", "short"),
    reply("msg_a3", long + "3"),
    reply("msg_a4", long + "4"),
  ]

  text.prime(messages)
  expect(asked.map((item) => item.sources.map((source) => source.at(-1)))).toEqual([["1", "t"]])
  await asked[0].answer()
  expect(asked.map((item) => item.sources.map((source) => source.at(-1)))).toEqual([["1", "t"], ["3"]])
  await asked[1].answer()
  await asked[2].answer()
  expect(asked).toHaveLength(3)

  // One part longer than a slice is still read, alone.
  const huge = worker()
  huge.text.prime([reply("msg_b1", "y".repeat(SEARCH_TEXT_SLICE * 3)), reply("msg_b2", "after")])
  expect(huge.asked.map((item) => item.sources.length)).toEqual([1])
})

test("a reply that streams is read once it is complete, and counts what it has grown by as its source", async () => {
  const { text, asked, changes } = worker()
  const streaming = (source: string, completed = false) => [reply("msg_a1", source, completed)]

  expect(lowers(text.parts(streaming("A **b")))).toEqual(["a **b"])
  expect(asked).toHaveLength(0)

  // The reply is mounted, and shows its first words in bold.
  text.rendered("msg_a1:text:0", "a b")
  expect(changes.count).toBe(1)
  expect(lowers(text.parts(streaming("A **bold** word")))).toEqual(["a bold** word"])

  expect(lowers(text.parts(streaming("A **bold** word", true)))).toEqual(["a bold** word"])
  expect(asked.map((item) => item.sources)).toEqual([["A **bold** word"]])
  await asked[0].answer()
  expect(lowers(text.parts(streaming("A **bold** word", true)))).toEqual(["a bold word"])
})

test("what a mounted part shows replaces the worker's reading, and a late answer of the worker's does not", async () => {
  const { text, asked, changes } = worker()
  const messages = [reply("msg_a1", "See [the docs](https://example.com)")]

  expect(lowers(text.parts(messages))).toEqual(["see [the docs](https://example.com)"])
  text.rendered("msg_a1:text:0", "see the docs")
  expect(changes.count).toBe(1)
  await asked[0].answer()
  expect(changes.count).toBe(1)
  expect(lowers(text.parts(messages))).toEqual(["see the docs"])

  // The same text again changes nothing, and a part Find does not know is ignored.
  text.rendered("msg_a1:text:0", "see the docs")
  text.rendered("msg_gone:text:0", "anything")
  expect(changes.count).toBe(1)
})

test("a read that fails leaves the parts counting as their source, and is made again with the next transcript", async () => {
  const { text, asked, changes } = worker()
  const messages = [reply("msg_a1", "It is **Bold** now")]

  expect(lowers(text.parts(messages))).toEqual(["it is **bold** now"])
  await asked[0].fail()
  expect(changes.count).toBe(0)
  expect(asked).toHaveLength(1)

  expect(lowers(text.parts(messages))).toEqual(["it is **bold** now"])
  expect(asked).toHaveLength(2)
  await asked[1].answer()
  expect(lowers(text.parts(messages))).toEqual(["it is bold now"])
})

test("a part that left the transcript is forgotten, and its answer is dropped", async () => {
  const { text, asked, changes } = worker()

  text.parts([reply("msg_a1", "**first**"), reply("msg_a2", "**second**")])
  expect(lowers(text.parts([reply("msg_a2", "**second**")]))).toEqual(["**second**"])
  await asked[0].answer()
  expect(changes.count).toBe(1)
  expect(lowers(text.parts([reply("msg_a1", "**first**"), reply("msg_a2", "**second**")]))).toEqual([
    "**first**",
    "second",
  ])
})
