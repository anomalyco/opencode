import { describe, expect, test } from "bun:test"
import { createBargeDetector, echoes, type Utterance } from "../../src/feature-plugins/session/companion/barge"
import { sentences, speakable } from "../../src/feature-plugins/session/companion/voice"

const RATE = 48000
const FRAMES = 1024

function detector() {
  const events: string[] = []
  const utterances: Utterance[] = []
  const barge = createBargeDetector({
    onOnset: () => events.push("onset"),
    onUtterance: (utterance) => {
      events.push("utterance")
      utterances.push(utterance)
    },
  })
  // A constant chunk's RMS is its level.
  const push = (count: number, mic: number, playback: number) =>
    Array.from({ length: count }).forEach(() => barge.push(new Float32Array(FRAMES).fill(mic), RATE, playback))
  return { barge, events, utterances, push }
}

describe("companion barge-in", () => {
  test("ignores echo at the level playback explains", () => {
    const run = detector()
    run.push(200, 0.08, 0.2)
    expect(run.events).toEqual([])
  })

  test("detects speech over playback and keeps the audio before its onset", () => {
    const run = detector()
    run.push(40, 0.05, 0.2)
    run.push(7, 0.3, 0.2)
    expect(run.events).toEqual([])
    run.push(13, 0.3, 0.2)
    expect(run.events).toEqual(["onset"])
    // Speech ends once the microphone hears only the turned-down echo for long enough.
    run.push(32, 0.012, 0.05)
    expect(run.events).toEqual(["onset"])
    run.push(2, 0.012, 0.05)
    expect(run.events).toEqual(["onset", "utterance"])
    // 19 chunks of preroll (the first 400 ms, ending at the onset), 12 more of speech, 33 of silence.
    expect(run.utterances[0]?.samples.length).toBe((19 + 12 + 33) * FRAMES)
    expect(run.barge.active).toBe(false)
  })

  test("stops treating rejected echo as speech", () => {
    const run = detector()
    run.push(20, 0.15, 0.1)
    run.barge.flush()
    expect(run.events).toEqual(["onset", "utterance"])
    run.barge.rejected()
    run.push(200, 0.15, 0.1)
    expect(run.events).toEqual(["onset", "utterance"])
  })

  test("recognises a transcript of the reply being spoken", () => {
    const spoken = "The main session is running the test suite right now."
    expect(echoes("the main session is running the tests", spoken)).toBe(true)
    expect(echoes("Stop, tell it to use bun instead.", spoken)).toBe(false)
    expect(echoes("", spoken)).toBe(false)
  })
})

describe("companion speech text", () => {
  test("drops code blocks and markdown syntax", () => {
    expect(speakable("Run `bun test` in **core**.\n\n```ts\nconst a = 1\n```\n- See [docs](https://x).")).toBe(
      "Run bun test in core. See docs.",
    )
  })

  test("stops before a code block that is still streaming", () => {
    expect(speakable("Here is the fix:\n```ts\nconst a")).toBe("Here is the fix: ")
  })

  test("cuts only complete sentences until the reply finishes", () => {
    const text = "The main session is running the test suite right now. It already fixed the parser and"
    const partial = sentences(text, 0, false)
    expect(partial.chunks).toEqual(["The main session is running the test suite right now."])
    const final = sentences(text, partial.end, true)
    expect(final.chunks).toEqual(["It already fixed the parser and"])
    expect(final.end).toBe(text.length)
  })

  test("merges short sentences so each request sounds natural", () => {
    expect(sentences("Sure. I sent that to the main session as a steer. Done.", 0, true).chunks).toEqual([
      "Sure. I sent that to the main session as a steer.",
      "Done.",
    ])
  })

  test("does not split decimals", () => {
    expect(sentences("Coverage went from 81.5 to 84.2 percent after the change", 0, false).chunks).toEqual([])
  })
})
