import type { Key } from "~/i18n"

/**
 * The strings the script shows, in the page's language: the server writes them on the site root
 * (`data-strings`, component/site/site.tsx), so the script loads no translations.
 */
export const clientStrings = [
  "site.theme.cycle",
  "site.theme.system",
  "site.theme.light",
  "site.theme.dark",
  "nav.openMenu",
  "site.closeMenu",
  "site.view.person",
  "site.view.markdown",
  "site.status.prefix",
  "site.status.operational",
  "site.footer.status",
  "site.status.operationalHeadline",
  "site.status.degradedHeadline",
  "site.status.outageHeadline",
  "site.status.unknownHeadline",
  "changelog.share.copied",
  "site.action.copied",
  "site.action.copiedCommand",
  "site.action.copiedThisCommand",
  "site.action.copy",
  "site.download.thisComputer",
] as const satisfies readonly Key[]
