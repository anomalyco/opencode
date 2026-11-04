import { afterEach, expect, mock, test } from "bun:test"
import { notify } from "./web"

const originalNotification = globalThis.Notification

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")

afterEach(() => {
  Object.defineProperty(globalThis, "Notification", { value: originalNotification, configurable: true })

  if (originalServiceWorker) Object.defineProperty(navigator, "serviceWorker", originalServiceWorker)
  else Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined })
})

test("uses service worker notifications when the Notification constructor is unavailable", async () => {
  const showNotification = mock(async () => undefined)
  const registration = { active: {}, installing: null, waiting: null, showNotification }
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: class {
      static permission = "granted"
      constructor() {
        throw new TypeError("Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.")
      }
    },
  })
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => registration },
  })

  document.hasFocus = () => false
  await notify("Response ready", "Session", undefined, "https://opencode.test/server/a2V5/session/ses_test")

  expect(showNotification).toHaveBeenCalledTimes(1)
  expect(showNotification.mock.calls[0]).toMatchObject([
    "Response ready",
    {
      body: "Session",
      tag: "https://opencode.test/server/a2V5/session/ses_test",
      data: { url: "https://opencode.test/server/a2V5/session/ses_test" },
    },
  ])
})

test("stays quiet while the app is focused", async () => {
  const showNotification = mock(async () => undefined)
  Object.defineProperty(globalThis, "Notification", {
    configurable: true,
    value: class {
      static permission = "granted"
    },
  })
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => ({ active: {}, showNotification }) },
  })
  document.hasFocus = () => true

  await notify("Response ready")

  expect(showNotification).not.toHaveBeenCalled()
})
