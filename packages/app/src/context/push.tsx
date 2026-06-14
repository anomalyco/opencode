import { createSimpleContext } from "@opencode-ai/ui/context"
import { createStore } from "solid-js/store"
import { createEffect, onCleanup, onMount } from "solid-js"
import { useServerSDK } from "./server-sdk"
import { usePlatform } from "./platform"
import { useSettings } from "./settings"
import { NOTIFICATION_PERMISSION_GRANTED_EVENT } from "@/utils/notification-click"

type PermissionState = NotificationPermission | "unsupported"

type Device = {
  deviceLabel?: string
  enabled: boolean
  endpoint: string
  failureCount: number
  id: string
  lastError?: string
  lastFailureAt?: number
  lastSuccessAt?: number
  notifyOnCompletion: boolean
  notifyOnError: boolean
  serverOrigin: string
}

function suggestedLabel() {
  const agent = typeof navigator === "object" ? navigator.userAgent : ""
  if (/Android/i.test(agent) && /Chrome/i.test(agent)) return "Android Chrome"
  if (/Android/i.test(agent)) return "Android browser"
  if (/(iPhone|iPad|iPod)/i.test(agent) && /Safari/i.test(agent)) return "iPhone Safari"
  if (/Chrome/i.test(agent)) return "Chrome"
  if (/Safari/i.test(agent)) return "Safari"
  if (/Firefox/i.test(agent)) return "Firefox"
  return "This browser"
}

