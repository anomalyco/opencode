import type { MenuItemConstructorOptions } from "electron"
import { resolveExternalURL } from "../files/external-url"
import { nativeT } from "./translations"

/**
 * The leading menu items for a right-clicked link: open it in the external browser, above the default link items.
 * Empty for a target the app itself cannot open, such as a `file://` URL, and for `mailto:` links, which the system
 * hands to a mail app rather than a browser.
 */
export function linkMenuItems(linkURL: string | undefined, open: (url: string) => void): MenuItemConstructorOptions[] {
  const url = linkURL ? resolveExternalURL(linkURL) : undefined

  if (!url || !/^https?:/.test(url)) return []

  return [{ label: nativeT("desktop.contextMenu.openLink"), click: () => open(url) }, { type: "separator" }]
}
