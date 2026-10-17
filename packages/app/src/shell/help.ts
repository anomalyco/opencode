import { DESKTOP_MENU } from "./commands/desktop-menu"

/**
 * The support destinations the in-app Help menu offers, in the order the desktop menu bar lists them.
 *
 * Built from the Help group of `DESKTOP_MENU` so both menus stay on the same destinations and labels
 * instead of drifting apart: the labels are the native keys every locale already ships
 * (`runtime/i18n/desktop-native.ts`) and the hrefs are the ones that group opens. Its
 * `desktop.menu.exportLogs` entry is filtered out with the rest of the commands, because it runs a
 * command rather than opening a destination.
 */
export const HELP_LINKS = (DESKTOP_MENU.find((menu) => menu.id === "help")?.items ?? []).flatMap((item) =>
  item.type === "item" && item.href && item.labelKey ? [{ labelKey: item.labelKey, href: item.href }] : [],
)
