import type { WebContents } from "electron"
import { Option, Schema } from "effect"
import { pagePermission } from "./policy"

const ManifestPermissions = Schema.Struct({ permissions: Schema.optional(Schema.Array(Schema.Unknown)) })

/**
 * Installs what Electron keeps once per session, which every tab of the partition shares, and in the profile its
 * extensions' pages too: web pages get no permission, device or screen; an extension's page gets the clipboard and
 * notifications its manifest declares (`pagePermission`); a download goes to the tab whose page started it, by web
 * contents ID, or to the system's save flow when no tab takes it. Returns the download listener's removal. The
 * permission handlers stay, so nothing is allowed by Electron's default after the pane goes.
 */
export function guardSession(
  session: Electron.Session,
  downloads: ReadonlyMap<number, (item: Electron.DownloadItem) => void>,
) {
  const declared = (id: string) =>
    Schema.decodeUnknownOption(ManifestPermissions)(session.extensions.getExtension(id)?.manifest).pipe(
      Option.flatMap((manifest) => Option.fromNullishOr(manifest.permissions)),
      Option.getOrElse(() => []),
    )

  session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(pagePermission(permission, details.requestingUrl ?? contents.getURL(), declared)),
  )
  session.setPermissionCheckHandler((_contents, permission, origin) => pagePermission(permission, origin, declared))
  session.setDevicePermissionHandler(() => false)
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}))

  const download = (_event: Electron.Event, item: Electron.DownloadItem, source: WebContents) =>
    downloads.get(source.id)?.(item)

  session.on("will-download", download)

  return () => void session.off("will-download", download)
}
