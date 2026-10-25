import { createStore } from "solid-js/store"
import type { ServerApi } from "@/runtime/server/api"
import { isIOS, isStandalone } from "@/runtime/platform/pwa"

export type PushIssue =
  | "insecure"
  | "install"
  | "unsupported"
  | "denied"
  | "serverUnsupported"
  | "subscription"
  | "failed"

type Subscription = Pick<PushSubscription, "endpoint" | "options" | "toJSON" | "unsubscribe">

type Registration = {
  readonly scope: string
  readonly active: ServiceWorker | null
  readonly installing: ServiceWorker | null
  readonly waiting: ServiceWorker | null
  readonly pushManager: {
    getSubscription(): Promise<Subscription | null>
    subscribe(options: PushSubscriptionOptionsInit): Promise<Subscription>
  }
}

export type PushBrowser = {
  issue(): PushIssue | undefined
  permission(): NotificationPermission
  requestPermission(): Promise<NotificationPermission>
  registration(scope: string): Promise<Registration | undefined>
  register(scope: string): Promise<Registration>
}

export function pushSupport(input: { secure: boolean; supported: boolean; ios: boolean; installed: boolean }) {
  if (!input.secure) return "insecure" satisfies PushIssue

  if (input.ios && !input.installed) return "install" satisfies PushIssue

  if (!input.supported) return "unsupported" satisfies PushIssue
}

export function browserPush(): PushBrowser {
  return {
    issue: () =>
      pushSupport({
        secure: window.isSecureContext,
        supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
        ios: isIOS(),
        installed: isStandalone(),
      }),
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    registration: async (scope) => {
      const registration = await navigator.serviceWorker.getRegistration(scope)

      // getRegistration can otherwise return the unrelated root offline worker.
      if (registration?.scope === new URL(scope, location.origin).href) return registration
    },
    register: async (scope) => {
      const registration = await navigator.serviceWorker.register("/push-sw.js", { scope })

      if (registration.active) return registration
      const worker = registration.installing ?? registration.waiting

      if (!worker) throw new Error("subscription")
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.removeEventListener("statechange", changed)
          reject(new Error("subscription"))
        }, 10_000)

        const changed = () => {
          if (worker.state !== "activated" && worker.state !== "redundant") return
          clearTimeout(timeout)
          worker.removeEventListener("statechange", changed)

          if (worker.state === "activated") resolve()

          if (worker.state === "redundant") reject(new Error("subscription"))
        }

        worker.addEventListener("statechange", changed)
        changed()
      })

      return registration
    },
  }
}

function keyBytes(applicationServerKey: ArrayBuffer | null | undefined) {
  return applicationServerKey ? new Uint8Array(applicationServerKey) : undefined
}

function sameKey(left: ArrayBuffer | null | undefined, right: Uint8Array) {
  const current = keyBytes(left)

  return !!current && current.length === right.length && current.every((byte, index) => byte === right[index])
}

type ClientFailure = Error & { reason?: string; cause?: { status?: number } }

function unsupported(error: ClientFailure) {
  return (
    error.reason === "UnexpectedStatus" &&
    (error.cause?.status === 404 || error.cause?.status === 405)
  )
}

export function createSubscriptionID() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createPushController(input: {
  api: () => ServerApi["push"]
  browser: PushBrowser
  scope: string
  id: () => string
  url: string
  preferences: () => {
    agent: boolean
    permissions: boolean
    questions: boolean
    errors: boolean
  }
  titles: () => {
    agent: string
    permissions: string
    questions: string
    errors: string
  }
  wanted: () => boolean
  save: (enabled: boolean) => void
}) {
  const [state, setState] = createStore({
    enabled: false,
    busy: false,
    issue: input.browser.issue(),
  })

  const pending = { refresh: false }

  async function subscribe() {
    const config = await input
      .api()
      .get()
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected request is opaque
      .catch((error: unknown) => {
        if (!(error instanceof Error)) throw error

        // SAFETY: the generated client attaches `reason` and `cause.status` to HTTP failures.
        if (unsupported(error as ClientFailure)) throw new Error("serverUnsupported")
        throw error
      })

    const encoded = config.publicKey.replace(/-/g, "+").replace(/_/g, "/")
    const key = Uint8Array.from(atob(encoded + "=".repeat((4 - (encoded.length % 4)) % 4)), (c) => c.charCodeAt(0))
    // Reaching here means push is wanted and permission is granted, so installing or
    // reopening the worker never broadens what the user consented to.
    const registration = await input.browser.register(input.scope)
    const current = await registration.pushManager.getSubscription()

    if (current && !sameKey(current.options.applicationServerKey, key)) {
      // A changed VAPID key invalidates the old endpoint. Remove the server row before
      // replacing the browser subscription so the stale endpoint stops receiving sends.
      await input.api().unsubscribe({ id: input.id() })
      setState("enabled", false)

      if (!(await current.unsubscribe())) throw new Error("subscription")
    }

    const subscription =
      current && sameKey(current.options.applicationServerKey, key)
        ? current
        : await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })

    const keys = subscription.toJSON().keys

    if (!keys?.p256dh || !keys.auth) throw new Error("subscription")
    await input.api().subscribe({
      id: input.id(),
      endpoint: subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      url: input.url,
      preferences: input.preferences(),
      titles: input.titles(),
    })
    input.save(true)
    setState("enabled", true)
  }

  function fail(error: Error) {
    setState("issue", error.message === "serverUnsupported" || error.message === "subscription" ? error.message : "failed")
  }

  async function run(action: () => Promise<void>) {
    setState({ busy: true, issue: undefined })
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected action is opaque
    await action().catch((error: unknown) => fail(error instanceof Error ? error : new Error(String(error))))
    setState("busy", false)

    if (!pending.refresh) return
    pending.refresh = false
    await refresh()
  }

  function enable() {
    if (state.busy) return Promise.resolve()
    const issue = input.browser.issue()

    if (issue) {
      setState("issue", issue)

      return Promise.resolve()
    }

    // iOS only accepts the permission request while the click's user activation is live.
    const permission =
      input.browser.permission() === "default"
        ? input.browser.requestPermission()
        : Promise.resolve(input.browser.permission())

    return run(async () => {
      if ((await permission) !== "granted") {
        setState({ enabled: false, issue: "denied" })

        return
      }

      await subscribe()
    })
  }

  function refresh() {
    if (state.busy) {
      pending.refresh = true

      return Promise.resolve()
    }

    if (!input.wanted()) {
      setState("enabled", false)

      return Promise.resolve()
    }

    const issue = input.browser.issue() ?? (input.browser.permission() === "granted" ? undefined : "denied")

    if (issue) {
      setState({ enabled: false, issue })

      return Promise.resolve()
    }

    return run(async () => {
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected subscription is opaque
      await subscribe().catch((error: unknown) => {
        setState("enabled", false)
        throw error
      })
    })
  }

  function disable() {
    if (state.busy) return Promise.resolve()

    return run(async () => {
      await input.api().unsubscribe({ id: input.id() })
      input.save(false)
      setState("enabled", false)
      const registration = await input.browser.registration(input.scope)
      const subscription = await registration?.pushManager.getSubscription()

      if (subscription && !(await subscription.unsubscribe())) throw new Error("subscription")
    })
  }

  return { state, enable, disable, refresh }
}
