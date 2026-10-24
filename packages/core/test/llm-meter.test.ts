import { expect, test as it } from "bun:test"
import { applyCachePolicy } from "@opencode/ai/cache-policy"
import { LanguageModel, LLMEvent, LLMRequest, Message, ToolDefinition } from "@opencode/ai"
import { AnthropicMessages } from "@opencode/ai/protocols/anthropic-messages"
import { breakpointPrefixes, meter, requestText } from "./fixture/llm-meter"

// Anthropic is the route that honours inline cache markers, so it is where a cache policy has
// anything to measure. OpenAI and Gemini cache implicitly and would report the same number
// whatever the policy did.
const model = LanguageModel.make({ id: "claude-sonnet-4-5", provider: "anthropic", route: AnthropicMessages.route })

const tool = ToolDefinition.make({
  type: "tool",
  name: "read",
  description: "Read a file from disk",
  inputSchema: { type: "object" },
})

let seq = 0
const user = (text: string) => Message.make({ id: `u${seq++}`, role: "user", content: [{ type: "text", text }] })
const assistant = (text: string) =>
  Message.make({ id: `a${seq++}`, role: "assistant", content: [{ type: "text", text }] })

const request = (messages: readonly Message[]) => applyCachePolicy(new LLMRequest(base(messages)))

/** The shape every request shares, with or without a cache policy applied to it. */
const base = (messages: readonly Message[]) => ({
  model,
  system: [{ type: "text" as const, text: "You are a coding agent working in a repository." }],
  tools: [tool],
  messages,
})

const say = (text: string) => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "t" }),
  LLMEvent.textDelta({ id: "t", text }),
  LLMEvent.textEnd({ id: "t" }),
]

it("bills the first request in full, then reuses its prefix as the conversation grows", () => {
  const metered = meter()
  const decide = () => say("Working on it.")

  metered.respond(decide)(request([user("Add a parser")]))
  const afterFirst = metered.cached()

  metered.respond(decide)(request([user("Add a parser"), assistant("Working on it."), user("Now the writer")]))
  metered.respond(decide)(
    request([
      user("Add a parser"),
      assistant("Working on it."),
      user("Now the writer"),
      assistant("On it."),
      user("And the tests"),
    ]),
  )

  // Nothing to reuse before the first request.
  expect(afterFirst).toBe(0)

  // The system prompt, the tool definitions and the opening turn all sit before the tail
  // breakpoint, so later steps pay only for what they add.
  expect(metered.cached()).toBeGreaterThan(0)
  expect(metered.uncached()).toBeGreaterThan(0)

  // Three short requests reuse the fixed prefix but each adds its own new tail, so reuse lands
  // around a third of the input rather than approaching all of it.
  expect(metered.cacheHitRate()).toBeGreaterThan(0.2)
  expect(metered.cacheHitRate()).toBeLessThan(0.6)
  expect(metered.relativeCost()).toBeGreaterThan(0)
})

it("bills the shared prefix but not the unrelated conversation", () => {
  const metered = meter()

  metered.respond(() => say("a"))(request([user("Investigate the database migration failure")]))
  metered.respond(() => say("b"))(request([user("Rewrite the release scheduler entirely")]))

  // The system prompt and the tool definitions precede every breakpoint, so the second request
  // still reuses them even though its conversation shares nothing with the first.
  expect(metered.cached()).toBeGreaterThan(0)

  // The conversation itself is not reusable, so most of the second request is billed in full.
  expect(metered.cacheHitRate()).toBeLessThan(0.5)
})

it("reports no cache read at all when nothing has been sent before", () => {
  const metered = meter()

  metered.respond(() => say("a"))(request([user("Investigate the database migration failure")]))

  expect(metered.cached()).toBe(0)
  expect(metered.cacheHitRate()).toBe(0)
})

it("accumulates reuse as the conversation grows, and never bills a prefix twice", () => {
  const metered = meter()
  const decide = () => say("ok")

  metered.respond(decide)(request([user("First task")]))

  const cached: number[] = []
  for (let turn = 0; turn < 6; turn++) {
    const conversation = Array.from({ length: turn + 1 }, (_, index) =>
      index % 2 === 0 ? user(`question ${index}`) : assistant(`answer ${index}`),
    )
    metered.respond(decide)(request(conversation))
    cached.push(metered.cached())
  }

  // Reuse grows with the conversation: the system prompt, the tool definitions and every earlier
  // turn stay cached, so each step pays for its own new tail only.
  expect(cached.at(-1)!).toBeGreaterThan(cached[0]! * 2)

  // The tail of a growing conversation is always new, so reuse approaches but never reaches 1.
  expect(metered.cacheHitRate()).toBeGreaterThan(0.2)
  expect(metered.cacheHitRate()).toBeLessThan(1)

  // Nine requests share one system prompt and one tool definition: that fixed cost is billed once.
  expect(metered.seen()).toHaveLength(7)
  expect(metered.uncached()).toBeGreaterThan(0)
})

it("charges more when the cache policy is not applied, which is what makes it measurable", () => {
  const conversation = (turns: number) =>
    Array.from({ length: turns + 1 }, (_, index) =>
      index % 2 === 0 ? user(`question ${index} about the parser`) : assistant(`answer ${index} about the parser`),
    )

  const withPolicy = meter()
  const without = meter()
  const decide = () => say("ok")

  for (let turn = 0; turn < 6; turn++) {
    withPolicy.respond(decide)(applyCachePolicy(new LLMRequest(base(conversation(turn)))))
    without.respond(decide)(new LLMRequest(base(conversation(turn))))
  }

  expect(withPolicy.cacheHitRate()).toBeGreaterThan(0)
  expect(without.cacheHitRate()).toBe(0)

  // Cached input bills at a tenth of uncached input, so the same conversation costs strictly less
  // once the policy marks the reusable prefixes.
  expect(withPolicy.relativeCost()).toBeLessThan(without.relativeCost())

  const input = without.uncached() + without.cached()
  expect(withPolicy.uncached()).toBeLessThan(input)
})

it("marks the breakpoints a provider would cache, and reads what it billed", () => {
  const built = request([user("Add a parser"), assistant("On it."), user("Now the writer")])

  // Three boundaries: system, tool definitions, conversation tail.
  expect(breakpointPrefixes(built)).toHaveLength(3)

  const text = requestText(built)
  expect(text).toContain("You are a coding agent")
  expect(text).toContain("Read a file from disk")
  expect(text).toContain("Now the writer")

  const metered = meter()
  metered.respond(() => say("done"))(built)

  expect(metered.uncached()).toBeGreaterThan(0)
  expect(metered.output()).toBeGreaterThan(0)
  expect(metered.seen()).toHaveLength(1)
})
