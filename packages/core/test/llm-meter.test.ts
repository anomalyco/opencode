import { describe, expect, it } from "bun:test"
import { applyCachePolicy } from "@opencode/ai/testing"
import { ai, LanguageModel, LLMEvent, Message, SystemPart, ToolDefinition } from "@opencode/ai"
import type { LLMRequest } from "@opencode/ai"
import { AnthropicMessages } from "@opencode/ai/protocols"
import { bill, breakpointPrefixes, meter, requestText } from "./fixture/llm-meter"

/**
 * Measures what an agentic step costs against a provider that prices cache reads below uncached
 * input and cache writes above it, so a change to the cache policy can be judged by its effect on
 * the bill rather than by whether it still places a marker where a test expected one.
 *
 * Anthropic is the route that honours inline cache markers, so it is where a cache policy has
 * anything to measure. OpenAI and Gemini cache implicitly and would report the same number
 * whatever the policy did.
 */

const model = LanguageModel.make({ id: "claude-sonnet-4-5", provider: "anthropic", route: AnthropicMessages.route })

const tools = [
  ToolDefinition.make({
    type: "tool",
    name: "read",
    description: "Read a file from the workspace, with an offset and a limit for large files.",
    inputSchema: { type: "object" },
  }),
  ToolDefinition.make({
    type: "tool",
    name: "grep",
    description: "Search the workspace for a pattern and return matching lines with their paths.",
    inputSchema: { type: "object" },
  }),
]

let seq = 0
const user = (text: string) => Message.make({ id: `u${seq++}`, role: "user", content: [{ type: "text", text }] })
const assistant = (text: string) =>
  Message.make({ id: `a${seq++}`, role: "assistant", content: [{ type: "text", text }] })

/** One step as the runner assembles it: a system prompt, the live tool snapshot, and the history. */
const build = (messages: readonly Message[], cache: LLMRequest["cache"] = "auto") =>
  ai.request({
    model,
    system: [SystemPart.make("You are an AI coding agent. Use tools to read and search the workspace.")],
    tools,
    messages,
    cache,
  })

const step = (messages: readonly Message[], cache: LLMRequest["cache"] = "auto") =>
  applyCachePolicy(build(messages, cache))

const reply = (text: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "t" }),
  LLMEvent.textDelta({ id: "t", text }),
  LLMEvent.textEnd({ id: "t" }),
]

/** Runs `turns` steps of a conversation where the model answers, metering each. */
const run = (turns: number, cache: LLMRequest["cache"] = "auto") => {
  const metered = meter()
  const history: Message[] = []

  for (let turn = 0; turn < turns; turn++) {
    history.push(user(`Turn ${turn}: inspect the parser module and tell me what it does.`))
    metered.respond(() => reply("The parser handles tokenisation."))(step(history, cache))
    history.push(assistant("The parser handles tokenisation."))
  }

  return metered
}

describe("meter accounting", () => {
  it("prices a cache write above an uncached token and a read below it", () => {
    const built = step([user("Add a parser")])
    const first = bill([built])
    const again = bill([built, built])

    // The first request writes its prompt; the identical second request reads it and writes
    // nothing. Treating the write as free would make every extra marker look free too.
    expect(first.cached).toBe(0)
    expect(first.written).toBe(first.input)
    expect(again.cached).toBe(first.input)
    expect(again.written).toBe(first.input)

    expect(first.inputCost).toBeCloseTo(first.input * 1.25)
    expect(again.inputCost).toBeCloseTo(first.input * 1.25 + first.input * 0.1)
  })

  it("reads only text an earlier request actually wrote", () => {
    const first = step([user("Investigate the database migration failure")])
    const second = step([user("Rewrite the release scheduler entirely")])
    const metered = bill([first, second])
    const [opening, rewrite] = metered.steps
    if (!opening || !rewrite) return

    // The system prompt and tool definitions precede every breakpoint, so the second request
    // still reads that prefix even though its conversation shares nothing with the first.
    expect(rewrite.cached).toBeGreaterThan(0)
    expect(rewrite.cached).toBeLessThan(rewrite.input)
    expect(metered.cacheHitRate).toBeLessThan(0.5)
  })

  it("reports no cache read for a request with no breakpoints", () => {
    const built = build([user("Investigate the database migration failure")], "none")
    expect(breakpointPrefixes(built)).toHaveLength(0)

    // A provider has nowhere to look a prefix up without a breakpoint, so identical text is
    // still billed in full.
    const metered = bill([built, built])
    expect(metered.cached).toBe(0)
    expect(metered.written).toBe(0)
    expect(metered.uncached).toBe(metered.input)
  })

  it("charges less for the same conversation once the policy marks it", () => {
    const conversation = (turns: number) =>
      Array.from({ length: turns + 1 }, (_, index) =>
        index % 2 === 0 ? user(`question ${index} about the parser`) : assistant(`answer ${index} about the parser`),
      )

    const withPolicy = bill(Array.from({ length: 6 }, (_, turn) => step(conversation(turn))))
    const without = bill(Array.from({ length: 6 }, (_, turn) => build(conversation(turn), "none")))

    expect(without.cached).toBe(0)
    expect(withPolicy.inputCost).toBeLessThan(without.inputCost)
    expect(1 - withPolicy.inputCost / without.inputCost).toBeGreaterThan(0.3)
  })
})

