import { config } from "~/config"
import { deviceOrder, productPages } from "./product-data"
import { docsUrl } from "~/lib/docs"
import type { Translate } from "~/i18n"

/** The sidebar and footer links, shared by the layout and the Markdown versions of the pages. */
export function siteLinks(t: Translate, route: (path: string) => string) {
  return {
    // Every item the primary nav can show, in the default order (settings.ts navDefaults says which
    // show by default). Design mode reorders, hides and renames them (settings navConfig); the links
    // stay fixed. Items that leave the site carry the arrow.
    nav: [
      // Demo: points at the docs mock in this branch instead of the live docs site.
      { id: "docs", label: t("nav.docs"), href: route(docsUrl()), arrow: true },
      { id: "products", label: t("site.nav.product"), href: route("/product") },
      // Settings › Product nav demo sends Data and Console to their header demos instead.
      { id: "data", label: t("nav.data"), href: route("/data"), demo: route("/data-demo"), arrow: true },
      // Anomaly's commercial products: the Console, its models list, its subscriptions page (OpenCode
      // Go, which the home page's subscriptions section links) and its enterprise page ("Talk to our
      // team"). Settings › Nav groups moves them under an "Anomaly" label.
      {
        id: "console",
        label: t("site.nav.console"),
        href: "/console",
        demo: route("/console-demo"),
        arrow: true,
        company: true,
      },
      { id: "models", label: t("site.nav.models"), href: "/console/models", arrow: true, company: true },
      { id: "subscriptions", label: t("site.nav.subscriptions"), href: "/console/go", arrow: true, company: true },
      { id: "enterprise", label: t("nav.enterprise"), href: "/console/enterprise", arrow: true, company: true },
      { id: "changelog", label: t("footer.changelog"), href: route("/changelog") },
      // Also the GitHub mark in the top-right corner (site.tsx).
      { id: "github", label: t("nav.github"), href: config.github.repoUrl, external: true, arrow: true },
    ],
    // The GitHub mark in the top-right corner (site.tsx), outside the numbered nav.
    github: { label: t("nav.github"), href: config.github.repoUrl },
    secondary: [
      // Settings › Footer links: "community" (default) drops X and names Discord "Community".
      { label: t("footer.x"), href: config.social.twitter, external: true, social: true },
      { label: t("footer.discord"), href: route("/discord"), community: t("site.footer.community") },
      { label: t("footer.changelog"), href: route("/changelog") },
      { label: t("site.footer.press"), href: route("/press") },
      { label: t("legal.brand"), href: route("/brand") },
      { label: t("site.footer.legal"), href: route("/legal") },
    ],
    status: { label: t("site.footer.status"), href: "https://status.opencode.ai" },
    // Settings › Footer › columns: the open source project first, Anomaly's products last.
    columns: [
      {
        title: t("site.nav.product"),
        links: deviceOrder(productPages).map((product) => ({ label: product.name, href: route(`/${product.slug}`) })),
      },
      {
        title: t("site.footer.resources"),
        links: [
          { label: t("nav.docs"), href: route(docsUrl()) },
          { label: t("footer.changelog"), href: route("/changelog") },
          { label: t("nav.data"), href: route("/data") },
          { label: t("nav.free"), href: route("/product") },
          { label: t("site.footer.press"), href: route("/press") },
          { label: t("legal.brand"), href: route("/brand") },
        ],
      },
      {
        title: t("site.footer.community"),
        links: [
          { label: t("nav.github"), href: config.github.repoUrl, external: true },
          { label: t("site.footer.releases"), href: `${config.github.repoUrl}/releases`, external: true },
          {
            label: t("site.footer.contributing"),
            href: `${config.github.repoUrl}/blob/dev/CONTRIBUTING.md`,
            external: true,
          },
          { label: t("site.footer.security"), href: `${config.github.repoUrl}/blob/dev/SECURITY.md`, external: true },
          // Settings › Footer links applies here too, as in the list footer.
          { label: t("footer.discord"), href: route("/discord"), community: t("site.footer.community") },
          { label: t("footer.x"), href: config.social.twitter, external: true, social: true },
        ],
      },
      {
        title: t("site.footer.moreOpenSource"),
        links: anomalyApps.map((app) => ({ label: app.name, href: app.href, external: true })),
      },
      {
        title: "Anomaly",
        links: [
          { label: t("site.nav.console"), href: "/console" },
          { label: "OpenCode Models", href: "/console/models" },
          { label: t("site.nav.subscriptions"), href: "/console/go" },
          { label: t("nav.enterprise"), href: "/console/enterprise" },
          { label: t("legal.privacy"), href: route("/legal/privacy-policy") },
          { label: t("legal.terms"), href: route("/legal/terms-of-service") },
        ],
      },
    ],
  }
}

// Anomaly's shipped open source apps, as listed in Abattoir (content/projects/*.md with
// `stage: shipped` and a public repo). A category line sits under each name, like an app store.
// The description and icon (public/apps) are for /product.
export const anomalyApps = [
  {
    id: "hex",
    name: "Hex",
    category: "Voice dictation",
    body: "On-device voice dictation for any app.",
    icon: "/apps/hex.png",
    href: "https://anoma.ly/hex",
  },
  // Isocast is left out for now; to bring it back everywhere (More from Anomaly, the footer and the
  // Markdown pages), uncomment it:
  // {
  //   id: "isocast",
  //   name: "Isocast",
  //   category: "Screen recording",
  //   body: "An OBS alternative for Mac that records each source to its own file.",
  //   icon: "/apps/isocast.png",
  //   href: "https://isocast.xyz",
  // },
  {
    id: "opentunnel",
    name: "OpenTunnel",
    category: "Local tunnels",
    body: "Public HTTPS URLs for local apps.",
    icon: "/apps/opentunnel.png",
    href: "https://opentunnel.xyz",
  },
] as const

/**
 * "More from Anomaly" on /product: the apps above, then OpenTUI from the press kit
 * (lib/press-content.ts), which has no app icon (the list draws its logo mark).
 */
export const anomalyProducts = [
  ...anomalyApps,
  {
    id: "opentui",
    name: "OpenTUI",
    category: "Library",
    body: "A library for terminal user interfaces.",
    href: "https://opentui.com",
  },
] as const
