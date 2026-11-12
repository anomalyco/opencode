// Product copy shared by the carousel, the product pages and the Markdown versions of the pages.
// Product order rule: copy that lists the products names them as desktop, terminal, mobile, SDK.

import { docsUrl } from "~/lib/docs"
import { isMobile, requestPlatform } from "~/lib/platform"

/** Where the SDK's "Read docs" action leads: the @opencode/sdk docs (the in-process host). */
export const sdkDocs = docsUrl("/build/sdk/")

export { installs } from "~/lib/install-commands"

// The real v2 @opencode/sdk API (packages/sdk README, opencode.ai/docs/build/sdk), trimmed from
// the script in the SDK video. `sessions.create()` without a location uses the working directory.
// Lines stay within 32 characters so the card sizes code to its width.
export const sdkSnippet = [
  `<span data-k>import</span> <span data-p>{</span> <span data-v>OpenCode</span> <span data-p>}</span>`,
  `  <span data-k>from</span> <span data-s>"@opencode/sdk"</span>`,
  ``,
  `<span data-k>await using</span> <span data-v>oc</span> <span data-o>=</span>`,
  `  <span data-k>await</span> OpenCode<span data-p>.</span><span data-f>create</span><span data-p>()</span>`,
  `<span data-k>const</span> <span data-v>s</span> <span data-o>=</span>`,
  `  <span data-k>await</span> <span data-v>oc</span><span data-p>.</span>sessions<span data-p>.</span><span data-f>create</span><span data-p>()</span>`,
  `<span data-k>await</span> <span data-v>oc</span><span data-p>.</span>sessions<span data-p>.</span><span data-f>prompt</span><span data-p>({</span>`,
  `  sessionID<span data-p>:</span> <span data-v>s</span><span data-p>.</span>id<span data-p>,</span>`,
  `  text<span data-p>:</span> <span data-s>"Fix failing tests"</span><span data-p>,</span>`,
  `<span data-p>})</span>`,
].join("\n")

export type ProductSlug = "desktop" | "terminal" | "mobile" | "sdk"
/** The products after the carousel's four, with pages of their own and cards on /product. */
export type MoreSlug = "mini"
/** Every product with a page. */
export type PageSlug = ProductSlug | MoreSlug

/**
 * The products, in the order the carousel shows them. This is the site-wide product order: any copy
 * that lists the products names them as desktop, terminal, mobile, SDK.
 */
export const products = [
  {
    slug: "desktop",
    name: "Desktop",
    body: "Sessions, tabs, diffs, built-in browser, and extensions on macOS, Windows and Linux.",
    action: "Download",
  },
  {
    slug: "terminal",
    name: "Terminal",
    body: "A fast terminal UI that works in any shell, editor or remote server.",
    action: "Install",
  },
  {
    slug: "mobile",
    name: "Mobile",
    body: "Start, steer and approve sessions from your phone, wherever you are.",
    isNew: true,
    action: "Download",
  },
  {
    slug: "sdk",
    name: "SDK",
    body: "Drive OpenCode from your own scripts, CI jobs and tools.",
    action: "Read docs",
  },
] as const satisfies readonly {
  slug: ProductSlug
  name: string
  body: string
  action: string
  isNew?: boolean
}[]

/**
 * The products /product lists after the carousel's four, in this order. Copy follows each one's
 * README and docs: Mini is `opencode mini` (packages/tui/src/mini).
 */
export const moreProducts = [
  {
    slug: "mini",
    name: "Mini",
    body: "A minimal terminal interface. Replies print into your scrollback, with one prompt below.",
    action: "Install",
  },
] as const satisfies readonly {
  slug: MoreSlug
  name: string
  body: string
  action: string
  isNew?: boolean
}[]

/** Every product with a page, including Mini, which has a page (/mini) but is not listed. */
export const allProductPages = [...products, ...moreProducts]

/**
 * The products listed on /product, in the site's product order: its grid (the home carousel's four),
 * the arrow keys on product pages, the footer, search and llms.txt. Mini stays reachable by URL
 * only.
 */
export const productPages = allProductPages.filter((product) => product.slug !== "mini")

/**
 * Settings › Extensions card: OpenCode inside editors. The VS Code extension is sdks/vscode
 * (publisher sst-dev); Zed and other ACP clients run `opencode acp` (docs: /cli/acp).
 */
export const extensions = {
  name: "Extensions",
  body: "Use OpenCode inside VS Code, or in Zed and other editors through ACP.",
  action: "Install",
  href: "https://marketplace.visualstudio.com/items?itemName=sst-dev.opencode",
}

/**
 * The Android app's status, the one switch for every Android mention on the site. "coming-soon"
 * lists Android as "Coming soon" with no link (download buttons, menus and sheets, the Download
 * sections), leads every visitor with the iPhone app, keeps Android out of the structured data's
 * operating systems, says "coming soon to Android" in the copy and redirects /download/<channel>/android*
 * to /mobile. When the Android app ships, set this to "available" and put its Google Play URL in
 * `mobileStores` below.
 */
export const androidStatus = "coming-soon" as "coming-soon" | "available"
export const androidSoon = androidStatus === "coming-soon"

/**
 * Where to get the mobile apps. iPhone is a public TestFlight beta until the App Store listing ships
 * (David, 5 Nov 2026); swap the link and label for the App Store URL then. Android has no listing yet,
 * so it opens the Mobile page's Download section. `soon` lists a store as "Coming soon", with no link.
 */
export const mobileStores = [
  {
    platform: "iOS",
    label: "Apple TestFlight",
    device: "iPhone",
    href: "https://testflight.apple.com/join/M9eFEE1q",
    soon: false,
    /** A TestFlight beta: links open in a new tab and carry the TestFlight badge. */
    beta: true,
  },
  {
    platform: "Android",
    label: "Google Play",
    device: "Android",
    href: "/mobile#download",
    soon: androidSoon,
    beta: false,
  },
] as const

/**
 * The changelog areas (keys in `/changelog?area=`) for each product: its product page lists the
 * newest entries with notes there and links to the changelog with the same filter. Core notes (the
 * shared server and agent) are on the changelog for everyone and would fill every product's list.
 * Mobile has no area in the release notes yet, so its page says it is new. Mini has no
 * area, so its page leaves the changelog out.
 */
export const productAreas: Partial<Record<PageSlug, string[]>> = {
  desktop: ["desktop"],
  terminal: ["terminal"],
  mobile: ["mobile"],
  sdk: ["sdk"],
}

/**
 * The products in the order this visitor sees them: on a phone or tablet Mobile comes first and
 * Desktop second, so the app they can install leads; computers keep the default order. Reads the
 * request's platform (requestPlatform), so the server and the first render agree.
 */
export function deviceOrder<T extends { slug: string }>(items: readonly T[]): T[] {
  if (!isMobile(requestPlatform())) return [...items]
  return [...items.filter((item) => item.slug === "mobile"), ...items.filter((item) => item.slug !== "mobile")]
}
