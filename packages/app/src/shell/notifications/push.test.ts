import { expect, mock, test } from "bun:test"
import type { PushSubscribeInput } from "@opencode/client/promise"
import { createPushController, pushSupport, type PushBrowser } from "./push"

const keyBytes = new Uint8Array(65).fill(7)

const publicKey = btoa(String.fromCharCode(...keyBytes))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "")

function subscription(endpoint: string, applicationServerKey = keyBytes) {
  return {
    endpoint,
    options: { applicationServerKey: applicationServerKey.buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } }),
    unsubscribe: async () => true,
  }
}

function browser(input: {
  current?: ReturnType<typeof subscription> | null
  permission?: NotificationPermission
  requestPermission?: () => Promise<NotificationPermission>
  supported?: boolean
} = {}): PushBrowser {
  return {
    issue: () => (input.supported === false ? "unsupported" : undefined),
    permission: () => input.permission ?? "granted",
    requestPermission: input.requestPermission ?? (async () => "granted"),
    registration: async () => undefined,
    // SAFETY: the fakes expose exactly the worker members the controller reads.
    register: async () =>
      ({
        scope: "https://opencode.test/push/a2V5/",
        active: {},
        installing: null,
        waiting: null,
        pushManager: {
          getSubscription: async () => input.current ?? null,
          subscribe: async () => subscription("https://fcm.googleapis.com/fcm/send/new"),
        },
      }) as never,
  }
}

function api() {
  // SAFETY: the fakes record exactly the generated request shapes they receive.
  const calls = {
    subscribe: [] as PushSubscribeInput[],
    unsubscribe: [] as string[],
  }

  // SAFETY: the fake implements the three push operations the controller calls.
  return {
    calls,
    api: {
      get: async () => ({ publicKey }),
      subscribe: async (input: PushSubscribeInput) => {
        calls.subscribe.push(input)

        return input.id
      },
      unsubscribe: async (input: { id: string }) => {
        calls.unsubscribe.push(input.id)
      },
    // SAFETY: the fake implements the three push operations the controller calls.
    } as never,
  }
}

const preferences = () => ({ agent: true, permissions: true, questions: true, errors: false })

const titles = () => ({ agent: "Agent", permissions: "Permission", questions: "Question", errors: "Error" })

test("reports the install and secure-context requirements", () => {
  expect(pushSupport({ secure: false, supported: true, ios: false, installed: true })).toBe("insecure")
  expect(pushSupport({ secure: true, supported: true, ios: true, installed: false })).toBe("install")
  expect(pushSupport({ secure: true, supported: false, ios: false, installed: true })).toBe("unsupported")
  expect(pushSupport({ secure: true, supported: true, ios: true, installed: true })).toBeUndefined()
})

test("requests permission in the click and registers the subscription", async () => {
  const remote = api()
  const save = mock((_enabled: boolean) => undefined)
  const requestPermission = mock(async () => "granted" as const)

  const controller = createPushController({
    api: () => remote.api,
    browser: browser({ permission: "default", requestPermission }),
    scope: "/push/a2V5/",
    id: () => "0f0e0d0c-0b0a-4908-8706-050403020100",
    url: "https://opencode.test/server/a2V5/session/",
    preferences,
    titles,
    wanted: () => true,
    save,
  })

  await controller.enable()

  expect(requestPermission).toHaveBeenCalledTimes(1)
  expect(remote.calls.subscribe).toEqual([
    {
      id: "0f0e0d0c-0b0a-4908-8706-050403020100",
      endpoint: "https://fcm.googleapis.com/fcm/send/new",
      keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) },
      url: "https://opencode.test/server/a2V5/session/",
      preferences: preferences(),
      titles: titles(),
    },
  ])
  expect(save).toHaveBeenCalledWith(true)
  expect(controller.state.enabled).toBe(true)
})

