import { installs, sdkInstalls } from "./install-commands"
import { forHumansRows } from "./source-logo-nav"

// The comment at the top of every page's source: the wordmark with a drop shadow (▓ open, █ code,
// ░ shadow), then pointers for people and agents, each section's rows on a ├── / └── tree under its
// title. Concept 1 "Manifest", option 13, list style 2, from
// /Users/davidhill/.local/share/opencode/worktree/012780/source-concepts. It must not contain "--".
// The build line under the tagline, from src/lib/build-stamp.json (script/build-stamp.ts, run by the
// build and dev scripts). A glob, so a checkout that never ran the script still renders. FOR HUMANS
// starts with the main nav, from the nav data (source-logo-nav.ts), so it follows the header.
const forHumans = forHumansRows()

// INSTALL lists the site's install commands and the SDK's. Bun's needs --trust, which an HTML
// comment can't hold, so it is left out here.
const installRows = [
  ...installs.filter((item) => !item.command.includes("--")),
  { name: "SDK", command: sdkInstalls[0].command },
]
  .map((item, index, rows) => `  ${index === rows.length - 1 ? "└──" : "├──"} ${item.name.padEnd(15)}${item.command}`)
  .join("\n")

const stamp = Object.values(
  import.meta.glob<{ default: { version: string; commit: string; date: string } }>("./build-stamp.json", {
    eager: true,
  }),
)[0]?.default
const buildStamp = stamp
  ? `v${stamp.version} · ${stamp.commit} · ${stamp.date === "dev" ? "dev" : `built ${stamp.date}`}`
  : "dev"

export const sourceLogo = `<!--

                                                                    ██
  ▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓    ████████  ████████  ████████░░████████
  ▓▓░░░░▓▓░░▓▓░░░░▓▓░░▓▓░░░░▓▓░░▓▓░░░░▓▓  ██░░░░░░░░██░░░░██░░██░░░░██░░██░░░░██░░
  ▓▓░░  ▓▓░░▓▓░░  ▓▓░░▓▓▓▓▓▓▓▓░░▓▓░░  ▓▓░░██░░      ██░░  ██░░██░░  ██░░████████░░
  ▓▓░░  ▓▓░░▓▓░░  ▓▓░░▓▓░░░░░░░░▓▓░░  ▓▓░░██░░      ██░░  ██░░██░░  ██░░██░░░░░░░░
  ▓▓▓▓▓▓▓▓░░▓▓▓▓▓▓▓▓░░▓▓▓▓▓▓▓▓  ▓▓░░  ▓▓░░████████  ████████░░████████░░████████
    ░░░░░░░░▓▓░░░░░░░░  ░░░░░░░░  ░░    ░░  ░░░░░░░░  ░░░░░░░░  ░░░░░░░░  ░░░░░░░░
              ░░

  The open source coding agent
  A product of Anomaly
  ${buildStamp}

  FOR HUMANS
${forHumans}

  FOR AGENTS
  ├── Index          /llms.txt
  ├── Full text      /llms-full.txt
  ├── Markdown       add .md to any page, or send Accept: text/markdown
  ├── Sitemap        /sitemap.xml
  ├── Releases       /changelog.xml (RSS), /changelog.json (JSON)
  └── Server API     /openapi.json

  INSTALL
${installRows}

  DEVTOOLS
  ├── Open           Cmd+Opt+J or Ctrl+Shift+J in Chrome
  ├── Run            opencode.help() in the DevTools console
  └── Try            opencode.try() for OpenCode Lite, nothing to install

  BUGS
  ├── Report         github.com/anomalyco/opencode/issues/new
  ├── Include        what you saw, the steps, your OS and terminal
  ├── Version        opencode -v
  ├── Logs           opencode debug paths log
  └── Security       /.well-known/security.txt for vulnerabilities

-->`
