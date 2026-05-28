import { describe, expect, test } from "bun:test"
import type { AudioPlayOptions, AudioSound } from "@opentui/core"
import { createTuiAttention } from "@/cli/cmd/tui/attention"
import type { TuiConfig } from "@/cli/cmd/tui/config/tui"

type FocusEvent = "focus" | "blur"

type AttentionConfig = Pick<TuiConfig.Resolved, "attention">

class FakeRenderer {
  isDestroyed = false
  notificationResult = true
  notificationThrows = false
  notifications: { message: string; title: string | undefined }[] = []
  listeners: Record<FocusEvent, Set<() => void>> = {
    focus: new Set(),
    blur: new Set(),
  }

  on(event: FocusEvent, listener: () => void) {
    this.listeners[event].add(listener)
    return this
  }

  off(event: FocusEvent, listener: () => void) {
    this.listeners[event].delete(listener)
    return this
  }

  emit(event: FocusEvent) {
    for (const listener of this.listeners[event]) listener()
  }

  listenerCount(event: FocusEvent) {
    return this.listeners[event].size
  }

  triggerNotification(message: string, title?: string) {
    if (this.notificationThrows) throw new Error("notification failed")
    this.notifications.push({ message, title })
    return this.notificationResult
  }
}

class FakeAudioEngine {
  loadResult: AudioSound | null = 1
  playResult: number | null = 1
  loadCalls = 0
  playCalls = 0
  volumes: (number | undefined)[] = []
  loadPaths: string[] = []
  rejectLoad = false
  rejectPaths = new Set<string>()

  async loadSoundFile(path: string) {
    this.loadCalls += 1
    this.loadPaths.push(path)
    if (this.rejectLoad || this.rejectPaths.has(path)) throw new Error("decode failed")
    return this.loadResult
  }

  play(_sound: AudioSound, options?: AudioPlayOptions) {
    this.playCalls += 1
    this.volumes.push(options?.volume)
    return this.playResult
  }
}

class FakeKV {
  store: Record<string, unknown> = {}

  get ready() {
    return true
  }

  get<Value = unknown>(key: string, fallback?: Value) {
    return (this.store[key] ?? fallback) as Value
  }

  set(key: string, value: unknown) {
    this.store[key] = value
  }
}

function config(attention: Partial<AttentionConfig["attention"]> = {}): AttentionConfig {
  return {
    attention: {
      enabled: true,
      notifications: true,
      sound: true,
      volume: 0.4,
      sound_pack: "opencode.default",
      sounds: {},
      ...attention,
    },
  }
}