function serverKey(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const raw = atob(padded)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export const { use: usePush, provider: PushProvider } = createSimpleContext({
  name: "Push",
  init: () => {
    const serverSDK = useServerSDK()
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
      deviceLabel: suggestedLabel(),
      devices: [] as Device[],
      enabled: false,
      error: undefined as string | undefined,
      failureCount: 0,
      lastError: undefined as string | undefined,
      lastFailureAt: undefined as number | undefined,
      lastSuccessAt: undefined as number | undefined,
      permission: permission(),
      publicKey: undefined as string | undefined,
      registered: false,
      serverOrigin: typeof location === "object" ? location.origin : "",
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
        refreshDevices() {
          return Promise.resolve()
        },
        setDeviceEnabled() {
          return Promise.resolve(undefined)
        },
        updateDeviceLabel() {
          return Promise.resolve(undefined)
        },
        removeDevice() {
          return Promise.resolve(false)
        },
        setDeviceLabel() {},
        test() {
          return Promise.resolve(false)
        },
        unsubscribe() {
          return Promise.resolve(false)
        },
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let labelTimer: ReturnType<typeof setTimeout> | undefined
    let registrationPromise: Promise<ServiceWorkerRegistration | undefined> | undefined
    let syncing: Promise<void> | undefined

    const normalizeDevice = (item: {
      deviceLabel?: string
      enabled: boolean
      endpoint: string
      failureCount: unknown
      id: string
      lastError?: string
      lastFailureAt?: unknown
      lastSuccessAt?: unknown
      notifyOnCompletion: boolean
      notifyOnError: boolean
      serverOrigin: string
    }) => ({
      deviceLabel: item.deviceLabel,
      enabled: item.enabled,
      endpoint: item.endpoint,
      failureCount: finiteNumber(item.failureCount) ?? 0,
      id: item.id,
      lastError: item.lastError,
      lastFailureAt: finiteNumber(item.lastFailureAt),
      lastSuccessAt: finiteNumber(item.lastSuccessAt),
      notifyOnCompletion: item.notifyOnCompletion,
      notifyOnError: item.notifyOnError,
      serverOrigin: item.serverOrigin,
    })
    type PushDeviceResult = Parameters<typeof normalizeDevice>[0]

    const refreshDevices = async () => {
      const result = await serverSDK().client.global.listPushSubscriptions().catch(() => undefined)
      const devices = (result?.data ?? []).map(normalizeDevice)
      setStore("devices", devices)
      return devices
    }

    const remember = (item?: {
      id: string
      deviceLabel?: string
      failureCount: number
      lastError?: string
      lastFailureAt?: number | null
      lastSuccessAt?: number | null
      serverOrigin: string
    }) => {
      if (!item) return
      setStore("failureCount", item.failureCount)
      setStore("lastError", item.lastError)
      setStore("lastFailureAt", item.lastFailureAt ?? undefined)
      setStore("lastSuccessAt", item.lastSuccessAt ?? undefined)
      setStore("subscriptionID", item.id)
      setStore("serverOrigin", item.serverOrigin)
      if (item.deviceLabel && (store.deviceLabel === suggestedLabel() || !store.deviceLabel.trim())) {
        setStore("deviceLabel", item.deviceLabel)
      }
    }

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
      const devices = await refreshDevices()
      const match = devices.find((item) => item.endpoint === subscription.endpoint)
      if (!match?.id) return
      remember(match)
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

          const pushPublicKey = await serverSDK().client.global.pushPublicKey().catch(() => undefined)
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
            await refreshDevices()
            setStore("failureCount", 0)
            setStore("lastError", undefined)
            setStore("lastFailureAt", undefined)
            setStore("lastSuccessAt", undefined)
            setStore("subscriptionID", undefined)
            return
          }

          const json = subscription.toJSON()
          if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) return
          const result = await serverSDK().client.global.upsertPushSubscription({
            deviceLabel: store.deviceLabel.trim() || undefined,
            endpoint: json.endpoint,
            expirationTime: json.expirationTime ?? undefined,
            keys: {
              auth: json.keys.auth,
              p256dh: json.keys.p256dh,
            },
            enabled,
            notifyOnCompletion: settings.notifications.agent(),
            notifyOnError: settings.notifications.errors(),
            serverOrigin: store.serverOrigin,
            userAgent: navigator.userAgent,
          })
          remember(result.data ? normalizeDevice(result.data) : undefined)
          await refreshDevices()
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
        await serverSDK().client.global.removePushSubscription({ id }).catch(() => undefined)
      }
      const removed = subscription ? await subscription.unsubscribe().catch(() => false) : true
      await refreshDevices()
      setStore({
        deviceLabel: store.deviceLabel,
        enabled: false,
        error: undefined,
        failureCount: 0,
        lastError: undefined,
        lastFailureAt: undefined,
        lastSuccessAt: undefined,
        serverOrigin: store.serverOrigin,
        subscriptionID: undefined,
        subscribed: false,
      })
      return removed
    }

    const removeDevice = async (id: string) => {
      if (id === store.subscriptionID) return unsubscribe()
      const removed = await serverSDK().client.global.removePushSubscription({ id }).catch(() => false)
      await refreshDevices()
      return removed === true
    }

    const setDeviceEnabled = async (id: string, enabled: boolean) => {
      const result = await (
        serverSDK().client.global as {
          updatePushSubscription: (input: { id: string; enabled?: boolean }) => Promise<{
            data?: PushDeviceResult
          }>
        }
      )
        .updatePushSubscription({
          id,
          enabled,
        })
        .catch(() => undefined)
      remember(result?.data ? normalizeDevice(result.data) : undefined)
      await refreshDevices()
      return result?.data
    }

    const updateDeviceLabel = async (id: string, value: string) => {
      const trimmed = value.trim()
      const result = await (
        serverSDK().client.global as {
          updatePushSubscription: (input: { id: string; deviceLabel?: string }) => Promise<{
            data?: PushDeviceResult
          }>
        }
      )
        .updatePushSubscription({
          id,
          deviceLabel: trimmed || undefined,
        })
        .catch(() => undefined)
      remember(result?.data ? normalizeDevice(result.data) : undefined)
      await refreshDevices()
      if (id === store.subscriptionID) {
        setStore("deviceLabel", trimmed || suggestedLabel())
      }
      return result?.data
    }

    const setDeviceLabel = (value: string) => {
      setStore("deviceLabel", value)
      if (labelTimer) clearTimeout(labelTimer)
      labelTimer = setTimeout(() => {
        labelTimer = undefined
        void sync()
      }, 500)
    }

    const test = async () => {
      const worker = await registration()
      const subscription = worker ? await worker.pushManager.getSubscription().catch(() => undefined) : undefined
      const id = await subscriptionID(subscription)
      const result = await (
        serverSDK().client.global as {
          testPush: (input?: { id?: string }) => Promise<{ data?: { sent?: boolean } }>
        }
      )
        .testPush(id ? { id } : {})
        .catch(() => undefined)
      await refreshDevices()
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
      void refreshDevices()
      onCleanup(() => {
        if (timer) clearTimeout(timer)
        if (labelTimer) clearTimeout(labelTimer)
        window.removeEventListener(NOTIFICATION_PERMISSION_GRANTED_EVENT, onPermissionGranted as EventListener)
        document.removeEventListener("visibilitychange", onVisibility)
      })
    })

    return {
      get current() {
        return store
      },
      requestPermission,
      refreshDevices,
      removeDevice,
      setDeviceEnabled,
      setDeviceLabel,
      sync,
      test,
      unsubscribe,
      updateDeviceLabel,
    }
  },
})
