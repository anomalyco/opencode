import { Option, Schema } from "effect"
import electron from "electron"
import { closestIcon, readIcon } from "../extensions"
import { method, none, optional, type ApiModule, type Emit, type ExtensionContext } from "./api"

const Icons = Schema.Struct({ icons: Schema.optional(Schema.Record(Schema.String, Schema.String)) })

const Options = Schema.Struct({
  title: optional(Schema.String),
  message: optional(Schema.String),
  contextMessage: optional(Schema.String),
  silent: optional(Schema.Boolean),
  requireInteraction: optional(Schema.Boolean),
})

/**
 * `chrome.notifications`, shown as the system's notifications from the app, titled with the extension's name and
 * shown with its icon, with the extension's own title as the first line. Clicking one tells the extension through
 * `onClicked`; closing it, `onClosed`. Buttons, images and progress are not shown.
 */
export function createNotifications(input: { emit: Emit }): ApiModule {
  // Shown notifications by extension, then by id.
  const shown = new Map<string, Map<string, Electron.Notification>>()

  const show = async (context: ExtensionContext, id: string, options: typeof Options.Type) => {
    const extension = context.extension.id
    const list = shown.get(extension) ?? new Map<string, Electron.Notification>()
    list.get(id)?.close()

    if (!electron.Notification.isSupported()) return id
    const icons = Option.getOrUndefined(Schema.decodeUnknownOption(Icons)(context.extension.manifest))?.icons
    const file = icons ? closestIcon(icons) : undefined
    const icon = file ? await readIcon(context.extension.path, file) : undefined

    // Titled with the extension's name and shown with its icon, so it never passes for one of the app's own.
    const notification = new electron.Notification({
      title: context.extension.name,
      body: [options.title, options.message, options.contextMessage].filter(Boolean).join("\n"),
      icon: icon ? electron.nativeImage.createFromBuffer(icon) : undefined,
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
      list?.forEach((notification) => notification.close())
    },
    dispose: () => shown.forEach((list) => list.forEach((notification) => notification.close())),
  }
}
