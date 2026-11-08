import { afterEach, describe, expect, test } from "bun:test"
import { Predicate } from "effect"

const originalNotification = globalThis.Notification

const originalFocus = window.focus

// These tests substitute browser notification implementations for the real Notification global.
const stubNotification = (value: unknown) => {
  // SAFETY: value is always one of this file's Notification doubles (or the saved original global).
  globalThis.Notification = value as typeof Notification
}

const keyOf = (options: NotificationOptions) => {
  // SAFETY: createWebNotify writes `{ key }` into the worker notification's data; this is the test's read-back.
  const data = options.data as { key?: unknown } | undefined

  return Predicate.isString(data?.key) ? data.key : undefined
}

type Shown = { title: string; options: NotificationOptions }

const shown: Shown[] = []

const constructed: FakeNotification[] = []

const events: string[] = []

let permission: NotificationPermission = "granted"

class FakeNotification extends EventTarget implements Notification {
  static get permission(): NotificationPermission {
    return permission
  }

  static async requestPermission(): Promise<NotificationPermission> {
    events.push("requestPermission")

    return permission
  }

  onclick: ((this: Notification, ev: Event) => void) | null = null
  onclose: ((this: Notification, ev: Event) => void) | null = null
  onerror: ((this: Notification, ev: Event) => void) | null = null
  onshow: ((this: Notification, ev: Event) => void) | null = null

  readonly actions = []
  readonly body: string
  readonly data = null
  readonly dir: NotificationDirection = "auto"
  readonly icon: string
  readonly lang = ""
  readonly requireInteraction = false
  readonly silent: boolean | null
  readonly tag = ""
  readonly title: string

  constructor(title: string, options?: NotificationOptions) {
    super()
    this.title = title
    this.body = options?.body ?? ""
    this.icon = options?.icon ?? ""
    this.silent = options?.silent ?? null
    events.push(`constructed:${title}`)
    constructed.push(this)
  }

  close() {
    events.push("notification.close")
    this.onclose?.call(this, new Event("close"))
  }
}

// Chrome for Android exposes the interface but throws from its constructor.
class AndroidNotification {
  static get permission(): NotificationPermission {
    return permission
  }

  static async requestPermission(): Promise<NotificationPermission> {
    events.push("requestPermission")

    return permission
  }

  constructor() {
    throw new TypeError(
      "Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.",
    )
  }
}

class FakeRegistration {
  active = {}
  fail = false

  async showNotification(title: string, options: NotificationOptions) {
    if (this.fail) throw new Error("showNotification failed")
    events.push(`shown:${title}`)
    shown.push({ title, options })
  }
}

class FakeServiceWorkerContainer extends EventTarget {
  registration: FakeRegistration | undefined

  registered = 0

  async getRegistration() {
    return this.registration
  }

  async register() {
    this.registered += 1

    return this.registration
  }
}

const serviceWorker = new FakeServiceWorkerContainer()

Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true })

const { createWebNotify } = await import("./web")

const notify = (title: string, description?: string, onClick?: () => void) =>
  createWebNotify()(title, description, onClick)

afterEach(() => {
  shown.length = 0
  constructed.length = 0
  events.length = 0
  permission = "granted"
  serviceWorker.registration = undefined
  serviceWorker.registered = 0
  globalThis.Notification = originalNotification
  window.focus = originalFocus
  // SAFETY: tests install their own document.hasFocus stub; deleting the own property restores happy-dom's.
  delete (document as { hasFocus?: unknown }).hasFocus
})

describe("web notifications", () => {
  // Chrome for Android has no Notification constructor and only shows through the service worker.
  test("shows through an active service worker when the constructor is unavailable", async () => {
    stubNotification(AndroidNotification)
    serviceWorker.registration = new FakeRegistration()
    Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true })

    await notify("Agent done", "session title")

    expect(shown).toHaveLength(1)
    expect(shown[0]!.title).toBe("Agent done")
    expect(shown[0]!.options.body).toBe("session title")
    expect(shown[0]!.options.icon).toBe("https://opencode.ai/favicon-96x96-v3.png")
    expect(keyOf(shown[0]!.options)).toBeString()
  })

  test("keeps the constructor path when no service worker can show a notification", async () => {
    stubNotification(FakeNotification)
    Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true })

    let clicked = 0
    await notify("Agent done", undefined, () => (clicked += 1))

    expect(constructed).toHaveLength(1)
    expect(shown).toHaveLength(0)
    expect(serviceWorker.registered).toBe(1)

    const eventsBefore = events.length
    window.focus = () => events.push("window.focus")
    constructed[0]!.onclick?.call(constructed[0]!, new Event("click"))
    expect(events.slice(eventsBefore)).toEqual(["window.focus", "notification.close"])
    expect(clicked).toBe(1)
  })

  test("resolves without showing when the constructor throws and no service worker is available", async () => {
    stubNotification(AndroidNotification)
    Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true })

    await expect(notify("Agent done")).resolves.toBeUndefined()
    expect(shown).toHaveLength(0)
  })

  test("resolves without showing while the window is visible and focused", async () => {
    stubNotification(FakeNotification)
    Object.defineProperty(document, "hasFocus", { value: () => true, configurable: true })

    await notify("Agent done")

    expect(constructed).toHaveLength(0)
    expect(shown).toHaveLength(0)
  })

  test("resolves without rejecting when showNotification fails", async () => {
    stubNotification(AndroidNotification)
    serviceWorker.registration = new FakeRegistration()
    serviceWorker.registration.fail = true
    Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true })

    await expect(notify("Agent done")).resolves.toBeUndefined()
    expect(shown).toHaveLength(0)
  })

  test("asks for permission only while it is undecided and never shows when denied", async () => {
    stubNotification(FakeNotification)
    permission = "default"
    Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true })

    await notify("Agent done")
    expect(events).toEqual(["requestPermission"])

    events.length = 0
    permission = "denied"
    await notify("Agent done")
    expect(events).toEqual([])
    expect(constructed).toHaveLength(0)
  })

  test("runs the creating window's click callback when the service worker reports a click", async () => {
    stubNotification(AndroidNotification)
    serviceWorker.registration = new FakeRegistration()
    Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true })

    let clicked = 0
    await notify("Agent done", undefined, () => (clicked += 1))
    events.length = 0

    const key = keyOf(shown[0]!.options)
    window.focus = () => events.push("window.focus")
    serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "opencode:notificationclick", key } }),
    )

    expect(clicked).toBe(1)
    expect(events).toEqual(["window.focus"])

    events.length = 0
    serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "opencode:notificationclick", key } }),
    )
    expect(events).toEqual([])
    expect(clicked).toBe(1)
  })

  test("ignores service worker messages without a known click key", async () => {
    stubNotification(AndroidNotification)
    serviceWorker.registration = new FakeRegistration()
    Object.defineProperty(document, "hasFocus", { value: () => false, configurable: true })

    let clicked = 0
    await notify("Agent done", undefined, () => (clicked += 1))
    events.length = 0

    window.focus = () => events.push("window.focus")
    serviceWorker.dispatchEvent(
      new MessageEvent("message", { data: { type: "opencode:notificationclick", key: "foreign" } }),
    )
    serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "other" } }))

    expect(clicked).toBe(0)
    expect(events).toEqual([])
  })
})
