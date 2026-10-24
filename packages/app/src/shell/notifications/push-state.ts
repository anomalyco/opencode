import { createEffect, onCleanup, untrack } from "solid-js"
import { Schema } from "effect"
import { base64Encode } from "@opencode/util/encode"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import type { ServerSDK } from "@/runtime/server/client"
import type { ServerConnection } from "@/runtime/server/registry"
import { useSettings } from "@/settings/model"
import { sessionHref } from "@/shell/routes/session"
import { browserPush, createPushController, createSubscriptionID } from "./push"

export function createServerPush(input: { sdk: ServerSDK; key: ServerConnection.Key }) {
  const platform = usePlatform()

  if (platform.platform !== "web") return

  // Tests and non-browser renderers may have no HTTP origin; push needs one.
  if (!URL.canParse(location.origin)) return
  const settings = useSettings()
  const language = useLanguage()

  const [saved, setSaved, , ready] = persisted(
    { ...Persist.serverGlobal(input.sdk.scope, "push"), sync: true },
    Persistence.struct({ id: Schema.String, enabled: Schema.Boolean }),
    { id: "", enabled: false },
  )

  const preferences = () => ({
    agent: settings.notifications.agent(),
    permissions: settings.notifications.permissions(),
    questions: settings.notifications.questions(),
    errors: settings.notifications.errors(),
  })

  const titles = () => ({
    agent: language.t("notification.session.responseReady.title"),
    permissions: language.t("notification.permission.title"),
    questions: language.t("notification.session.question.title"),
    errors: language.t("notification.session.error.title"),
  })

  const push = createPushController({
    api: () => input.sdk.api.push,
    browser: browserPush(),
    scope: `/push/${base64Encode(input.key)}/`,
    id: () => {
      if (!saved.id) setSaved("id", createSubscriptionID())

      return saved.id
    },
    url: new URL(sessionHref(input.key, ""), location.origin).href,
    preferences,
    titles,
    wanted: () => saved.enabled,
    save: (enabled) => setSaved("enabled", enabled),
  })

  createEffect(() => {
    if (!ready() || !settings.ready()) return
    preferences()
    titles()
    saved.enabled

    if (input.sdk.connection.status() !== "connected") return
    // Reading the tracked values above refreshes the server copy whenever prefs or the
    // locale change. The refresh itself is untracked so its state updates cannot loop.
    untrack(() => void push.refresh())
  })

  const visible = () => {
    if (!saved.enabled || document.visibilityState !== "visible") return
    void push.refresh()
  }

  const message = (event: MessageEvent) => {
    if (event.data?.type !== "opencode.push.subscription-change") return

    if (!saved.enabled) return
    void push.refresh()
  }

  document.addEventListener("visibilitychange", visible)
  window.addEventListener("online", visible)

  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", message)
  onCleanup(() => {
    document.removeEventListener("visibilitychange", visible)
    window.removeEventListener("online", visible)

    if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", message)
  })

  return { ...push, wanted: () => saved.enabled, ready }
}
