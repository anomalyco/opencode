// P8: `opencode-sidebar-prompt@0.1.6`, unmodified from npm: the session's last prompt in the sidebar, and its
// `/lastprompt`, which shows the whole prompt in a dialog of its own (`ui.dialog.show`, large and centered) with a
// header, a scroll and a hint. TS loads the package from node_modules; the Rust client runs the same files on the JS
// host through the V2 compatibility layer, the dialog as the body of the host's dialog (contract ergonomics 2.7). The
// prompt is longer than the dialog: its focused scroll box scrolls on the arrows, as TS's does.
import { assistant, defineApp, session, user } from "../../lib/app"

const id = "ses_l"
const prompt = [
  "Write the release notes for 2.3: the new sidebar, the plugin host, and the fixes to the theme picker. Keep each " +
    "line short, link every pull request, and leave the upgrade steps for last.",
  ...Array.from({ length: 40 }, (_, index) => `Step ${index + 1}: check the notes of change ${index + 1} by hand.`),
  "Last line of the prompt.",
].join("\n")

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-sidebar-prompt"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  args: { sessionID: id },
  routes: [
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
    // FT-4: the dialog stays once the plugin's registrations settled; a reload of them closed it in Rust.
    { wait: 800 },
    { checkpoint: "kept", until: "Esc · Close" },
    // The long prompt scrolls: three rows down, then one up.
    { keys: ["down", "down", "down"] },
    { checkpoint: "scrolled", until: "Step 36: check the notes" },
    { keys: ["up"] },
    { checkpoint: "back", until: "Step 8: check the notes" },
    { keys: ["escape"] },
    { checkpoint: "closed", until: "Open full prompt" },
  ],
})
