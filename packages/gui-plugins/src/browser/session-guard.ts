import { app, type WebContents } from "electron"
import { Option, Schema } from "effect"
import { Browser } from "@opencode/plugin-browser/rpc"
import type { PagePermissions } from "./page-prompts"
import { pagePermission } from "./policy"

const ManifestPermissions = Schema.Struct({ permissions: Schema.optional(Schema.Array(Schema.Unknown)) })

/**
 * The one owner of what Electron keeps once per session, which every tab of the partition shares, and in the profile
 * its extensions' pages too:
 * - permissions: a pane tab's web page asks its user, through its entry in `pages` by web contents ID
 *   (`createPagePrompts`, which applies the agent-driven rule), for the features `site-permissions.ts` lists, and gets
 *   no other permission, device or screen; any other web page gets none; an extension's page gets the clipboard and
 *   notifications its manifest declares (`pagePermission`);
 * - client certificates: never sent; every selection is answered with none;
 * - `file:`: never loaded or navigated to by any page of the session;
 * - downloads: each goes to the tab whose page started it, by web contents ID, or to the system's save flow when no
 *   tab takes it.
 * Returns the removal of its app and session listeners. The permission handlers and the `file:` refusal stay, so
 * nothing is allowed by Electron's default after the pane goes.
 */
export function guardSession(
  session: Electron.Session,
  downloads: ReadonlyMap<number, (item: Electron.DownloadItem) => void>,
  pages: ReadonlyMap<number, PagePermissions> = new Map(),
) {
  // The native file loader is never a preview loader. Leave this refusal on the partition across plugin reloads.
  if (!session.protocol.isProtocolHandled("file")) session.protocol.handle("file", () => Response.error())

  // Including extension background pages and popups. Renderer navigations are cancelled before commit; main's
  // two loadURL callers separately require a translated preview/web URL or a page of the extension's own package.
  const created = (_event: Electron.Event, contents: WebContents) => {
    if (contents.session !== session) return
    contents.on("will-navigate", denyFileNavigation)
    contents.on("will-frame-navigate", denyFileNavigation)
    contents.on("will-redirect", denyFileNavigation)
    // Owned pane tabs and extension popups install their narrower adoption policies. Other views open no windows.
    contents.setWindowOpenHandler(() => ({ action: "deny" }))
  }

  app.on("web-contents-created", created)

  // Electron would send the first matching identity. A future chooser must bind its decision to this request, its
  // requesting origin and live WebContents; dismissal or destruction must still answer with no certificate.
  const choose = (event: Electron.Event, contents: WebContents | null, _url: string, _list: Electron.Certificate[], answer: (certificate?: Electron.Certificate) => void) => {
    if (contents?.session !== session) return
    event.preventDefault()
    answer()
  }

  app.on("select-client-certificate", choose)

  const declared = (id: string) =>
    Schema.decodeUnknownOption(ManifestPermissions)(session.extensions.getExtension(id)?.manifest).pipe(
      Option.flatMap((manifest) => Option.fromNullishOr(manifest.permissions)),
      Option.getOrElse(() => []),
    )

  // A pane tab's web page asks its user (`createPagePrompts`); any other page, and every extension page, gets what
  // `pagePermission` gives.
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const url = details.requestingUrl ?? contents.getURL()
    const page = pages.get(contents.id)

    if (!page || Browser.extensionOrigin(url)) return callback(pagePermission(permission, url, declared))
    page.request(permission, details, callback)
  })
  session.setPermissionCheckHandler((contents, permission, origin, details) => {
    const page = contents ? pages.get(contents.id) : undefined

    if (!page || Browser.extensionOrigin(origin) || Browser.extensionOrigin(details.requestingUrl ?? ""))
      return pagePermission(permission, origin, declared)

    return page.check(permission, origin, details)
  })
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))

  const download = (_event: Electron.Event, item: Electron.DownloadItem, source: WebContents) =>
    downloads.get(source.id)?.(item)

  session.on("will-download", download)

  return () => {
    app.off("web-contents-created", created)
    app.off("select-client-certificate", choose)
    session.off("will-download", download)
  }
}

function denyFileNavigation(event: Electron.Event<{ url: string }>) {
  if (/^file:/i.test(event.url)) event.preventDefault()
}
