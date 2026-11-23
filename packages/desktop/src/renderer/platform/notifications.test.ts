import { afterEach, describe, expect, test } from "bun:test"
import { createDesktopNotify } from "./notifications"

const originalNotification = globalThis.Notification

const created: FakeNotification[] = []

const events: string[] = []

class FakeNotification extends EventTarget implements Notification {
  static readonly permission: NotificationPermission = "granted"

  static async requestPermission(): Promise<NotificationPermission> {
    return "granted"
  }

  onclick: ((this: Notification, ev: Event) => void) | null = null
  onclose: ((this: Notification, ev: Event) => void) | null = null
  onerror: ((this: Notification, ev: Event) => void) | null = null
  onshow: ((this: Notification, ev: Event) => void) | null = null

  readonly body: string
  readonly data = null
  readonly dir: NotificationDirection = "auto"
  readonly icon: string
  readonly lang = ""
  readonly silent: boolean | null
  readonly tag = ""
  readonly title: string

  constructor(title: string, options?: NotificationOptions) {
    super()
    this.title = title
    this.body = options?.body ?? ""
    this.icon = options?.icon ?? ""
    this.silent = options?.silent ?? null
    events.push(`created:${title}:${this.body}`)
    created.push(this)
  }

  close() {
    events.push("notification.close")
    this.onclose?.call(this, new Event("close"))
  }
}

// The calls main gets, and the toast activation it would send back.
const activations: Array<(tag: string) => void> = []

const api = {
  getWindowFocused: async () => false,
  showWindow: async () => {},
  setWindowFocus: async () => {},
  showToast: async (toast: { tag: string; title: string; body: string }) => {
    events.push(`api.showToast:${toast.tag}:${toast.title}:${toast.body}`)
  },
  dismissToast: async (tag: string) => {
    events.push(`api.dismissToast:${tag}`)
  },
  onToastActivated: (cb: (tag: string) => void) => {
    activations.push(cb)

    return () => {}
  },
}

afterEach(() => {
  activations.length = 0
  created.length = 0
  events.length = 0
  globalThis.Notification = originalNotification
})

describe("desktop notifications", () => {
  test("shows and focuses the window on click, runs the callback, and closes the notification", async () => {
    globalThis.Notification = FakeNotification

    const notify = createDesktopNotify({
      ...api,
      showWindow: async () => {
        events.push("api.showWindow")
      },
      setWindowFocus: async () => {
        events.push("api.setWindowFocus")
      },
    }).notify

    await notify("Response ready", "Refactor auth flow", () => {
      events.push("session.select")
    })

    const notification = created[0]
    expect(notification).toBeDefined()

    notification?.onclick?.call(notification, new Event("click"))

    expect(events).toEqual([
      "created:Response ready:Refactor auth flow",
      "api.showWindow",
      "api.setWindowFocus",
      "session.select",
      "notification.close",
    ])
    expect(notification?.onclick).toBeNull()
    expect(notification?.onclose).toBeNull()
    expect(notification?.onerror).toBeNull()
  })

  test.each([{ event: "close" as const }, { event: "error" as const }])(
    "releases the Notification handlers when $event fires without a click",
    async ({ event }) => {
      globalThis.Notification = FakeNotification

      const notify = createDesktopNotify(api).notify

      await notify("Session error")

      const notification = created[0]
      expect(notification).toBeDefined()

      if (event === "close") {
        notification?.onclose?.call(notification, new Event("close"))
      } else {
        notification?.onerror?.call(notification, new Event("error"))
      }

      expect(notification?.onclick).toBeNull()
      expect(notification?.onclose).toBeNull()
      expect(notification?.onerror).toBeNull()
    },
  )

  test("suppresses desktop notifications while the window is already focused", async () => {
    globalThis.Notification = FakeNotification

    const notify = createDesktopNotify({ ...api, getWindowFocused: async () => true }).notify

    await notify("Response ready", "Active session")
    expect(events).toEqual([])
    expect(created).toEqual([])
  })

  test("on windows a tagged notification is a toast main posts, with its detail line; a click runs the callback and an answer takes it back, also one another window posted", async () => {
    const desktop = createDesktopNotify(api, "windows")
    const tag = "server\0request:per_1"

    await desktop.notify("Permission required", "Fix login", () => events.push("session.select"), {
      tag,
      detail: "bash:  git   push",
    })
    activations.forEach((activate) => activate(tag))
    await desktop.notify("Permission required", "Fix login", undefined, { tag, detail: "bash: git status" })
    desktop.dismissNotification?.(tag)
    desktop.dismissNotification?.("server\0session:ses_9")

    expect(events).toEqual([
      "api.showToast:server\0request:per_1:Permission required:Fix login\nbash: git push",
      "session.select",
      "api.showToast:server\0request:per_1:Permission required:Fix login\nbash: git status",
      "api.dismissToast:server\0request:per_1",
      "api.dismissToast:server\0session:ses_9",
    ])
    expect(created).toEqual([])
  })

  test("on macos a tagged notification stays a page notification", async () => {
    globalThis.Notification = FakeNotification

    await createDesktopNotify(api, "macos").notify("Response ready", "Fix login", undefined, {
      tag: "server\0session:ses_1",
    })
    createDesktopNotify(api, "macos").dismissNotification?.("server\0session:ses_1")

    expect(events).toEqual(["created:Response ready:Fix login"])
  })
})
