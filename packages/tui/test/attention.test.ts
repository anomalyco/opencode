import { describe, expect, test } from "bun:test"
import type { AttentionNotifyOptions } from "@opencode/plugin/tui/context"
import { createTuiAttention } from "../src/attention"

type Focus = "focused" | "blurred"
type Input = Parameters<typeof createTuiAttention>[0]

// Mirrors the file-locked compare-and-set the TUI storage provides: the first
// caller to set a key wins and every later caller observes it.
function sharedClaims() {
  const seen = new Set<string>()
  return async (key: string) => {
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
}

function host(input: {
  claim: (key: string) => Promise<boolean>
  focus: Focus
  notifications?: boolean
  sound?: boolean
  onNotification?: (title?: string) => void
  onSound?: () => void
}) {
  const listeners = new Map<string, Array<() => void>>()
  const renderer: Input["renderer"] = {
    isDestroyed: false,
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return renderer
    },
    off(event, listener) {
      listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== listener))
      return renderer
    },
    triggerNotification(_message, title) {
      input.onNotification?.(title)
      return true
    },
  }
  const audio = {
    loadSoundFile: async () => ({}),
    play: () => {
      input.onSound?.()
      return {}
    },
  } as unknown as Input["audio"]
  const attention = createTuiAttention({
    renderer,
    config: {
      attention: {
        notifications: input.notifications ?? true,
        sound: input.sound ?? true,
        volume: 1,
        sound_pack: "test",
        sounds: {},
      },
    } as unknown as Input["config"],
    audio,
    claim: input.claim,
  })
  for (const listener of listeners.get(input.focus === "focused" ? "focus" : "blur") ?? []) listener()
  return attention
}

const alert: AttentionNotifyOptions = {
  key: "event-1",
  title: "Demo session",
  message: "Permission needs input",
  notification: { when: "blurred" },
  sound: { name: "permission", when: "always" },
}

describe("attention dedup across TUI instances", () => {
  test("only the first instance emits the notification and sound for one key", async () => {
    const claim = sharedClaims()
    const notifications: Array<string | undefined> = []
    const sounds: string[] = []
    const first = host({ claim, focus: "blurred", onNotification: (title) => notifications.push(title), onSound: () => sounds.push("first") })
    const second = host({
      claim,
      focus: "blurred",
      onNotification: (title) => notifications.push(title),
      onSound: () => sounds.push("second"),
    })

    await first.notify(alert)
    await second.notify(alert)

    expect(notifications).toEqual(["Demo session"])
    expect(sounds).toEqual(["first"])
  })

  test("a focused instance does not consume the notification claim", async () => {
    const claim = sharedClaims()
    const notifications: Array<string | undefined> = []
    const focused = host({ claim, focus: "focused", onNotification: (title) => notifications.push(title) })
    const blurred = host({ claim, focus: "blurred", onNotification: (title) => notifications.push(title) })

    await focused.notify(alert)
    await blurred.notify(alert)

    expect(notifications).toEqual(["Demo session"])
  })

  test("different keys each emit", async () => {
    const claim = sharedClaims()
    const notifications: Array<string | undefined> = []
    const one = host({ claim, focus: "blurred", onNotification: (title) => notifications.push(title) })
    const two = host({ claim, focus: "blurred", onNotification: (title) => notifications.push(title) })

    await one.notify(alert)
    await two.notify({ ...alert, key: "event-2" })

    expect(notifications).toEqual(["Demo session", "Demo session"])
  })

  test("without a key every instance still emits", async () => {
    const claim = sharedClaims()
    const notifications: Array<string | undefined> = []
    const one = host({ claim, focus: "blurred", onNotification: (title) => notifications.push(title) })
    const two = host({ claim, focus: "blurred", onNotification: (title) => notifications.push(title) })

    await one.notify({ ...alert, key: undefined })
    await two.notify({ ...alert, key: undefined })

    expect(notifications).toHaveLength(2)
  })

  test("a failed claim fails open so the alert is not lost", async () => {
    const claim = async () => {
      throw new Error("storage unavailable")
    }
    const notifications: Array<string | undefined> = []
    const attention = host({ claim, focus: "blurred", onNotification: (title) => notifications.push(title) })

    await attention.notify(alert)

    expect(notifications).toEqual(["Demo session"])
  })
})
