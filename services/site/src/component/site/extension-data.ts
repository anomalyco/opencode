// Extensions: things you add to OpenCode, listed on /product under the products, each with a light
// page at /extensions/<slug>. Only real ones, with copy from their READMEs and source:
// - Browse: anomalyco/browse (an MCP server and a Chromium extension).
// - SSH and WSL: built-in desktop app extensions (anomalyco/opencode packages/gui-extensions).

// SSH and WSL are left out for now, like Isocast in links.ts: to bring them back, restore "ssh" |
// "wsl" here, uncomment their entries below and their pages in routes/extensions (now redirects).
export type ExtensionSlug = "browse"

type Extension = {
  slug: ExtensionSlug
  name: string
  /** One line for the /product list. */
  body: string
  /** The page's `<title>`, 50–60 characters. */
  title: string
  /** The meta and share description, 120–160 characters. */
  description: string
  intro: string
  features: { title: string; body: string }[]
  /** How to get it: a command to copy, or where to find it in the desktop app. */
  install: { lead: string; command?: string }
  source: string
  /** For the page's structured data; every OS when left out. */
  operatingSystem?: string
}

export const extensionPages: readonly Extension[] = [
  {
    slug: "browse",
    name: "Browse",
    body: "Let agents use your real browser.",
    title: "OpenCode | Browse, your real browser for coding agents",
    description:
      "Browse lets OpenCode and other MCP clients use your real browser. Agents drive background tabs with Playwright and hand logins and 2FA back to you.",
    intro:
      "An MCP server and a Chromium extension that let your agents use your real browser, with your tabs, your logins and your extensions. They open and drive tabs with Playwright, take screenshots and record the screen, in background tabs grouped out of your way. When it's your turn, for a login, a 2FA prompt or a payment, they hand the tab back to you and continue once you click Continue.",
    features: [
      { title: "Your real browser", body: "Chrome, Edge, Brave, Arc, Helium, Vivaldi, Opera and Chromium." },
      { title: "Out of your way", body: "Agent tabs open in the background, in collapsed groups." },
      { title: "Handoffs", body: "Do the login or 2FA step yourself, then click Continue." },
      { title: "Lend a tab", body: "Click the toolbar button to hand an agent a tab you have open." },
      { title: "Record and capture", body: "Screenshots, screen recordings and network traffic as a HAR." },
      { title: "Any MCP client", body: "OpenCode, Claude Code, Cursor, Codex, Zed and many more." },
      { title: "Named sessions", body: "Each session keeps its own tabs, across restarts." },
      { title: "Allowlists", body: "Limit a session's tabs to the sites you name." },
    ],
    install: {
      lead: "Run this once. It adds the browse MCP server to the agents you choose and pairs the extension from the Chrome Web Store. Needs Node.js 22.19 or newer.",
      command: "npx @opencode/browse install",
    },
    source: "https://github.com/anomalyco/browse",
  },
  // {
  //   slug: "ssh",
  //   name: "SSH",
  //   body: "Work on a server's projects over SSH.",
  //   title: "OpenCode | SSH to work on a remote machine from the desktop",
  //   description:
  //     "The SSH extension connects the OpenCode desktop app to a Linux or macOS machine over SSH. It sets up the remote server for you and keeps your sessions there.",
  //   intro:
  //     "Connect the desktop app to another machine over SSH and open its projects. Enter a host or an SSH command, and OpenCode installs its server on the remote machine for you. If the connection drops, reconnect and pick up where you were: your remote session is preserved.",
  //   features: [
  //     { title: "Host or command", body: "Enter user@example.com or the ssh command you already use." },
  //     { title: "Set up for you", body: "The remote server installs itself on first connect." },
  //     { title: "Linux and macOS", body: "Remote machines on x64 or arm64." },
  //     { title: "Reconnect", body: "Your remote session is preserved while you are away." },
  //     { title: "Trust first", body: "You confirm a new host before it connects." },
  //     { title: "Stays in step", body: "Updates the remote server to match your desktop app." },
  //     { title: "Remote projects", body: "Open a project folder on the remote machine." },
  //     { title: "Sign in as usual", body: "SSH authentication prompts appear in the app." },
  //   ],
  //   install: { lead: "Built into the desktop app. Open the server menu and choose Add SSH server." },
  //   source: "https://github.com/anomalyco/opencode/tree/v2/packages/gui-extensions/src/ssh",
  // },
  // {
  //   slug: "wsl",
  //   name: "WSL",
  //   body: "Run OpenCode in WSL 2 from Windows.",
  //   title: "OpenCode | WSL to use a Linux distro from the Windows desktop",
  //   description:
  //     "The WSL extension adds a WSL server to the OpenCode desktop app on Windows, so sessions run in your Linux distro. It installs and updates OpenCode there.",
  //   intro:
  //     "On Windows, add a WSL server to the desktop app and your sessions run inside a Linux distribution. The app lists your installed distros, installs or updates OpenCode in the one you choose, and tells you what is missing, such as WSL 2 or a restart to finish installing WSL.",
  //   features: [
  //     { title: "Your distro", body: "Pick from the WSL distros you have installed." },
  //     { title: "Installs OpenCode", body: "Installs or updates OpenCode inside the distro." },
  //     { title: "Checks setup", body: "Reports missing tools such as bash and curl." },
  //     { title: "WSL 2", body: "Works with WSL 2 distros." },
  //     { title: "Guided install", body: "Says when Windows needs a restart to finish." },
  //     { title: "Windows only", body: "Shows only in the Windows desktop app." },
  //     { title: "Retry and update", body: "Restart or update the WSL server from the server menu." },
  //     { title: "More distros", body: "Install another distribution from the WSL catalog." },
  //   ],
  //   install: { lead: "Built into the desktop app on Windows. Open the server menu and choose Add WSL server." },
  //   source: "https://github.com/anomalyco/opencode/tree/v2/packages/gui-extensions/src/wsl",
  // },
]
