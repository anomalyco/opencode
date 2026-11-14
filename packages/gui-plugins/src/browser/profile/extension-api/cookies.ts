import { Schema } from "effect"
import type { Cookie, Extension, Session } from "electron"
import { cookieURL, PROBE_COOKIE } from "../cookie"
import { method, none, optional, type ApiModule, type Emit } from "./api"
import { matchesHost } from "./match-pattern"
import type { Manifests } from "./manifest"
import type { ExtensionTabs } from "./tabs"

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

/**
 * Whether an extension's host permissions cover a cookie's domain and path, on a scheme it is sent over. The profile's
 * own probe is no one's.
 */
export function canSeeCookie(hosts: readonly string[], cookie: Pick<Cookie, "domain" | "path" | "secure">) {
  const host = (cookie.domain ?? "").replace(/^\./, "")
  const at = (secure: boolean) => cookieURL({ host, path: cookie.path ?? "/", secure })

  return (
    !!host &&
    host !== PROBE_COOKIE.host &&
    (matchesHost(hosts, at(true)) || (!cookie.secure && matchesHost(hosts, at(false))))
  )
}

/**
 * The cookie a `chrome.cookies.set` call would write: its domain (the URL's host when none is given, which makes it
 * host-only), path (the URL's) and whether it is secure (an https URL's is).
 */
export function writtenCookie(details: { url: string; domain?: string | null; path?: string | null; secure?: boolean | null }) {
  const url = new URL(details.url)

  return {
    domain: details.domain ?? url.hostname,
    path: details.path ?? url.pathname,
    secure: details.secure ?? url.protocol === "https:",
  }
}

/**
 * `chrome.cookies` over the profile's cookie store, the one the pane's tabs use. An extension reads and writes only
 * the cookies of hosts its manifest has access to: the URL it names must be one, and so must the cookie it reads,
 * writes or removes. Chrome checks only the URL, which lets an extension for `sub.example.com` write a cookie for all
 * of `example.com`; here an extension writes only cookies it could read back.
 */
export function createCookies(input: {
  session: Session
  tabs: ExtensionTabs
  emit: Emit
  extensions: () => readonly Extension[]
  manifest: Manifests
}): ApiModule {
  const hostsOf = (extension: Extension) => input.manifest(extension).hosts

  const reachable = (extension: Extension, url: string) => {
    if (!matchesHost(hostsOf(extension), url) || (URL.canParse(url) && new URL(url).hostname === PROBE_COOKIE.host))
      throw new Error(`No host permission for cookies at url: "${url}".`)

    return url
  }

  const changed = (_event: Electron.Event, cookie: Cookie, cause: string, removed: boolean) =>
    input.extensions().forEach((extension) => {
      if (!input.manifest(extension).permissions.includes("cookies") || !canSeeCookie(hostsOf(extension), cookie)) return
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
        constants: {
          SameSiteStatus: {
            NO_RESTRICTION: "no_restriction",
            LAX: "lax",
            STRICT: "strict",
            UNSPECIFIED: "unspecified",
          },
        },
      },
    ],
    methods: {
      "cookies.get": method(Schema.Tuple([Details]), async (context, [details]) => {
        const url = reachable(context.extension, details.url)
        const cookies = await input.session.cookies.get({ url, name: details.name })
        const cookie = cookies.find((item) => canSeeCookie(hostsOf(context.extension), item))

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

        return cookies.flatMap((cookie) =>
          canSeeCookie(hostsOf(context.extension), cookie) ? [cookieInfo(cookie)] : [],
        )
      }),
      "cookies.set": method(Schema.Tuple([SetDetails]), async (context, [details]) => {
        const url = reachable(context.extension, details.url)
        const name = details.name ?? ""

        if (!canSeeCookie(hostsOf(context.extension), writtenCookie({ ...details, url })))
          throw new Error(`No host permission for a cookie of domain "${details.domain ?? new URL(url).hostname}".`)

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
        const cookies = await input.session.cookies.get({ url, name })
        const cookie = cookies.find((item) => canSeeCookie(hostsOf(context.extension), item))

        return cookie ? cookieInfo(cookie) : null
      }),
      "cookies.remove": method(Schema.Tuple([Details]), async (context, [details]) => {
        const url = reachable(context.extension, details.url)
        // Removing by URL also removes the parent domain's cookies sent there, which need access of their own.
        const cookies = await input.session.cookies.get({ url, name: details.name })

        if (!cookies.every((item) => canSeeCookie(hostsOf(context.extension), item)))
          throw new Error(`No host permission for every cookie "${details.name}" at url: "${url}".`)
        await input.session.cookies.remove(url, details.name)

        return { url, name: details.name, storeId: STORE }
      }),
      "cookies.getAllCookieStores": method(none, () => [{ id: STORE, tabIds: input.tabs.ids() }]),
      "cookies.getPartitionKey": method(none, () => ({ partitionKey: {} })),
    },
    dispose: () => input.session.cookies.off("changed", changed),
  }
}
