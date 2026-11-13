import { expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"

const definitions = TuiKeybind.Definitions

// The `keybinds` config schema is generated from TuiKeybind.Definitions, so every declared id is
// user-configurable — but only a Keymap.createLayer call with the same id makes pressing it do
// anything. The two sets live in different files and drift silently (#57335): a declared id with
// no registered command is configurable yet inert, and a registered id missing from Definitions
// cannot be rebound or dispatched by id. This guard walks the TUI source and requires each
// declared id to be referenced there or allowlisted below with a reason.
//
// A reference is a whole-id match: the id must be delimited by a character outside
// [a-z0-9_.-] or by a line boundary, so composer.subagent.up never matches composer.subagent.upstream.
// Ids registered via template literals (session.tab.select.*, app.storybook.*) are also referenced
// literally, so the static match does not miss them.
//
// Entries whose reason starts with "Deprecated" are additionally required to be inert
// (default "none" or a Deprecated description), so the allowlist cannot absorb a live command.
const allowlist: Partial<Record<keyof typeof definitions, string>> = {
  // Removed commands whose ids stay in Definitions so shipped cli.json keybinds still parse.
  "diff.toggle": "Deprecated: file tree is mouse-controlled",
  "diff.expand": "Deprecated: file tree is mouse-controlled",
  "diff.expand_all": "Deprecated: file tree is mouse-controlled",
  "diff.collapse": "Deprecated: file tree is mouse-controlled",
  "diff.switch_focus": "Deprecated: keyboard navigation always controls the diff",
  "session.share": "Deprecated: session sharing was removed",
  "session.unshare": "Deprecated: session sharing was removed",

  // Dead commands: declared and configurable, but no command is registered with the id, so the
  // default chord does nothing (#57335).
  "which-key.toggle": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.layout.toggle": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.pending.toggle": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.group.previous": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.group.next": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.scroll.up": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.scroll.down": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.page.up": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.page.down": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.home": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "which-key.end": "Dead command: the which-key panel has no registered commands (#51694, #57335)",
  "session.child.next": "Dead command: no keymap command is registered with this id (#56153, #57335)",
  "session.child.previous": "Dead command: no keymap command is registered with this id (#56153, #57335)",

  // Unverified: referenced nowhere in packages/tui/src outside the keybind config, but nobody has
  // decided yet whether these are deprecated, unimplemented, or missing registrations (#57335).
  "app.scrap": "Unverified: needs a decision (#57335)",
  "session.tab.history.back": "Unverified: needs a decision (#57335)",
  "session.tab.history.forward": "Unverified: needs a decision; ships a real default ctrl+i (#57335)",
}

const contents = await Promise.all(
  (await Array.fromAsync(new Bun.Glob("src/**/*.{ts,tsx}").scan({ cwd: `${import.meta.dir}/..`, onlyFiles: true })))
    .filter((file) => file !== "src/config/keybind.ts" && file !== "src/config/v1/keybind.ts")
    .map((file) => Bun.file(`${import.meta.dir}/../${file}`).text()),
)
// Joined with newlines so every file's start and end act as line boundaries for the id match.
const haystack = contents.join("\n")

const isReferenced = (id: string) =>
  new RegExp(`(?<![a-z0-9_.-])${id.replaceAll(".", "\\.")}(?![a-z0-9_.-])`).test(haystack)

test("every declared keybind id is referenced by a registered command or allowlisted", () => {
  const unregistered = Object.keys(definitions).filter((id) => !(id in allowlist) && !isReferenced(id))
  expect(
    unregistered,
    `declared keybinds with no registered command and no allowlist entry: ${unregistered.join(", ")}\n` +
      "register a keymap command with this id, or add an allowlist entry in test/keybind-coverage.test.ts explaining why it is intentionally unregistered",
  ).toEqual([])
})

test("allowlist only contains declared ids that are not referenced", () => {
  const unknown = Object.keys(allowlist).filter((id) => !(id in definitions))
  expect(
    unknown,
    `allowlist ids not declared in Definitions: ${unknown.join(", ")}\nfix the id or remove the entry`,
  ).toEqual([])

  const stale = Object.keys(allowlist).filter((id) => isReferenced(id))
  expect(
    stale,
    `allowlisted ids now referenced in src: ${stale.join(", ")}\nremove the allowlist entry, the command is registered`,
  ).toEqual([])
})

test("allowlist entries marked Deprecated are genuinely inert", () => {
  const live = Object.entries(allowlist)
    .filter((entry): entry is [keyof typeof definitions, string] => entry[1]?.startsWith("Deprecated") === true)
    .filter(([id]) => definitions[id].default !== "none" && !definitions[id].description.startsWith("Deprecated"))
    .map(([id]) => id)
  expect(
    live,
    `allowlist entries marked Deprecated but bound to a live command: ${live.join(", ")}\n` +
      "either register the command or mark the definition itself as deprecated",
  ).toEqual([])
})
