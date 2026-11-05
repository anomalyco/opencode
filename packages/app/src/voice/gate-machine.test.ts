import { expect, test } from "bun:test"
import { speech } from "./fixtures/history"
import { INITIAL_VOICE_GATE_STATE, transitionVoiceGate, voiceGateDelay, type VoiceGateEvent } from "./gate-machine"

const tick = (now: number, user: boolean, assistant: boolean): VoiceGateEvent => ({
  type: "speech",
  user,
  assistant,
  now,
})

const run = (...events: VoiceGateEvent[]) => events.reduce(transitionVoiceGate, INITIAL_VOICE_GATE_STATE)

test("results wait for recorded speech to end and the quiet window", () => {
  const speaking = run({ type: "heard", speaker: "assistant", now: speech.at })
  expect(voiceGateDelay(speaking, speech.at)).toBe(900)

  const quiet = transitionVoiceGate(speaking, tick(speech.end, false, false))
  expect(voiceGateDelay(quiet, speech.end + 899)).toBe(1)
  expect(voiceGateDelay(quiet, speech.end + 900)).toBe(0)
})

test("a held reply caps agent chatter but never interrupts the user", () => {
  const held = run({ type: "hold", now: 1000 }, tick(1000, false, true))
  expect(voiceGateDelay(held, 1000)).toBe(900)
  expect(voiceGateDelay(transitionVoiceGate(held, tick(6000, false, true)), 6000)).toBe(0)

  const user = run(
    { type: "hold", now: 1000 },
    tick(1000, false, true),
    tick(6000, true, false),
    tick(60_000, true, false),
  )
  expect(voiceGateDelay(user, 60_000)).toBe(900)

  const done = transitionVoiceGate(user, tick(60_000, false, false))
  expect(voiceGateDelay(done, 61_499)).toBe(1)
  expect(voiceGateDelay(done, 61_500)).toBe(0)
})

test("a delegator answer has time to start, then protects speech for fifteen seconds", () => {
  const answered = run({ type: "hold", now: 1000 }, { type: "answer", now: 1000 })
  expect(voiceGateDelay(answered, 1000)).toBe(1200)

  const started = transitionVoiceGate(answered, tick(2000, false, true))
  expect(voiceGateDelay(transitionVoiceGate(started, tick(15_999, false, true)), 15_999)).toBe(1)
  expect(voiceGateDelay(transitionVoiceGate(started, tick(16_000, false, true)), 16_000)).toBe(0)
})

test("an announcement releases its hold and gives itself time to start", () => {
  const announced = run({ type: "hold", now: 1000 }, { type: "announced", now: 2000 })
  expect(announced.status).toBe("open")
  expect(voiceGateDelay(announced, 2000)).toBe(1200)
  // Speech that misses the start window is chatter again; nothing holds, so nothing caps it.
  expect(voiceGateDelay(transitionVoiceGate(announced, tick(9000, false, true)), 9000)).toBe(900)
})

test("an abandoned hold does not let the next reply cut the agent off at once", () => {
  // A reply holds while the user speaks, then a delegation starts and the reply machine clears the wait.
  const abandoned = run(tick(1000, true, false), { type: "hold", now: 1000 }, tick(1500, false, false), {
    type: "release",
  })
  expect(abandoned.status).toBe("open")

  // The agent starts talking and the next reply holds.
  const later: VoiceGateEvent[] = [tick(7000, false, true), { type: "hold", now: 7000 }]
  const next = later.reduce(transitionVoiceGate, abandoned)
  expect(voiceGateDelay(next, 7000)).toBe(900)
  expect(voiceGateDelay(transitionVoiceGate(next, tick(11_999, false, true)), 11_999)).toBe(900)
  expect(voiceGateDelay(transitionVoiceGate(next, tick(12_000, false, true)), 12_000)).toBe(0)
})

test("reading the delay never starts the chatter cap", () => {
  const talking = run(tick(0, false, true), tick(10_000, false, true))
  expect(voiceGateDelay(talking, 10_000)).toBe(900)
  expect(voiceGateDelay(talking, 10_000)).toBe(900)
  expect(talking.status).toBe("open")
})

test("quiet meter ticks and no-op events keep the same state", () => {
  const quiet = run(tick(1000, false, false))
  expect(quiet).toBe(INITIAL_VOICE_GATE_STATE)
  expect(transitionVoiceGate(quiet, tick(1050, false, false))).toBe(quiet)
  expect(transitionVoiceGate(quiet, { type: "release" })).toBe(quiet)

  const ended = run(tick(1000, false, true), tick(1050, false, false))
  expect(transitionVoiceGate(ended, tick(1100, false, false))).toBe(ended)
  expect(transitionVoiceGate(run({ type: "hold", now: 1000 }), { type: "reset" })).toBe(INITIAL_VOICE_GATE_STATE)
})
