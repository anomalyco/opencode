import { Schema } from "effect"
import type { Cookie, Extension, Session } from "electron"
import { method, none, optional, type ApiModule, type Emit } from "./api"
import { matchesHost } from "./match-pattern"
import { declared, type ExtensionTabs } from "./tabs"

const Details = Schema.Struct({ url: Schema.String, name: Schema.String, storeId: optional(Schema.String) })

const Filter = Schema.Struct({
  url: optional(Schema.String),
  domain: optional(Schema.String),
  name: optional(Schema.String),
  path: optional(Schema.String),
  secure: optional(Schema.Boolean),
  session: optional(Schema.Boolean),
  storeId: optional(Schema.String),
})

const SetDetails = Schema.Struct({
  url: Schema.String,
  name: optional(Schema.String),
  value: optional(Schema.String),
  domain: optional(Schema.String),
  path: optional(Schema.String),
  secure: optional(Schema.Boolean),
  httpOnly: optional(Schema.Boolean),
  sameSite: optional(Schema.Literals(["no_restriction", "lax", "strict", "unspecified"])),
  expirationDate: optional(Schema.Number),
  storeId: optional(Schema.String),
})

const STORE = "0"

/** A cookie as `chrome.cookies` describes it. */
export function cookieInfo(cookie: Cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? "",
    hostOnly: cookie.hostOnly ?? false,
    path: cookie.path ?? "/",
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    sameSite: cookie.sameSite,
    session: cookie.session ?? true,
    expirationDate: cookie.expirationDate,
    storeId: STORE,
  }
}

/** Whether an extension's host permissions cover a cookie's domain, on either scheme. */
export function canSeeCookie(hosts: readonly string[], cookie: Pick<Cookie, "domain" | "path" | "secure">) {
  const host = (cookie.domain ?? "").replace(/^\./, "")
  const path = cookie.path ?? "/"

  return (
    !!host &&
    (matchesHost(hosts, `https://${host}${path}`) || (!cookie.secure && matchesHost(hosts, `http://${host}${path}`)))
  )
}

/**
 * `chrome.cookies` over the profile's cookie store, the one the pane's tabs use. An extension reads and writes only
 * the cookies of hosts its manifest has access to.
 */
export function createCookies(input: {
  session: Session
  tabs: ExtensionTabs
  emit: Emit
  extensions: () => readonly Extension[]
}): ApiModule {
  const hostsOf = (extension: Pick<Extension, "manifest">) => declared(extension).hosts

  const reachable = (extension: Pick<Extension, "manifest">, url: string) => {
    if (!matchesHost(hostsOf(extension), url)) throw new Error(`No host permission for cookies at url: "${url}".`)

    return url
  }

  const changed = (_event: Electron.Event, cookie: Cookie, cause: string, removed: boolean) =>
    input.extensions().forEach((extension) => {
      if (!declared(extension).permissions.includes("cookies") || !canSeeCookie(hostsOf(extension), cookie)) return
      input.emit("cookies.onChanged", [{ removed, cookie: cookieInfo(cookie), cause }], extension.id)
    })

  input.session.cookies.on("changed", changed)

  return {
    namespaces: [
      {
        path: "cookies",
        permissions: ["cookies"],
        methods: ["get", "getAll", "set", "remove", "getAllCookieStores", "getPartitionKey"],
        events: ["onChanged"],
        constants: { SameSiteStatus: { NO_RESTRICTION: "no_restriction", LAX: "lax", STRICT: "strict", UNSPECIFIED: "unspecified" } },
      },
    ],
    methods: {
      "cookies.get": method(Schema.Tuple([Details]), async (context, [details]) => {
        const url = reachable(context.extension, details.url)
        const [cookie] = await input.session.cookies.get({ url, name: details.name })

        return cookie ? cookieInfo(cookie) : null
      }),
      "cookies.getAll": method(Schema.Tuple([optional(Filter)]), async (context, [filter]) => {
        const url = filter?.url == null ? undefined : reachable(context.extension, filter.url)

        const cookies = await input.session.cookies.get({
          url,
          domain: filter?.domain ?? undefined,
          name: filter?.name ?? undefined,
          path: filter?.path ?? undefined,
          secure: filter?.secure ?? undefined,
          session: filter?.session ?? undefined,
        })

        return cookies.flatMap((cookie) => (canSeeCookie(hostsOf(context.extension), cookie) ? [cookieInfo(cookie)] : []))
      }),
      "cookies.set": method(Schema.Tuple([SetDetails]), async (context, [details]) => {
        const url = reachable(context.extension, details.url)
        const name = details.name ?? ""

        await input.session.cookies.set({
          url,
          name,
          value: details.value ?? "",
          domain: details.domain ?? undefined,
          path: details.path ?? undefined,
          secure: details.secure ?? undefined,
          httpOnly: details.httpOnly ?? undefined,
          sameSite: details.sameSite ?? undefined,
          expirationDate: details.expirationDate ?? undefined,
        })
        const [cookie] = await input.session.cookies.get({ url, name })

        return cookie ? cookieInfo(cookie) : null
      }),
      "cookies.remove": method(Schema.Tuple([Details]), async (context, [details]) => {
        const url = reachable(context.extension, details.url)
        await input.session.cookies.remove(url, details.name)

        return { url, name: details.name, storeId: STORE }
      }),
      "cookies.getAllCookieStores": method(none, () => [
        { id: STORE, tabIds: input.tabs.ids() },
      ]),
      "cookies.getPartitionKey": method(none, () => ({ partitionKey: {} })),
    },
    dispose: () => input.session.cookies.off("changed", changed),
  }
}
