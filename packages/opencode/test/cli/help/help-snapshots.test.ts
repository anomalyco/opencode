// Help-text snapshots for every CLI command + key subcommand. Catches
// accidental flag removals, renames, and reordering in a single sweep —
// any change to the user-visible CLI surface shows up here as a diff.
//
// This is the broad coverage layer that makes the future Effect CLI
// migration (yargs → effect-smol/cli) safe to attempt: if a refactor
// preserves the surface, the snapshots stay green; if it doesn't, the
// diff tells you exactly which command(s) changed.
//
// Snapshots are taken at COLUMNS=120 so wrapping is stable across
// terminal sizes. The default opencode tui command is excluded —
// `opencode --help` includes an ASCII banner that pulls in the install
// version (changes per release), so we'd snapshot a moving target.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"
import { normalizeForSnapshot, PATH_SEP } from "../../lib/snapshot"

// Composes `normalizeForSnapshot` (CRLF + tmpdir) with two help-specific
// rules:
//
//   1. The harness's `oc-cli-XXX` subdir under TMPDIR collapses to `<HOME>`.
//      `PATH_SEP` matches `/` and `\\` so the rule works on POSIX + Windows.
//
//   2. yargs wraps the `[string] [default: "..."]` clause based on the
//      pre-normalized default's character length, so different random home
//      path widths produce different leading-whitespace counts (or even
//      line-wraps onto a fresh line on Windows). `\s+` matches both forms.
function normalize(text: string): string {
  return normalizeForSnapshot(text, {
    pathReplacements: [
      // Mixed-case [A-Za-z0-9] because node's mkdtemp suffix is mixed-case
      // (the harness now uses FileSystem.makeTempDirectoryScoped under the
      // hood). A `[a-z0-9]+` regex would leave uppercase chars trailing.
      [new RegExp(`<TMPDIR>${PATH_SEP}oc-cli-[A-Za-z0-9]+`, "g"), "<HOME>"],
      [/\s+\[string\] \[default: "<HOME>"\]/g, ' [string] [default: "<HOME>"]'],
    ],
  })
}

// Top-level commands. Order matches what `opencode --help` prints today;
// keep it in that order so the snapshot file reads as a table of contents.
// `completion` is intentionally excluded — it's a yargs built-in that emits
// top-level help on `--help` and exits 1; not a real opencode command.
const TOP_LEVEL = [
  "acp",
  "mcp",
  "attach",
  "run",
  "debug",
  "providers", // aliased to `auth`
  "agent",
  "upgrade",
  "uninstall",
  "serve",
  "web",
  "models",
  "stats",
  "export",
  "import",
  "github",
  "pr",
  "session",
  "plugin",
  "db",
] as const

// Subcommands worth pinning. Not exhaustive — the goal is one snapshot per
// distinct argv shape, not every leaf. Add new entries when a subcommand
// gains user-visible flags that we want to lock in.
const SUBCOMMANDS = [
  ["mcp", "list"],
  ["mcp", "add"],
  ["mcp", "auth"],
  ["mcp", "logout"],
  ["providers", "list"],
  ["providers", "login"],
  ["providers", "logout"],
  ["agent", "create"],
  ["agent", "list"],
  ["session", "list"],
  ["session", "delete"],
  ["github", "install"],
  ["github", "run"],
  ["db", "path"],
] as const

// Fixed wrap width so a developer's terminal doesn't affect snapshots.
// yargs honors COLUMNS; CI runners typically default to 80 which produces
// different wraps from a 200-col local terminal.
const SNAPSHOT_ENV = { COLUMNS: "120" }

describe("opencode CLI help-text snapshots", () => {
  // Single test, parallel spawns. Each command's help fires under
  // `concurrency: 8` — wall-clock stays under ~10s even for ~35 commands,
  // versus ~1 minute if we serialized.
  cliIt.live(
    "every documented command emits stable help text",
    ({ opencode }) =>
      Effect.gen(function* () {
        const topLevel = yield* opencode.spawn(["--help"], { env: SNAPSHOT_ENV })
        expect(topLevel.exitCode).toBe(0)
        expect(topLevel.stderr.endsWith("\n")).toBe(true)
        expect(topLevel.stderr).toContain("--mini")
        expect(topLevel.stderr).not.toContain("--thinking")
        expect(topLevel.stderr).not.toContain("--variant")
        expect(topLevel.stderr).not.toContain("--demo")

        const argvs: Array<readonly string[]> = [...TOP_LEVEL.map((c) => [c] as const), ...SUBCOMMANDS]

        // Spawn in parallel, then assert in argv order so snapshot output is
        // deterministic and per-command failures don't abort the rest of
        // the sweep. `Effect.partition` is the canonical "run all, separate
        // failures from successes" primitive — no mutable accumulator needed.
        const [failures, results] = yield* Effect.partition(
          argvs,
          (argv) =>
            Effect.gen(function* () {
              const result = yield* opencode.spawn([...argv, "--help"], { env: SNAPSHOT_ENV })
              if (result.exitCode !== 0) {
                return yield* Effect.fail(`opencode ${argv.join(" ")}: exit ${result.exitCode}`)
              }
              return { argv, result }
            }),
          { concurrency: 8 },
        )

        for (const { argv, result } of results) {
          // yargs writes --help to stderr, not stdout. Snapshotting stderr
          // means our test catches the help body; stdout for these commands
          // is expected to be empty.
          expect(normalize(result.stderr)).toMatchSnapshot(`opencode ${argv.join(" ")} --help`)
        }
        if (failures.length > 0) {
          throw new Error(`Help text failed for:\n  ${failures.join("\n  ")}`)
        }
      }),
    180_000,
  )
})
