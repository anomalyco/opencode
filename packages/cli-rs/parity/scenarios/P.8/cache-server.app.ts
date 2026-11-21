// js-npm: `opencode-sidebar-prompt@0.1.6` as the TUI part of a server plugin: the server lists it (`/api/plugin`, active,
// with a TUI feature) by its package spec, and both clients resolve that in the npm cache (`cache`) without installing
// (`context.tsx:301-305`, `Npm.resolve`), then load its TUI entry, the same files as sidebar-prompt. `cli.json` names
// no plugin. The Rust replay's global opencode config names the spec, as Rust loads a server part with no approval only
// then (O-162).
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_l"
const prompt =
  "Write the release notes for 2.3: the new sidebar, the plugin host, and the fixes to the theme picker. Keep each " +
  "line short, link every pull request, and leave the upgrade steps for last."

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  cache: { "opencode-sidebar-prompt@0.1.6": "opencode-sidebar-prompt" },
  args: { sessionID: id },
  routes: [
    {
      path: "/api/plugin",
      json: {
        location: {
          directory: "/tmp/opencode/packages/tui",
          project: { id: "proj_test", directory: "/tmp/opencode", canonical: "/tmp/opencode" },
        },
        data: [
          {
            id: "sidebar-prompt",
            source: { type: "package", target: "opencode-sidebar-prompt@0.1.6" },
            features: { server: true, tui: true },
            state: { status: "active" },
          },
        ],
      },
    },
    { path: `/api/session/${id}`, json: { data: session(id, "Release notes", { updated: 2 }) } },
    { path: "/api/session", json: { data: [session(id, "Release notes", { updated: 2 })], cursor: {} } },
    {
      path: `/api/session/${id}/message`,
      json: { data: [assistant("msg_2", "Drafted.", 2000), user("msg_1", prompt, 1000)], cursor: {} },
    },
    { path: `/api/session/${id}/inbox`, json: { data: [] } },
  ],
  steps: [
    { checkpoint: "sidebar", until: "Open full prompt" },
    { type: "/lastprompt" },
    // The completion lists the plugin's command before Enter: the plugin loads after the home screen settles, and an
    // Enter on a list that has not matched its command yet does nothing (file-browser-flake).
    { checkpoint: "slash", until: "Show full last prompt" },
    { keys: ["enter"] },
    { checkpoint: "dialog", until: "Esc · Close" },
  ],
})