test("refreshes an existing subscription without asking for permission again", async () => {
  const remote = api()
  const current = subscription("https://fcm.googleapis.com/fcm/send/existing")

  const controller = createPushController({
    api: () => remote.api,
    browser: browser({ current }),
    scope: "/push/a2V5/",
    id: () => "0f0e0d0c-0b0a-4908-8706-050403020100",
    url: "https://opencode.test/server/a2V5/session/",
    preferences,
    titles,
    wanted: () => true,
    save: () => undefined,
  })

  await controller.refresh()

  expect(remote.calls.subscribe).toHaveLength(1)
  expect(remote.calls.subscribe[0]?.endpoint).toBe(
    "https://fcm.googleapis.com/fcm/send/existing",
  )
  expect(controller.state.enabled).toBe(true)
})

test("replaces a subscription made with a different VAPID key", async () => {
  const remote = api()
  const old = subscription("https://fcm.googleapis.com/fcm/send/old", new Uint8Array(65).fill(9))

  const controller = createPushController({
    api: () => remote.api,
    browser: browser({ current: old }),
    scope: "/push/a2V5/",
    id: () => "0f0e0d0c-0b0a-4908-8706-050403020100",
    url: "https://opencode.test/server/a2V5/session/",
    preferences,
    titles,
    wanted: () => true,
    save: () => undefined,
  })

  await controller.refresh()

  expect(await old.unsubscribe()).toBe(true)
  expect(remote.calls.unsubscribe).toEqual(["0f0e0d0c-0b0a-4908-8706-050403020100"])
  expect(remote.calls.subscribe[0]?.endpoint).toBe("https://fcm.googleapis.com/fcm/send/new")
})

test("does not subscribe when permission is denied", async () => {
  const remote = api()

  const controller = createPushController({
    api: () => remote.api,
    browser: browser({ permission: "denied" }),
    scope: "/push/a2V5/",
    id: () => "0f0e0d0c-0b0a-4908-8706-050403020100",
    url: "https://opencode.test/server/a2V5/session/",
    preferences,
    titles,
    wanted: () => true,
    save: () => undefined,
  })

  await controller.enable()

  expect(remote.calls.subscribe).toEqual([])
  expect(controller.state).toMatchObject({ enabled: false, issue: "denied" })
})

test("reports a server without push routes", async () => {
  const error = Object.assign(new Error("UnexpectedStatus: 404"), {
    reason: "UnexpectedStatus",
    cause: { status: 404 },
  })

  const controller = createPushController({
    // SAFETY: only `get` is reached before the controller stops on this failure.
    api: () =>
      ({
        get: async () => {
          throw error
        },
      }) as never,
    browser: browser(),
    scope: "/push/a2V5/",
    id: () => "0f0e0d0c-0b0a-4908-8706-050403020100",
    url: "https://opencode.test/server/a2V5/session/",
    preferences,
    titles,
    wanted: () => true,
    save: () => undefined,
  })

  await controller.enable()

  expect(controller.state).toMatchObject({ enabled: false, issue: "serverUnsupported" })
})

test("removes the server row and browser subscription when disabled", async () => {
  const remote = api()
  const current = subscription("https://fcm.googleapis.com/fcm/send/existing")

  const controller = createPushController({
    api: () => remote.api,
    browser: {
      ...browser({ current }),
      registration: async () => {
        // SAFETY: the fake exposes exactly the worker members disable reads.
        return {
          scope: "https://opencode.test/push/a2V5/",
          active: {},
          installing: null,
          waiting: null,
          pushManager: {
            getSubscription: async () => current,
            subscribe: async () => current,
          },
        } as never
      },
    },
    scope: "/push/a2V5/",
    id: () => "0f0e0d0c-0b0a-4908-8706-050403020100",
    url: "https://opencode.test/server/a2V5/session/",
    preferences,
    titles,
    wanted: () => true,
    save: () => undefined,
  })

  await controller.disable()

  expect(remote.calls.unsubscribe).toEqual(["0f0e0d0c-0b0a-4908-8706-050403020100"])
  expect(await current.unsubscribe()).toBe(true)
})
