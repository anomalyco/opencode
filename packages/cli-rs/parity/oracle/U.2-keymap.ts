// P-ORACLE for crates/ui/src/keymap: key sequences to commands through the TypeScript TUI's keymap, for every
// default binding and an override corpus. The harness needs OpenTUI's Solid preload, which resolves from
// packages/tui, so it runs from there. Writes parity/fixtures/U.2/keymap.json.
const tui = new URL("../../../tui", import.meta.url).pathname
const harness = new URL("./U.2-keymap/harness.ts", import.meta.url).pathname
const proc = Bun.spawnSync(["bun", "run", "--preload", "@opentui/solid/preload", harness], {
  cwd: tui,
  stdout: "inherit",
  stderr: "inherit",
})
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)