describe("agent step cost", () => {
  it("prices a growing agent conversation", () => {
    const metered = run(8)

    expect(metered.seen()).toHaveLength(8)
    expect(metered.cached()).toBeGreaterThan(0)
    expect(metered.written()).toBeGreaterThan(0)
    expect(metered.cacheHitRate()).toBeGreaterThan(0.5)
    expect(metered.cacheHitRate()).toBeLessThan(1)
    expect(metered.output()).toBeGreaterThan(0)
  })

  it("keeps the reusable share stable as the conversation grows", () => {
    const metered = meter()
    const history: Message[] = []
    const rates: number[] = []

    for (let turn = 0; turn < 10; turn++) {
      history.push(user(`Turn ${turn}: what does the parser do?`))
      metered.respond(() => reply("It tokenises."))(step(history))
      history.push(assistant("It tokenises."))
      rates.push(metered.cacheHitRate())
    }

    // Each step reloads the whole history, so earlier turns stay cached and the share billed in
    // full falls as the reusable prefix dominates. It never reaches 1: the newest turn is always
    // new, which is the property that stops a long run paying for itself twice.
    expect(rates.at(-1)!).toBeGreaterThan(rates[1]!)
    expect(metered.cacheHitRate()).toBeGreaterThan(0.8)
    expect(metered.cacheHitRate()).toBeLessThan(1)
  })

  // Only the comparisons that survive a cost model change: marking the fixed prefix pays for
  // itself, and the tail marker is what makes the growing conversation reusable. Ranking the
  // placements would freeze today's `auto` choice into the test.
  it("shows where the saving comes from", () => {
    const defaults = run(20)
    const noTail = run(20, { tools: true, system: true })
    const nothing = run(20, "none")

    expect(nothing.cached()).toBe(0)
    expect(defaults.inputCost()).toBeLessThan(nothing.inputCost())

    // Without the tail marker the conversation itself is re-billed every step, though the fixed
    // prefix stays affordable because tools and system are still marked.
    expect(noTail.cached()).toBeGreaterThan(0)
    expect(noTail.inputCost()).toBeLessThan(nothing.inputCost())
    expect(defaults.inputCost()).toBeLessThan(noTail.inputCost())

    // Every tail marker writes the new turn at a premium rather than reading it, so marking
    // more of them is not automatically cheaper.
    expect(defaults.written()).toBeGreaterThan(0)
  })

  it("places the breakpoints a provider needs on a real step request", () => {
    const built = step([user("Read the config"), assistant("Reading it now."), user("Summarise the parser")])

    // System prompt, tool definitions, conversation tail: one reusable prefix, one live tail.
    expect(breakpointPrefixes(built)).toHaveLength(3)

    const text = requestText(built)
    expect(text).toContain("AI coding agent")
    expect(text).toContain("Read a file from the workspace")
    expect(text).toContain("Search the workspace for a pattern")
    expect(text).toContain("Summarise the parser")

    // A cache read is only a read of what an earlier request wrote, so the longest reusable
    // prefix is never longer than the request itself, and the first request has none.
    const metered = bill([built])
    expect(metered.cached).toBe(0)
    expect(metered.written).toBeGreaterThan(0)
  })
})
