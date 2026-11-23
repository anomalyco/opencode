import { Schema } from "effect"
import { extensionLabel } from "./label"
import electron from "electron"
import { closestIcon, readIcon } from "../extensions"
import { method, none, optional, type ApiModule, type Emit, type ExtensionContext } from "./api"
import type { Manifests } from "./manifest"

const Options = Schema.Struct({
  title: optional(Schema.String),
  message: optional(Schema.String),
  contextMessage: optional(Schema.String),
  silent: optional(Schema.Boolean),
  requireInteraction: optional(Schema.Boolean),
})

/**
 * How many extension notifications are shown at once, across extensions. More would let one extension bury the app's
 * own notifications in the system's notification centre.
 */
export const NOTIFICATION_LIMIT = 10

/** A shown extension notification: the extension's id and the notification's id there. */
export type ShownNotification = { readonly extension: string; readonly id: string }

/** The shown notifications, oldest first; only `showNotification`'s result and a close replace them. */
type NotificationOrder = { shown: readonly ShownNotification[] }

/**
 * The notifications shown, oldest first, once `next` is shown, and those to close for it: the oldest beyond `limit`.
 * Showing an id again replaces its notification, which then counts as the newest.
 */
export function showNotification(shown: readonly ShownNotification[], next: ShownNotification, limit = NOTIFICATION_LIMIT) {
  const kept = [...shown.filter((item) => item.extension !== next.extension || item.id !== next.id), next]
  const over = Math.max(0, kept.length - limit)

  return { shown: kept.slice(over), closed: kept.slice(0, over) }
}

/**
 * `chrome.notifications`, shown as the system's notifications from the app, titled with the extension's name and
 * shown with its icon, with the extension's own title as the first line. Clicking one tells the extension through
 * `onClicked`; closing it, `onClosed`. Buttons, images and progress are not shown. At most `NOTIFICATION_LIMIT` are
 * shown at once: the oldest closes for a new one, and its extension hears `onClosed`.
 */
export function createNotifications(input: { emit: Emit; manifest: Manifests; title: (name: string) => string }): ApiModule {
  // Shown notifications by extension, then by id, and all of them oldest first.
  const shown = new Map<string, Map<string, Electron.Notification>>()
  const order: NotificationOrder = { shown: [] }

  // Closes a notification to make room for a newer one; its extension hears `onClosed`, as when the person closes it.
  const evict = (item: ShownNotification) => {
    const list = shown.get(item.extension)
    const notification = list?.get(item.id)

    if (!notification) return
    list?.delete(item.id)
    input.emit("notifications.onClosed", [item.id, false], item.extension)
    notification.close()
  }

  const show = async (context: ExtensionContext, id: string, options: typeof Options.Type) => {
    const extension = context.extension.id
    const list = shown.get(extension) ?? new Map<string, Electron.Notification>()
    list.get(id)?.close()

    if (!electron.Notification.isSupported()) return id
    const file = closestIcon(input.manifest(context.extension).icons)
    const icon = file ? await readIcon(context.extension.path, file) : undefined

    // Titled with the extension's name and shown with its icon, so it never passes for one of the app's own.
    const notification = new electron.Notification({
      title: input.title(extensionLabel(context.extension.name) || extension),
      body: [options.title, options.message, options.contextMessage].filter(Boolean).join("\n"),
      icon: icon ? electron.nativeImage.createFromBuffer(icon) : undefined,
      silent: options.silent ?? false,
    })

    notification.on("click", () => input.emit("notifications.onClicked", [id], extension))
    notification.on("close", () => {
      if (list.get(id) !== notification) return
      list.delete(id)
      order.shown = order.shown.filter((item) => item.extension !== extension || item.id !== id)
      input.emit("notifications.onClosed", [id, false], extension)
    })
    list.set(id, notification)
    shown.set(extension, list)
    const next = showNotification(order.shown, { extension, id })
    order.shown = next.shown
    next.closed.forEach(evict)
    notification.show()

    return id
  }

  return {
    namespaces: [
      {
        path: "notifications",
        permissions: ["notifications"],
        methods: ["create", "update", "clear", "getAll", "getPermissionLevel"],
        events: ["onClosed", "onClicked", "onButtonClicked", "onPermissionLevelChanged", "onShowSettings"],
        constants: {
          TemplateType: { BASIC: "basic", IMAGE: "image", LIST: "list", PROGRESS: "progress" },
          PermissionLevel: { GRANTED: "granted", DENIED: "denied" },
        },
      },
    ],
    methods: {
      "notifications.create": method(
        Schema.Union([Schema.Tuple([Schema.String, Options]), Schema.Tuple([Options])]),
        (context, args) =>
          args.length === 2
            ? show(context, args[0] || crypto.randomUUID(), args[1])
            : show(context, crypto.randomUUID(), args[0]),
      ),
      "notifications.update": method(Schema.Tuple([Schema.String, Options]), async (context, [id, options]) => {
        if (!shown.get(context.extension.id)?.has(id)) return false
        await show(context, id, options)

        return true
      }),
      "notifications.clear": method(Schema.Tuple([Schema.String]), (context, [id]) => {
        const notification = shown.get(context.extension.id)?.get(id)
        notification?.close()

        return !!notification
      }),
      "notifications.getAll": method(none, (context) =>
        Object.fromEntries([...(shown.get(context.extension.id)?.keys() ?? [])].map((id) => [id, true])),
      ),
      "notifications.getPermissionLevel": method(none, () => (electron.Notification.isSupported() ? "granted" : "denied")),
    },
    forget: (extension) => {
      const list = shown.get(extension)
      shown.delete(extension)
      order.shown = order.shown.filter((item) => item.extension !== extension)
      list?.forEach((notification) => notification.close())
    },
    dispose: () => shown.forEach((list) => list.forEach((notification) => notification.close())),
  }
}
