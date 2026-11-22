/** @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import type { Context } from "@opencode/plugin/tui/context"
import path from "node:path"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { InlineToolRow } from "../src/routes/session"
import { PromptFooter } from "../src/feature-plugins/prompt/footer"
import { SidebarOnboarding } from "../src/feature-plugins/sidebar/footer"
import { icon, setIconMode, type ResolvedIconMode } from "../src/ui/design"

const profiles: ReadonlyArray<{ name: string; mode: ResolvedIconMode }> = [
  { name: "opencode", mode: "ascii" },
  { name: "fork+nerd", mode: "nerd" },
  { name: "fork+ascii", mode: "ascii" },
]

const color = RGBA.fromInts(200, 200, 200)
const muted = RGBA.fromInts(100, 100, 100)

function statusContext(): Context {
  return {
    location: { directory: "/workspace" },
    theme: { text: { base: color, muted } },
    keymap: { shortcuts: () => [], dispatch: () => {} },
    client: {
      rpc: () => ({
        get: () =>
          Promise.resolve({
            id: "goal",
            objective: "Ship the icon abstraction",
            status: "active",
            rounds: 1,
            maxRounds: 50,
            boot: "boot",
            updatedAt: 0,
          }),
        events: { on: () => () => {} },
      }),
    },
    data: {
      on: () => () => {},
      session: {
        family: () => ["session"],
        status: () => "idle",
        get: () => ({ id: "session", location: { directory: "/workspace" } }),
        cost: () => 0,
        message: { list: () => [] },
      },
      job: { list: () => [] },
      shell: { list: () => [{ metadata: { sessionID: "session" } }] },
      location: { model: { list: () => [] } },
    },
  } as unknown as Context
}

function sidebarContext(): Context {
  const [onboarding, update] = createStore({ dismissed: false })
  return {
    location: { directory: "/workspace" },
    theme: { background: { raised: { high: color } }, text: { base: color, muted } },
    storage: { store: () => [onboarding, () => Promise.resolve(update)] },
    keymap: { dispatch: () => {} },
    ui: { format: { path: (value: string) => value } },
    data: {
      session: { get: () => ({ location: { directory: "/workspace" } }) },
      location: { integration: { list: () => [] }, vcs: { info: () => undefined } },
    },
  } as unknown as Context
}

async function capture(render: () => JSX.Element, width: number, height: number) {
  const app = await testRender(render, { width, height })
  try {
    await Promise.resolve()
    await app.renderOnce()
    await app.renderOnce()
    return app.captureCharFrame().trimEnd()
  } finally {
    app.renderer.destroy()
  }
}

const sections: Array<{ zone: string; profile: string; frame: string }> = []
for (const profile of profiles) {
  setIconMode(profile.mode)
  sections.push({
    zone: "statusline",
    profile: profile.name,
    frame: await capture(
      () => <PromptFooter context={statusContext()} sessionID="session" mode="normal" showDetails={true} />,
      80,
      2,
    ),
  })
  sections.push({
    zone: "tool rows",
    profile: profile.name,
    frame: await capture(
      () => (
        <box flexDirection="column" width={72}>
          <InlineToolRow icon={icon("glob", profile.mode)} complete pending="Finding files…">
            Glob "**/*.ts" in packages/tui
          </InlineToolRow>
          <InlineToolRow icon={icon("read", profile.mode)} complete pending="Reading file…">
            Read packages/tui/src/ui/design.ts
          </InlineToolRow>
          <InlineToolRow
            icon={icon("cross", profile.mode)}
            complete
            pending="Running tests…"
            failed
            error="bun test exited with code 1"
          >
            Shell bun test
          </InlineToolRow>
        </box>
      ),
      72,
      5,
    ),
  })
  sections.push({
    zone: "sidebar",
    profile: profile.name,
    frame: await capture(
      () => (
        <box width={38}>
          <SidebarOnboarding context={sidebarContext()} sessionID="session" />
        </box>
      ),
      38,
      22,
    ),
  })
}
setIconMode("ascii")

const escape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")

const cards = sections
  .map(
    (section) => `<section class="card">
  <h2>${escape(section.zone)} <span>${escape(section.profile)}</span></h2>
  <pre class="${section.profile === "fork+nerd" ? "nerd" : ""}">${escape(section.frame)}</pre>
</section>`,
  )
  .join("\n")

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>opencode-fork icon snapshots</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 32px; background: #0e1116; color: #d7dde7; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
  p { color: #8b98aa; max-width: 900px; }
  main { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); }
  .card { border: 1px solid #26303d; border-radius: 10px; background: #131923; overflow: hidden; }
  h2 { font-size: 13px; font-weight: 600; margin: 0; padding: 10px 14px; background: #18202b; color: #c9d4e2; }
  h2 span { color: #7f8ea3; font-weight: 400; }
  pre { margin: 0; padding: 14px; overflow-x: auto; white-space: pre; color: #d7dde7; background: #0f141b; }
  pre.nerd { font-family: "JetBrainsMono Nerd Font", "Symbols Nerd Font", "CaskaydiaCove Nerd Font", ui-monospace, monospace; }
  .hint { border-left: 2px solid #3b82f6; padding-left: 12px; }
</style>
</head>
<body>
<h1>opencode-fork icon snapshots</h1>
<p>Frames captured with the same test renderer as the snapshot suite. The <strong>fork+nerd</strong> cards use private-use Nerd Font glyphs; open this file on a machine with a Nerd Font installed to compare them with the portable fallback.</p>
<p class="hint">Regenerate with <code>bun run snapshot:html</code>. ANSI output: <code>snapshot-icons.ansi</code>.</p>
<main>
${cards}
</main>
</body>
</html>`

const ansi = sections
  .map((section) => `\x1b[1m${section.zone} — ${section.profile}\x1b[0m\n${section.frame}\n`)
  .join("\n")

const out = path.resolve(import.meta.dir, "..")
await Bun.write(path.join(out, "snapshot-icons.html"), html)
await Bun.write(path.join(out, "snapshot-icons.ansi"), ansi)
console.log(`wrote ${path.join(out, "snapshot-icons.html")}`)
console.log(`wrote ${path.join(out, "snapshot-icons.ansi")}`)
