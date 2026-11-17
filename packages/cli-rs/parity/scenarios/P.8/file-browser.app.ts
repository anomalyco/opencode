// CT-11: `opencode-file-browser@1.0.4`, unmodified from npm: `/files` on the home screen opens its browser route over
// `client.file.list`. Its keys are commands of layers it registers in setup, each enabled while its search field is not
// focused; once `/` focused the field, the field hears its text by `onInput` (the search) and its arrows by
// `onKeyDown`, which the layer did not map, so the search never ran. Since contract 2.x step B the field also takes the
// host's focus, so what the user types after `ctrl+f` is its text. TS loads the package from node_modules; the Rust
// client runs the same files on the JS host through the V2 compatibility layer.
import { defineApp } from "../../lib/app"

const location = { directory: "/tmp/opencode/packages/tui" }
const entries = [
  { path: "src", type: "directory" },
  { path: "test", type: "directory" },
  { path: "README.md", type: "file" },
  { path: "package.json", type: "file" },
  { path: "tsconfig.json", type: "file" },
]
// TS's `<scrollbox>` draws its scrollbar beside the list (28 cells) and its field's placeholder in OpenTUI's color (12),
// where the contract's scroll and field draw the host's.
const deviation = [{ file: "F16-v2-compat-layer", cells: 40 }]

export default defineApp({
  width: 140,
  height: 34,
  config: {
    experimental: { "new-designs": true },
    plugins: ["./out/npm/node_modules/opencode-file-browser"],
  },
  env: { OPENCODE_PARITY_PLUGIN: "npm" },
  routes: [
    { path: "/api/fs/list", json: { location, data: entries } },
    {
      path: "/api/fs/find",
      json: { location, data: [{ path: "src/package.ts", type: "file" }, { path: "package.json", type: "file" }] },
    },
  ],
  steps: [
    {
      checkpoint: "home",
      until: "ctrl+p commands",
      masks: [{ x: 36, y: 18, width: 70, height: 1, reason: "the placeholder example: random in TS and Rust" }],
    },
    { type: "/files" },
    // The completion lists the plugin's command before Enter: the plugin loads after the home screen settles, and an
    // Enter on a list that has not matched its command yet does nothing (file-browser-flake).
    {
      checkpoint: "slash",
      until: "Browse, preview, edit",
      // TS's list also shows the plugin's slash aliases (`/update-files`), which widen its name column; the contract's
      // command has one slash name, so the host lists the names alone.
      deviation: [{ file: "F16-v2-compat-layer", cells: 249 }],
    },
    { keys: ["enter"] },
    { checkpoint: "browser", until: "tsconfig.json", deviation },
    { keys: ["down"] },
    { keys: ["j"] },
    { checkpoint: "moved", deviation },
    // Its search field takes the plugin's focus, which disables its commands; its `onKeyDown` moves the selection.
    { keys: ["ctrl+f"] },
    { keys: ["down"] },
    { checkpoint: "searching", deviation },
    // The field has the host's focus too (contract 2.x, `focus-input`): what the user types is its text, and its search.
    { type: "src" },
    { checkpoint: "typed", until: "2 matches", deviation },
  ],
})
