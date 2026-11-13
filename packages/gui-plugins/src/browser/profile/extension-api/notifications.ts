import { Schema } from "effect"
import electron from "electron"
import { method, none, optional, type ApiModule, type Emit } from "./api"

const Options = Schema.Struct({
  title: optional(Schema.String),
  message: optional(Schema.String),
  contextMessage: optional(Schema.String),
  silent: optional(Schema.Boolean),
  requireInteraction: optional(Schema.Boolean),
})

/**
 * `chrome.notifications`, shown as the system's notifications from the app. Clicking one tells the extension
 * through `onClicked`; closing it, `onClosed`. Buttons, images and progress are not shown.
 */
export function createNotifications(input: { emit: Emit }): ApiModule {
  // Shown notifications by extension, then by id.
  const shown = new Map<string, Map<string, Electron.Notification>>()

  const show = (extension: string, id: string, options: typeof Options.Type) => {
    const list = shown.get(extension) ?? new Map<string, Electron.Notification>()
    list.get(id)?.close()

    if (!electron.Notification.isSupported()) return id

    const notification = new electron.Notification({
      title: options.title ?? "",
      body: [options.message, options.contextMessage].filter(Boolean).join("\n"),
      silent: options.silent ?? false,
    })

    notification.on("click", () => input.emit("notifications.onClicked", [id], extension))
    notification.on("close", () => {
      if (list.get(id) !== notification) return
      list.delete(id)
      input.emit("notifications.onClosed", [id, false], extension)
    })
    list.set(id, notification)
    shown.set(extension, list)
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
            ? show(context.extension.id, args[0] || crypto.randomUUID(), args[1])
            : show(context.extension.id, crypto.randomUUID(), args[0]),
      ),
      "notifications.update": method(Schema.Tuple([Schema.String, Options]), (context, [id, options]) => {
        if (!shown.get(context.extension.id)?.has(id)) return false
        show(context.extension.id, id, options)

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
    dispose: () => shown.forEach((list) => list.forEach((notification) => notification.close())),
  }
}
