import { createEffect, onCleanup, untrack } from "solid-js"
import { Schema } from "effect"
import { base64Encode } from "@opencode-ai/util/encode"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import type { ServerSDK } from "@/runtime/server/client"
import type { ServerConnection } from "@/runtime/server/registry"
import { useSettings } from "@/settings/model"
import { sessionHref } from "@/shell/routes/session"
import { browserPush, createPushController } from "./push"

export function createServerPush(input: { sdk: ServerSDK; key: ServerConnection.Key }) {
  const platform = usePlatform()
  if (platform.platform !== "web") return
  const settings = useSettings()
  const language = useLanguage()
  const [saved, setSaved, _, ready] = persisted(
    { ...Persist.serverGlobal(input.sdk.scope, "push"), sync: true },
    Persistence.struct({ id: Schema.String, enabled: Schema.Boolean }),
    { id: "", enabled: false },
  )
  const preferences = () => ({
    notifications: { agent: settings.notifications.agent(), errors: settings.notifications.errors() },
    titles: {
      agent: language.t("notification.session.responseReady.title"),
      errors: language.t("notification.session.error.title"),
    },
  })
  const push = createPushController({
    api: () => input.sdk.api.push,
    browser: browserPush(),
    scope: `/push/${base64Encode(input.key)}/`,
    id: () => {
      if (!saved.id) setSaved("id", crypto.randomUUID())
      return saved.id
    },
    url: new URL(sessionHref(input.key, ""), location.origin).href,
    preferences,
    wanted: () => saved.enabled,
    save: (enabled) => setSaved("enabled", enabled),
  })

  createEffect(() => {
    if (!ready() || !settings.ready()) return
    preferences()
    saved.enabled
    // A successful PUT confirms persisted intent; intent alone never disables local notifications.
    untrack(() => void push.refresh())
  })
  const visible = () => {
    if (document.visibilityState === "visible") void push.refresh()
  }
  document.addEventListener("visibilitychange", visible)
  window.addEventListener("online", visible)
  onCleanup(() => {
    document.removeEventListener("visibilitychange", visible)
    window.removeEventListener("online", visible)
  })
  return { ...push, wanted: () => saved.enabled, ready }
}
