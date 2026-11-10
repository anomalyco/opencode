// The product pages' own copy, apart from product-data.ts so the pages that only list the products
// (every page loads the nav and the carousel's data) don't download it.

import { androidSoon, type PageSlug } from "./product-data"

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
    description: "Start and steer OpenCode sessions from your phone. Talk to the agent while it runs on your computer.",
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
