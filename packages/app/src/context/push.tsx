import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { createEffect, onCleanup, onMount } from "solid-js"
import { useGlobalSDK } from "./global-sdk"
import { usePlatform } from "./platform"
import { useSettings } from "./settings"
import { NOTIFICATION_PERMISSION_GRANTED_EVENT } from "@/utils/notification-click"

type PermissionState = NotificationPermission | "unsupported"

function serverKey(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export const { use: usePush, provider: PushProvider } = createSimpleContext({
  name: "Push",
  init: () => {
    const globalSDK = useGlobalSDK()
    const platform = usePlatform()
    const settings = useSettings()
    const supported =
      platform.platform === "web" &&
      typeof window === "object" &&
      "Notification" in window &&
      "PushManager" in window &&
      "serviceWorker" in navigator

    const permission = () => {
      if (!supported) return "unsupported" satisfies PermissionState
      return Notification.permission
    }

    const [store, setStore] = createStore({
      enabled: false,
      error: undefined as string | undefined,
      permission: permission(),
      publicKey: undefined as string | undefined,
      registered: false,
      subscriptionID: undefined as string | undefined,
      subscribed: false,
      supported,
      syncing: false,
    })

    if (!supported) {
      return {
        get current() {
          return store
        },
        sync() {
          return Promise.resolve()
        },
        requestPermission() {
          return Promise.resolve("unsupported" as const)
        },
        test() {
          return Promise.resolve(false)
        },
        unsubscribe() {
          return Promise.resolve(false)
        },
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | undefined
    let syncing: Promise<void> | undefined

    const wantsPush = () => settings.notifications.agent() || settings.notifications.errors()

    const registration = async () => {
      if (registrationPromise) return registrationPromise
      registrationPromise = navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(() => navigator.serviceWorker.ready)
        .then((value) => {
          setStore("registered", true)
          return value
        })
        .catch((error) => {
          setStore("error", error instanceof Error ? error.message : String(error))
          return undefined
        })
      return registrationPromise
    }

    const subscriptionID = async (subscription?: PushSubscription | null) => {
      if (store.subscriptionID) return store.subscriptionID
      if (!subscription?.endpoint) return
      const response = await globalSDK.client.global.listPushSubscriptions().catch(() => undefined)
      const match = response?.data?.find((item) => item.endpoint === subscription.endpoint)
      if (!match?.id) return
      setStore("subscriptionID", match.id)
      return match.id
    }

    const requestPermission = async () => {
      if (permission() === "granted") return "granted" as const
      const result = await Notification.requestPermission().catch(() => "denied" as const)
      setStore("permission", result)
      if (result === "granted") {
        window.dispatchEvent(new Event(NOTIFICATION_PERMISSION_GRANTED_EVENT))
      }
      return result
    }

    const sync = async () => {
      if (syncing) return syncing
      syncing = (async () => {
        setStore("syncing", true)
        setStore("permission", permission())
        try {
          const worker = await registration()
          if (!worker) return

          const pushPublicKey = await globalSDK.client.global.pushPublicKey().catch(() => undefined)
          const publicKey =
            pushPublicKey?.data?.supported === true && typeof pushPublicKey.data.publicKey === "string"
              ? pushPublicKey.data.publicKey
              : undefined
          setStore("publicKey", publicKey)
          if (!publicKey) return

          const granted = permission() === "granted"
          const enabled = granted && wantsPush()
          let subscription = await worker.pushManager.getSubscription().catch(() => undefined)

          if (!subscription && enabled) {
            subscription = await worker.pushManager
              .subscribe({
                applicationServerKey: serverKey(publicKey),
                userVisibleOnly: true,
              })
              .catch((error) => {
                setStore("error", error instanceof Error ? error.message : String(error))
                return undefined
              })
          }

          setStore("enabled", enabled)
          setStore("subscribed", !!subscription)
          if (!subscription) {
            setStore("subscriptionID", undefined)
            return
          }

          const json = subscription.toJSON()
          if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) return
          const result = await globalSDK.client.global.upsertPushSubscription({
            endpoint: json.endpoint,
            expirationTime: json.expirationTime ?? null,
            keys: {
              auth: json.keys.auth,
              p256dh: json.keys.p256dh,
            },
            enabled,
            notifyOnCompletion: settings.notifications.agent(),
            notifyOnError: settings.notifications.errors(),
            userAgent: navigator.userAgent,
          })
          if (result.data?.id) {
            setStore("subscriptionID", result.data.id)
          }
          setStore("error", undefined)
        } finally {
          setStore("syncing", false)
          syncing = undefined
        }
      })()

      return syncing
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void sync()
      }, 50)
    }

    createEffect(() => {
      settings.notifications.agent()
      settings.notifications.errors()
      schedule()
    })

    const unsubscribe = async () => {
      const worker = await registration()
      if (!worker) return false
      const subscription = await worker.pushManager.getSubscription().catch(() => undefined)
      const id = await subscriptionID(subscription)
      if (id) {
        await globalSDK.client.global.removePushSubscription({ id }).catch(() => undefined)
      }
      const removed = subscription ? await subscription.unsubscribe().catch(() => false) : true
      setStore({
        enabled: false,
        error: undefined,
        subscriptionID: undefined,
        subscribed: false,
      })
      return removed
    }

    const test = async () => {
      const worker = await registration()
      const subscription = worker ? await worker.pushManager.getSubscription().catch(() => undefined) : undefined
      const id = await subscriptionID(subscription)
      const result = await (
        globalSDK.client.global as typeof globalSDK.client.global & {
          testPush: (input?: { id?: string }) => Promise<{ data?: { sent?: boolean } }>
        }
      )
        .testPush(id ? { id } : {})
        .catch(() => undefined)
      return result?.data?.sent === true
    }

    onMount(() => {
      const onPermissionGranted = () => {
        schedule()
      }
      const onVisibility = () => {
        if (document.visibilityState !== "visible") return
        schedule()
      }

      window.addEventListener(NOTIFICATION_PERMISSION_GRANTED_EVENT, onPermissionGranted as EventListener)
      document.addEventListener("visibilitychange", onVisibility)
      schedule()
      onCleanup(() => {
        if (timer) clearTimeout(timer)
        window.removeEventListener(NOTIFICATION_PERMISSION_GRANTED_EVENT, onPermissionGranted as EventListener)
        document.removeEventListener("visibilitychange", onVisibility)
      })
    })

    return {
      get current() {
        return store
      },
      requestPermission,
      sync,
      test,
      unsubscribe,
    }
  },
})
