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
export type MoreSlug = "ide" | "mini"
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
 * README and docs: IDE extensions is the VS Code extension (sdks/vscode, publisher sst-dev; docs
 * /docs/ide) plus `opencode acp` for ACP editors (docs /cli/acp), and Mini is `opencode mini`
 * (packages/tui/src/mini).
 */
export const moreProducts = [
  {
    slug: "ide",
    name: "IDE extensions",
    body: "Open OpenCode in VS Code, Cursor and Windsurf, or in Zed and JetBrains IDEs through ACP.",
    action: "Install",
  },
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

/** Every product with a page, including IDE extensions and Mini, which have pages (/ide, /mini) but aren't listed. */
export const allProductPages = [...products, ...moreProducts]

/**
 * The products listed on /product, in the site's product order: its grid (the home carousel's four),
 * the arrow keys on product pages, the footer, search and llms.txt. IDE extensions and Mini stay
 * reachable by URL only.
 */
export const productPages = allProductPages.filter((product) => product.slug !== "ide" && product.slug !== "mini")

/** The ACP docs: Zed, JetBrains IDEs and other ACP editors run `opencode acp`. */
export const acpDocs = docsUrl("/cli/acp/")

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
 * The product page below the intro: the showcase clips (the fourth only with Settings › Feature
 * clips count "4"), then short feature points (none on Desktop and Mobile).
 */
export const productDetails: Record<
  PageSlug,
  {
    /** The page's `<title>`, 50–60 characters. */
    title: string
    /** The meta and share description, 120–160 characters. */
    description: string
    /** For the page's structured data. */
    operatingSystem: string
    // The longer description under the product page title; the carousel card keeps the short one.
    intro: string
    features: { title: string; body: string }[]
    showcase: { title: string; body: string; clip?: string }[]
    /** False shows the showcase as text, its clips neither shown nor loaded. */
    showcaseMedia?: false
  }
> = {
  desktop: {
    title: "OpenCode | Desktop app for macOS, Windows and Linux",
    description:
      "Run as many OpenCode agents as you want in parallel, see every change in a browser beside them and pick them up on any device. For macOS, Windows and Linux.",
    operatingSystem: "macOS, Windows, Linux",
    intro:
      "Run several agents at once, each session in its own tab. Review every change as a diff, comment on any line, and check the result in the built-in browser. For macOS, Windows and Linux.",
    // The page shows only its four key features (6 Nov 2026), with no feature points below them.
    features: [],
    showcase: [
      {
        title: "Parallel agents",
        clip: "/product-videos/features/desktop-1",
        body: "Start as many agents as you want and let them all work in parallel. Jump between them as they finish.",
      },
      {
        title: "See it in the browser",
        clip: "/product-videos/features/desktop-3",
        body: "Your app opens in a browser beside the agent, so you both see every change land.",
      },
      {
        title: "On every device",
        clip: "/product-videos/features/desktop-4",
        body: "Start agents across all your devices, and pick them up from the desktop app, the terminal or your phone.",
      },
      // No footage yet: the row shows a placeholder until its clip lands.
      {
        title: "Extend it",
        body: "Connect your tools and services so the agent can work with anything. Or have OpenCode build plugins for itself, with their own UI in the sidebar.",
      },
    ],
  },
  terminal: {
    title: "OpenCode | Terminal UI for the open source coding agent",
    description:
      "A fast terminal UI for OpenCode that works in any shell, editor or remote server. Describe what you want, see each edit as a diff and approve commands.",
    operatingSystem: "macOS, Linux, Windows",
    intro:
      "A fast terminal UI that works in any shell, editor or remote server. Describe what you want in plain words, watch each edit land as a diff, and choose which commands run on their own.",
    features: [
      { title: "Any terminal", body: "Works in any shell, in your editor's terminal or on a remote server." },
      { title: "Diffs in the timeline", body: "See each edit as a diff in the timeline, as the agent makes it." },
      { title: "Pick up later", body: "Continue the last session with -c, or any with -s." },
      { title: "One-off runs", body: "opencode run sends one message and prints the reply." },
      { title: "Agents and commands", body: "Switch agents with shift+tab and open every command with ctrl+p." },
      { title: "Auto-approve", body: "Run with --auto to allow every action you haven't denied." },
      { title: "Any server", body: "Connect to an OpenCode server by URL with --server." },
      { title: "Usage stats", body: "opencode stats shows shareable usage statistics." },
    ],
    showcase: [
      {
        title: "Ask in plain words",
        clip: "/product-videos/features/terminal-1",
        body: "Type what you want, and the agent shows its plan as it works.",
      },
      {
        title: "Approve what runs",
        clip: "/product-videos/features/terminal-2",
        body: "Edits show as diffs, and commands wait for your permission.",
      },
      {
        title: "Make it yours",
        clip: "/product-videos/features/terminal-3",
        body: "Switch themes in a keystroke, from the default to tokyonight and more.",
      },
      {
        title: "Mini",
        clip: "/product-videos/features/terminal-4",
        body: "Run opencode mini and replies print into your own scrollback.",
      },
    ],
  },
  mobile: {
    title: "OpenCode | Mobile, your coding sessions on your phone",
    description:
      "Start and steer OpenCode sessions from your phone. Talk to the agent while it runs on your computer.",
    // Android joins when it is available (androidStatus).
    operatingSystem: androidSoon ? "iOS" : "iOS, Android",
    intro:
      "Start and steer sessions from your phone, wherever you are. Call a session and talk to the agent, or open any session to pick up where you left off, all on OpenCode running on your own computer.",
    // The page shows only its four clips for now (5 Nov 2026). The grid's points, checked against
    // the iOS app's What's New entries (anomalyco/opencode-ios), are kept here to bring back:
    // "Every computer" takes two taps (the drawer title, then the server), and muting leaves
    // notifications on (it skips Catch Up, the unread dot and the badge), so both need new copy.
    // { title: "Notify when done", body: "Get a short summary when a session you started finishes." },
    // { title: "Pair from anywhere", body: "Connect from any network with opencode pair --remote." },
    // { title: "Every computer", body: "Switch between the computers you've paired in one tap." },
    // { title: "Siri and Shortcuts", body: "Start a call or a session from Siri or Control Center." },
    // { title: "Follow along", body: "Watch the timeline update as the agent works." },
    // { title: "Your computer", body: "Connects to OpenCode running on your own machine." },
    // { title: "Share sheet", body: "Share anything to a session without opening the app." },
    // { title: "Mute sessions", body: "Keep a session in your list without getting its notifications." },
    features: [],
    showcase: [
      {
        title: "Voice",
        clip: "/product-videos/features/mobile-1",
        body: "Call a session and say what you need. The agent answers out loud.",
      },
      {
        title: "Sessions",
        clip: "/product-videos/features/mobile-3",
        body: "Open any session to see where it is, then pick up where you left off.",
      },
      // Steer is true (Steer While It Works, 11 Oct 2026) but has no footage yet; it returns here
      // with a capture of a follow-up sent mid-run.
      // {
      //   title: "Steer",
      //   body: "Send a follow-up to change direction mid-session.",
      // },
      {
        title: "Results",
        clip: "/product-videos/features/mobile-4",
        body: "The call tells you what changed once the work you asked for is done.",
      },
    ],
  },
  sdk: {
    title: "OpenCode | TypeScript SDK for scripts, CI jobs and tools",
    description:
      "Drive OpenCode from your own scripts, CI jobs and tools. The typed TypeScript client creates sessions, sends prompts and streams every event as it happens.",
    operatingSystem: "macOS, Linux, Windows",
    intro:
      "Drive OpenCode from your own scripts, CI jobs and tools. The SDK runs OpenCode inside your process, with your config and models, and its typed client creates sessions, sends prompts and streams every event.",
    features: [
      { title: "TypeScript client", body: "Typed requests and events, the same values as @opencode/client." },
      { title: "Sessions from code", body: "Create sessions and send prompts from any script." },
      { title: "Any model", body: "Uses whichever models your OpenCode setup has." },
      { title: "npm or bun", body: "Install it with npm i @opencode/sdk or bun add @opencode/sdk." },
      { title: "In-process host", body: "Runs OpenCode in memory, with no network hop." },
      { title: "Your plugins", body: "Pass your own plugins in when you create the in-process host." },
      { title: "Promise or Effect", body: "A Promise API and an Effect API with the same values." },
      { title: "Cloudflare Workers", body: "Run OpenCode inside a Cloudflare Durable Object on Workers." },
    ],
    // Text only: the four points without their clips, so the page loads no video for them.
    showcaseMedia: false,
    showcase: [
      {
        title: "Fix CI from code",
        clip: "/product-videos/features/sdk-1",
        body: "A short script asks OpenCode to fix failing tests, then runs them again.",
      },
      {
        title: "Follow every step",
        clip: "/product-videos/features/sdk-2",
        body: "Stream events to see each tool the agent calls, as it happens.",
      },
      {
        title: "Build your own tools",
        clip: "/product-videos/features/sdk-3",
        body: "Wire OpenCode into bots, dashboards and workflows with a few lines.",
      },
      {
        title: "In your process",
        clip: "/product-videos/features/sdk-4",
        body: "Runs OpenCode inside your process, with your config and models.",
      },
    ],
  },
  ide: {
    title: "OpenCode | Editor integrations for VS Code, Cursor and Zed",
    description:
      "Use OpenCode inside your editor, with the extension for VS Code, Cursor, Windsurf and VSCodium, and opencode acp for Zed, JetBrains IDEs and other ACP editors.",
    operatingSystem: "macOS, Windows, Linux",
    intro:
      "Use OpenCode inside your editor. In VS Code, Cursor, Windsurf and VSCodium, run opencode in the integrated terminal and the extension installs itself. Zed, JetBrains IDEs and other editors that support the Agent Client Protocol run OpenCode with opencode acp.",
    features: [
      { title: "Quick launch", body: "Cmd+Esc or Ctrl+Esc opens OpenCode in a split terminal." },
      { title: "New session", body: "Cmd+Shift+Esc or Ctrl+Shift+Esc starts another session." },
      { title: "Context", body: "Shares your current selection or tab with OpenCode." },
      { title: "File references", body: "Cmd+Option+K or Alt+Ctrl+K inserts @File#L37-42." },
      { title: "Installs itself", body: "Run opencode in the integrated terminal to add it." },
      { title: "ACP editors", body: "Zed, JetBrains IDEs, Avante.nvim and CodeCompanion.nvim." },
      { title: "Open VSX", body: "Also on Open VSX for Cursor, Windsurf and VSCodium." },
      { title: "Same agent", body: "The OpenCode you run in the terminal, beside your code." },
    ],
    showcase: [],
  },
  mini: {
    title: "OpenCode | Mini, a minimal terminal interface for the agent",
    description:
      "Mini runs OpenCode in a minimal terminal interface. Replies print into your terminal's own scrollback, and only a prompt and a status line stay below.",
    operatingSystem: "macOS, Linux, Windows",
    intro:
      "A minimal terminal interface for OpenCode. Run opencode mini and replies print straight into your terminal's own scrollback, so you scroll, search and copy them like any other output. Only the prompt and a status line stay at the bottom.",
    features: [
      { title: "Your scrollback", body: "Replies become ordinary terminal history." },
      { title: "One prompt", body: "Agent, model, context and cost on one status line." },
      { title: "Permissions", body: "Allow edits and commands from the prompt area." },
      { title: "How much shows", body: "Quiet, default or everything, for thinking and tool output." },
      { title: "Pick up later", body: "Continue the last session with -c, or any with -s." },
      { title: "Same OpenCode", body: "The same server, agents and models as the other apps." },
      { title: "Agents", body: "Switch agents right from the prompt." },
      { title: "Compact", body: "Shrink a long session with /compact." },
    ],
    showcase: [],
  },
}

/**
 * The changelog areas (keys in `/changelog?area=`) for each product: its product page lists the
 * newest entries with notes there and links to the changelog with the same filter. Core notes (the
 * shared server and agent) are on the changelog for everyone and would fill every product's list.
 * Mobile has no area in the release notes yet, so its page says it is new. IDE extensions and Mini
 * have no areas, so their pages leave the changelog out.
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
