import { describe, expect, it } from "bun:test"
import { ReasoningTags } from "../src/protocols/utils/reasoning-tags"

const COHERE: ReasoningTags.Tags = {
  open: "<|START_THINKING|>",
  close: "<|END_THINKING|>",
  startInside: true,
}

// Feed a sequence of streamed content chunks through the splitter and collect
// the concatenated reasoning and text, mirroring how the protocol drives it.
const run = (chunks: string[], tags: ReasoningTags.Tags) => {
  let state = ReasoningTags.initial(tags)
  let reasoning = ""
  let text = ""
  for (const chunk of chunks) {
    const result = ReasoningTags.step(state, chunk, tags)
    state = result.state
    for (const segment of result.segments) {
      if (segment.kind === "reasoning") reasoning += segment.text
      else text += segment.text
    }
  }
  const tail = ReasoningTags.flush(state)
  if (tail) text += tail.text
  return { reasoning, text }
}

describe("ReasoningTags", () => {
  it("splits a pre-opened thinking block from the answer in one chunk", () => {
    const out = run(['The user asks. Provide "four".<|END_THINKING|>four'], COHERE)
    expect(out.reasoning).toBe('The user asks. Provide "four".')
    expect(out.text).toBe("four")
  })

  it("handles the close marker split across chunks", () => {
    const out = run(["thinking part<|END_", "THINKING|>answer"], COHERE)
    expect(out.reasoning).toBe("thinking part")
    expect(out.text).toBe("answer")
  })

  it("handles the marker split one byte at a time", () => {
    const chunks = ["think", ...["<|END_THINKING|>"].join("").split(""), "done"]
    const out = run(chunks, COHERE)
    expect(out.reasoning).toBe("think")
    expect(out.text).toBe("done")
  })

  it("treats a stream with no marker as pure reasoning when started inside", () => {
    const out = run(["still thinking, never finished"], COHERE)
    expect(out.reasoning).toBe("still thinking, never finished")
    expect(out.text).toBe("")
  })

  it("supports an explicit open marker when not pre-opened", () => {
    const tags: ReasoningTags.Tags = { open: "<think>", close: "</think>", startInside: false }
    const out = run(["preamble <think>secret</think> visible"], tags)
    expect(out.reasoning).toBe("secret")
    expect(out.text).toBe("preamble  visible")
  })

  it("does not drop trailing answer text that resembles a marker prefix", () => {
    const out = run(['<|END_THINKING|>value is <', "| not a marker"], COHERE)
    expect(out.reasoning).toBe("")
    expect(out.text).toBe("value is <| not a marker")
  })

  it("detects Cohere North models by id and ignores others", () => {
    const tagsFor = (id: string) =>
      ReasoningTags.detect({ model: { id }, providerOptions: undefined } as never)
    expect(tagsFor("mlx-community/North-Mini-Code-1.0-6bit")).toEqual(COHERE)
    expect(tagsFor("gpt-4o")).toBeUndefined()
  })

  it("honors an explicit providerOptions override", () => {
    const override: ReasoningTags.Tags = { open: "<r>", close: "</r>", startInside: false }
    const tags = ReasoningTags.detect({
      model: { id: "gpt-4o" },
      providerOptions: { "openai-compatible": { reasoningTags: override } },
    } as never)
    expect(tags).toEqual(override)
  })
})
