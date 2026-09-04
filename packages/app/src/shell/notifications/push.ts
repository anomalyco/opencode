import { createStore } from "solid-js/store"
import type { ServerApi } from "@/runtime/server/api"
import { isStandalone } from "@/runtime/platform/pwa"

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
  pushManager: {
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

export function pushSupport(input: {
  secure: boolean
  supported: boolean
  ios: boolean
  installed: boolean
}): PushIssue | undefined {
  if (!input.secure) return "insecure"
  if (input.ios && !input.installed) return "install"
  if (!input.supported) return "unsupported"
}

export function browserPush(): PushBrowser {
  return {
    issue: () =>
      pushSupport({
        secure: window.isSecureContext,
        supported: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
        ios:
          /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
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
      if (!worker) throw new Error("Push worker was not installed")
      await new Promise<void>((resolve, reject) => {
        const changed = () => {
          if (worker.state !== "activated" && worker.state !== "redundant") return
          worker.removeEventListener("statechange", changed)
          if (worker.state === "activated") resolve()
          if (worker.state === "redundant") reject(new Error("Push worker installation failed"))
        }
        worker.addEventListener("statechange", changed)
        changed()
      })
      return registration
    },
  }
}

export function createPushController(input: {
  api: () => ServerApi["push"]
  browser: PushBrowser
  scope: string
  id: () => string
  url: string
  preferences: () => {
    notifications: { agent: boolean; errors: boolean }
    titles: { agent: string; errors: string }
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

  async function subscribe(explicit: boolean) {
    const config = await input
      .api()
      .get()
      .catch((error: unknown) => {
        // The generated client exposes HTTP failures through Error.cause.
        const cause = error instanceof Error ? error.cause : error
        const status = cause && typeof cause === "object" && "status" in cause ? cause.status : undefined
        if (status === 404 || status === 405) throw new Error("serverUnsupported")
        throw error
      })
    const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
    const existing = await input.browser.registration(input.scope)
    const registration = explicit ? await input.browser.register(input.scope) : existing
    if (!registration) throw new Error("subscription")
    const current = await registration.pushManager.getSubscription()
    if (!current && !explicit) throw new Error("subscription")
    const oldKey = current?.options.applicationServerKey
    const matches =
      oldKey && new Uint8Array(oldKey).length === key.length && new Uint8Array(oldKey).every((b, i) => b === key[i])
    if (current && !matches) {
      // Remove the old server registration before replacing a stale VAPID subscription.
      await input.api().unsubscribe({ id: input.id() })
      setState("enabled", false)
      if (!(await current.unsubscribe())) throw new Error("subscription")
    }
    const subscription =
      current && matches
        ? current
        : await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          })
    const keys = subscription.toJSON().keys
    if (!keys?.p256dh || !keys.auth) throw new Error("subscription")
    await input.api().subscribe({
      id: input.id(),
      endpoint: subscription.endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      url: input.url,
      ...input.preferences(),
    })
    input.save(true)
    setState("enabled", true)
  }

  function fail(error: unknown) {
    const message = error instanceof Error ? error.message : undefined
    setState("issue", message === "serverUnsupported" || message === "subscription" ? message : "failed")
  }

  async function run(action: () => Promise<void>) {
    setState({ busy: true, issue: undefined })
    await action().catch(fail)
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
    // This must run synchronously in the click handler, before registration/API awaits (iOS).
    const permission =
      input.browser.permission() === "default"
        ? input.browser.requestPermission()
        : Promise.resolve(input.browser.permission())
    return run(async () => {
      if ((await permission) !== "granted") {
        setState({ enabled: false, issue: "denied" })
        return
      }
      await subscribe(true)
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
      await subscribe(false).catch((error: unknown) => {
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
