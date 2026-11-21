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
  readonly tag: string
  readonly title: string

  constructor(title: string, options?: NotificationOptions) {
    super()
    this.title = title
    this.body = options?.body ?? ""
    this.icon = options?.icon ?? ""
    this.silent = options?.silent ?? null
    this.tag = options?.tag ?? ""
    events.push(`created:${title}:${this.body}`)
    created.push(this)
  }

  close() {
    events.push(`notification.close${this.tag ? `:${this.tag}` : ""}`)
    this.onclose?.call(this, new Event("close"))
  }
}

// Main posts no toast with buttons, as when `opencode://` opens another install.
const plainToasts = {
  showToast: async () => false,
  dismissToast: async () => {},
  onToastActivated: () => () => {},
}

afterEach(() => {
  created.length = 0
  events.length = 0
  globalThis.Notification = originalNotification
})

describe("desktop notifications", () => {
  test("shows and focuses the window on click, runs the callback, and closes the notification", async () => {
    globalThis.Notification = FakeNotification

    const notify = createDesktopNotify({
      getWindowFocused: async () => false,
      showWindow: async () => {
        events.push("api.showWindow")
      },
      setWindowFocus: async () => {
        events.push("api.setWindowFocus")
      },
      ...plainToasts,
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

      const notify = createDesktopNotify({
        getWindowFocused: async () => false,
        showWindow: async () => {},
        setWindowFocus: async () => {},
        ...plainToasts,
      }).notify

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

    const notify = createDesktopNotify({
      getWindowFocused: async () => true,
      showWindow: async () => {},
      setWindowFocus: async () => {},
      ...plainToasts,
    }).notify

    await notify("Response ready", "Active session")
    expect(events).toEqual([])
    expect(created).toEqual([])
  })

  test.each([
    {
      os: "windows" as const,
      icon: "favicon-96x96-v3.png",
      events: [
        "created:Permission required:Fix login\nbash: git status",
        "notification.close:server\0request:per_1",
        "created:Permission required:Fix login\nbash: git push",
        "notification.close:server\0request:per_1",
      ],
    },
    {
      os: "macos" as const,
      icon: "https://opencode.ai/favicon-96x96-v3.png",
      events: ["created:Permission required:Fix login", "created:Permission required:Fix login"],
    },
  ])("on $os a tagged notification replaces its predecessor and its dismissal takes it back", async (input) => {
    globalThis.Notification = FakeNotification

    const desktop = createDesktopNotify(
      {
        getWindowFocused: async () => false,
        showWindow: async () => {},
        setWindowFocus: async () => {},
        ...plainToasts,
      },
      input.os,
    )

    const tag = "server\0request:per_1"
    await desktop.notify("Permission required", "Fix login", undefined, { tag, detail: "bash: git   status" })
    await desktop.notify("Permission required", "Fix login", undefined, { tag, detail: "bash: git push" })
    desktop.dismissNotification?.(tag)

    expect(events).toEqual(input.events)
    expect(created.map((notification) => notification.icon)).toEqual([input.icon, input.icon])
  })

  test.each([
    {
      server: "s1",
      name: "on windows a button answers through main's toast",
      os: "windows" as const,
      posts: true,
      activations: [{ tag: "s1\0request:per_2", action: "once" }],
      events: ["main.show:s1\0request:per_1", "main.show:s1\0request:per_2", "action:per_2:once"],
    },
    {
      server: "s2",
      name: "on windows a click on main's toast body opens the request",
      os: "windows" as const,
      posts: true,
      activations: [{ tag: "s2\0request:per_1" }, { tag: "s2\0request:per_1", action: "once" }],
      events: ["main.show:s2\0request:per_1", "main.show:s2\0request:per_2", "open:per_1"],
    },
    {
      server: "s3",
      name: "on windows a toast main can't post falls back to a plain notification",
      os: "windows" as const,
      posts: false,
      activations: [{ tag: "s3\0request:per_1", action: "once" }],
      events: [
        "main.show:s3\0request:per_1",
        "created:Permission required:Fix login\nbash: git status",
        "main.show:s3\0request:per_2",
        "created:Permission required:Fix login\nbash: git status",
      ],
    },
    {
      server: "s4",
      name: "on macos buttons are ignored",
      os: "macos" as const,
      posts: true,
      activations: [{ tag: "s4\0request:per_1", action: "once" }],
      events: ["created:Permission required:Fix login", "created:Permission required:Fix login"],
    },
  ])("$name", async (input) => {
    globalThis.Notification = FakeNotification
    const listeners: Array<(activation: { tag: string; action?: string }) => void> = []

    const desktop = createDesktopNotify(
      {
        getWindowFocused: async () => false,
        showWindow: async () => {},
        setWindowFocus: async () => {},
        showToast: async (toast) => {
          events.push(`main.show:${toast.tag}`)

          return input.posts
        },
        dismissToast: async (tag) => {
          events.push(`main.dismiss:${tag}`)
        },
        onToastActivated: (listener) => {
          listeners.push(listener)

          return () => {}
        },
      },
      input.os,
    )

    const actions = [{ id: "once", label: "Allow once" }]

    for (const id of ["per_1", "per_2"]) {
      await desktop.notify("Permission required", "Fix login", () => events.push(`open:${id}`), {
        tag: `${input.server}\0request:${id}`,
        detail: "bash: git status",
        actions,
        onAction: (action) => events.push(`action:${id}:${action}`),
      })
    }

    input.activations.forEach((activation) => listeners.forEach((listener) => listener(activation)))

    expect(events).toEqual(input.events)
  })

  test("on windows dismissing an answered request takes main's toast back", async () => {
    const desktop = createDesktopNotify(
      {
        getWindowFocused: async () => false,
        showWindow: async () => {},
        setWindowFocus: async () => {},
        showToast: async () => true,
        dismissToast: async (tag) => {
          events.push(`main.dismiss:${tag}`)
        },
        onToastActivated: () => () => {},
      },
      "windows",
    )

    await desktop.notify("Permission required", "Fix login", undefined, {
      tag: "server\0request:per_3",
      actions: [{ id: "once", label: "Allow once" }],
      onAction: () => {},
    })
    desktop.dismissNotification?.("server\0request:per_3")
    desktop.dismissNotification?.("server\0request:per_3")

    expect(events).toEqual(["main.dismiss:server\0request:per_3"])
  })
})