describe("createTuiAttention", () => {
  test("defaults to sound always and notification blurred", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })

    expect(await attention.notify({ message: "hello" })).toEqual({
      ok: true,
      notification: false,
      sound: true,
    })
    expect(renderer.notifications).toHaveLength(0)
    expect(audio.playCalls).toBe(1)
  })

  test("supports blurred-only requests", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })

    expect(await attention.notify({ message: "unknown", sound: { when: "blurred" } })).toEqual({
      ok: false,
      notification: false,
      sound: false,
      skipped: "focus_unknown",
    })
    renderer.emit("focus")
    expect(await attention.notify({ message: "focused", sound: { when: "blurred" } })).toEqual({
      ok: false,
      notification: false,
      sound: false,
      skipped: "focused",
    })
    renderer.emit("blur")
    expect(await attention.notify({ message: "blurred", sound: { when: "blurred" } })).toEqual({
      ok: true,
      notification: true,
      sound: true,
    })
    expect(audio.playCalls).toBe(1)
  })

  test("supports focused-only requests", async () => {
    const renderer = new FakeRenderer()
    const attention = createTuiAttention({ renderer, config: config(), audio: new FakeAudioEngine() })

    expect(await attention.notify({ message: "unknown", notification: { when: "focused" }, sound: false })).toEqual({
      ok: false,
      notification: false,
      sound: false,
      skipped: "focus_unknown",
    })
    renderer.emit("blur")
    expect(await attention.notify({ message: "blurred", notification: { when: "focused" }, sound: false })).toEqual({
      ok: false,
      notification: false,
      sound: false,
      skipped: "blurred",
    })
    renderer.emit("focus")
    expect(await attention.notify({ message: "focused", notification: { when: "focused" }, sound: false })).toEqual({
      ok: true,
      notification: true,
      sound: false,
    })
    expect(renderer.notifications).toEqual([{ title: "opencode", message: "focused" }])
  })

  test("notification can deliver while focused when requested", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })
    renderer.emit("focus")

    expect(await attention.notify({ message: "hello", notification: { when: "always" } })).toEqual({
      ok: true,
      notification: true,
      sound: true,
    })
    expect(audio.playCalls).toBe(1)
    expect(renderer.notifications).toEqual([{ title: "opencode", message: "hello" }])
  })

  test("notifies while blurred", async () => {
    const renderer = new FakeRenderer()
    const attention = createTuiAttention({ renderer, config: config(), audio: new FakeAudioEngine() })
    renderer.emit("blur")

    expect(await attention.notify({ title: "opencode", message: "hello", sound: false })).toEqual({
      ok: true,
      notification: true,
      sound: false,
    })
    expect(renderer.notifications).toEqual([{ title: "opencode", message: "hello" }])
  })

  test("when requested, blurred-only calls do not notify or play sound while focused", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })
    renderer.emit("focus")

    expect(await attention.notify({ message: "hello", sound: { when: "blurred" } })).toEqual({
      ok: false,
      notification: false,
      sound: false,
      skipped: "focused",
    })
    expect(renderer.notifications).toHaveLength(0)
    expect(audio.loadCalls).toBe(0)
  })

  test("can play sound always while notification is blurred-only", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })
    renderer.emit("focus")

    expect(
      await attention.notify({
        message: "hello",
        sound: { name: "question" },
      }),
    ).toEqual({
      ok: true,
      notification: false,
      sound: true,
    })
    expect(renderer.notifications).toHaveLength(0)
    expect(audio.playCalls).toBe(1)

    renderer.emit("blur")
    expect(
      await attention.notify({
        message: "hello again",
        sound: { name: "question" },
      }),
    ).toEqual({
      ok: true,
      notification: true,
      sound: true,
    })
    expect(renderer.notifications).toEqual([{ title: "opencode", message: "hello again" }])
  })

  test("can disable notification per call while still playing sound", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })

    expect(await attention.notify({ message: "hello", notification: false })).toEqual({
      ok: true,
      notification: false,
      sound: true,
    })
    expect(renderer.notifications).toHaveLength(0)
    expect(audio.playCalls).toBe(1)
  })

  test("skips empty messages and disabled attention", async () => {
    const empty = new FakeRenderer()
    empty.emit("blur")
    const disabled = new FakeRenderer()
    disabled.emit("blur")

    expect(await createTuiAttention({ renderer: empty, config: config() }).notify({ message: " \n " })).toEqual({
      ok: false,
      notification: false,
      sound: false,
      skipped: "empty_message",
    })
    expect(
      await createTuiAttention({ renderer: disabled, config: config({ enabled: false }) }).notify({ message: "hello" }),
    ).toEqual({
      ok: false,
      notification: false,
      sound: false,
      skipped: "attention_disabled",
    })
  })

  test("respects notification and sound config independently", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config({ notifications: false }), audio })
    renderer.emit("blur")

    expect(await attention.notify({ message: "hello", sound: true })).toEqual({
      ok: true,
      notification: false,
      sound: true,
    })
    expect(renderer.notifications).toHaveLength(0)
    expect(audio.playCalls).toBe(1)

    const soundDisabledRenderer = new FakeRenderer()
    const soundDisabledAudio = new FakeAudioEngine()
    const soundDisabled = createTuiAttention({
      renderer: soundDisabledRenderer,
      config: config({ sound: false }),
      audio: soundDisabledAudio,
    })
    soundDisabledRenderer.emit("blur")

    expect(await soundDisabled.notify({ message: "hello", sound: true })).toEqual({
      ok: true,
      notification: true,
      sound: false,
    })
    expect(soundDisabledAudio.loadCalls).toBe(0)
  })

  test("loads audio lazily only for eligible sound requests", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })

    await attention.notify({ message: "unknown", sound: { when: "blurred" } })
    expect(audio.loadCalls).toBe(0)

    renderer.emit("blur")
    expect(await attention.notify({ message: "blurred", sound: { volume: 2 } })).toEqual({
      ok: true,
      notification: true,
      sound: true,
    })
    expect(audio.loadCalls).toBe(1)
    expect(audio.volumes).toEqual([1])
  })

  test("handles unavailable playback and delegates sound loading", async () => {
    const unavailableRenderer = new FakeRenderer()
    const unavailableAudio = new FakeAudioEngine()
    unavailableAudio.playResult = null
    const unavailable = createTuiAttention({ renderer: unavailableRenderer, config: config(), audio: unavailableAudio })
    unavailableRenderer.emit("blur")

    expect(await unavailable.notify({ message: "hello", sound: true })).toEqual({
      ok: true,
      notification: true,
      sound: false,
    })
    expect(unavailableAudio.loadCalls).toBe(1)
    expect(unavailableAudio.playCalls).toBe(1)

    const repeatedRenderer = new FakeRenderer()
    const repeatedAudio = new FakeAudioEngine()
    const repeated = createTuiAttention({ renderer: repeatedRenderer, config: config(), audio: repeatedAudio })
    repeatedRenderer.emit("blur")

    await repeated.notify({ message: "one", sound: true })
    await repeated.notify({ message: "two", sound: true })
    expect(repeatedAudio.loadCalls).toBe(2)
    expect(repeatedAudio.playCalls).toBe(2)
  })

  test("plays named sounds from the active sound pack", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })
    renderer.emit("blur")

    const dispose = attention.soundboard.registerPack({
      id: "acme.soft",
      name: "Soft Alerts",
      sounds: {
        question: "/tmp/question.mp3",
      },
    })

    expect(attention.soundboard.activate("acme.soft")).toBe(true)
    expect(attention.soundboard.current()).toBe("acme.soft")
    expect(attention.soundboard.list()).toContainEqual({
      id: "acme.soft",
      name: "Soft Alerts",
      active: true,
      builtin: false,
    })

    expect(await attention.notify({ message: "question", sound: { name: "question" } })).toEqual({
      ok: true,
      notification: true,
      sound: true,
    })
    expect(audio.loadPaths).toEqual(["/tmp/question.mp3"])

    dispose()
    expect(attention.soundboard.current()).toBe("opencode.default")
  })

  test("uses config sound overrides before active pack sounds and falls back on load failure", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    audio.rejectPaths.add("/tmp/bad-question.mp3")
    const attention = createTuiAttention({
      renderer,
      config: config({ sounds: { question: "/tmp/bad-question.mp3" } }),
      audio,
    })
    renderer.emit("blur")

    attention.soundboard.registerPack({
      id: "acme.soft",
      sounds: {
        question: "/tmp/good-question.mp3",
      },
    })
    attention.soundboard.activate("acme.soft")

    expect(await attention.notify({ message: "question", sound: { name: "question" } })).toEqual({
      ok: true,
      notification: true,
      sound: true,
    })
    expect(audio.loadPaths).toEqual(["/tmp/bad-question.mp3", "/tmp/good-question.mp3"])
  })

  test("persists activated sound pack in KV", () => {
    const kv = new FakeKV()
    const renderer = new FakeRenderer()
    const attention = createTuiAttention({ renderer, config: config(), kv })

    attention.soundboard.registerPack({ id: "acme.soft", sounds: { done: "/tmp/done.mp3" } })

    expect(attention.soundboard.activate("missing", { persist: true })).toBe(false)
    expect(kv.store.attention_sound_pack).toBeUndefined()
    expect(attention.soundboard.activate("acme.soft", { persist: true })).toBe(true)
    expect(kv.store.attention_sound_pack).toBe("acme.soft")

    const next = createTuiAttention({ renderer: new FakeRenderer(), config: config(), kv })
    next.soundboard.registerPack({ id: "acme.soft", sounds: { done: "/tmp/done.mp3" } })
    expect(next.soundboard.current()).toBe("acme.soft")
  })

  test("does not throw for notification or sound failures", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    renderer.notificationThrows = true
    audio.rejectLoad = true
    const attention = createTuiAttention({ renderer, config: config(), audio })
    renderer.emit("blur")

    expect(await attention.notify({ message: "hello", sound: true })).toEqual({
      ok: false,
      notification: false,
      sound: false,
    })
  })

  test("strips unsafe notification text", async () => {
    const renderer = new FakeRenderer()
    const attention = createTuiAttention({ renderer, config: config(), audio: new FakeAudioEngine() })
    renderer.emit("blur")

    await attention.notify({
      title: "\u001b[31m danger\n title\u0007",
      message: "\u001b[32m hello\n world\u0000",
    })

    expect(renderer.notifications).toEqual([{ title: "danger title", message: "hello world" }])
  })

  test("disposes renderer listeners", async () => {
    const renderer = new FakeRenderer()
    const audio = new FakeAudioEngine()
    const attention = createTuiAttention({ renderer, config: config(), audio })
    renderer.emit("blur")
    await attention.notify({ message: "hello", sound: true })

    expect(renderer.listenerCount("focus")).toBe(1)
    expect(renderer.listenerCount("blur")).toBe(1)

    attention.dispose()
    renderer.isDestroyed = true

    expect(renderer.listenerCount("focus")).toBe(0)
    expect(renderer.listenerCount("blur")).toBe(0)
    expect(audio.loadCalls).toBe(1)
    expect(await attention.notify({ message: "hello" })).toEqual({
      ok: false,
      notification: false,
      sound: false,
      skipped: "renderer_destroyed",
    })
  })
})
