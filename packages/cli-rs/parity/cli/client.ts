// How P-CLI and P-PTY start the two clients: the TS CLI from source and the Rust `opencode-rs`, each
// in a fresh home with its own XDG roots, so neither reads or writes the user's config, state, or service.

import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

export type Side = "ts" | "rs"

const rs = path.resolve(import.meta.dir, "../..")
const cli = path.resolve(rs, "../cli")

export function parseSides(value: string | undefined): [Side, Side] {
  const sides = (value ?? "ts,rs").split(",")
  if (sides.length !== 2 || !sides.every((side): side is Side => side === "ts" || side === "rs"))
    throw new Error(`--sides takes two of ts and rs, for example ts,rs (got ${value})`)
  return [sides[0], sides[1]]
}

// `bun run src/index.ts` as `packages/cli`'s `dev` script runs it, from the scenario's working
// directory. The bunfig preload (`packages/cli/bunfig.toml`) would resolve from that directory, so it
// is passed resolved; `--no-install` keeps Bun from auto-installing anything it cannot resolve.
export function command(side: Side, args: string[]) {
  if (side === "ts")
    return [
      "bun",
      "--no-install",
      `--preload=${Bun.resolveSync("@opentui/solid/preload", cli)}`,
      path.join(cli, "src/index.ts"),
      ...args,
    ]
  return [process.env.OPENCODE_RS_BIN ?? path.join(rs, "target/debug/opencode-rs"), ...args]
}

// Builds the debug `opencode-rs` once per run, unless OPENCODE_RS_BIN names a binary.
export async function buildRust(sides: Side[]) {
  if (!sides.includes("rs") || process.env.OPENCODE_RS_BIN) return
  const proc = Bun.spawn(["cargo", "build", "--quiet", "-p", "opencode-cli", "--bin", "opencode-rs"], {
    cwd: rs,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await proc.exited) !== 0) throw new Error("cargo build -p opencode-cli failed")
}

export type Sandbox = Awaited<ReturnType<typeof sandbox>>

// A temporary root with `home`, the XDG roots, `tmp`, and `work` (the working directory). The
// environment starts empty, so no OPENCODE_* variable of the calling session leaks in.
export async function sandbox(env: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-parity-"))
  const dirs = {
    home: "home",
    config: "home/.config",
    data: "home/.local/share",
    state: "home/.local/state",
    cache: "home/.cache",
    tmp: "tmp",
    work: "work",
  }
  const paths = Object.fromEntries(Object.entries(dirs).map(([key, dir]) => [key, path.join(root, dir)])) as Record<
    keyof typeof dirs,
    string
  >
  await Promise.all(Object.values(paths).map((dir) => mkdir(dir, { recursive: true })))
  return {
    root,
    cwd: paths.work,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C.UTF-8",
      HOME: paths.home,
      XDG_CONFIG_HOME: paths.config,
      XDG_DATA_HOME: paths.data,
      XDG_STATE_HOME: paths.state,
      XDG_CACHE_HOME: paths.cache,
      TMPDIR: paths.tmp,
      OPENCODE_CLI_NAME: "opencode",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      ...env,
    },
  }
}

// `$SERVER` in the arguments becomes the fake server's URL; without it, `--server <url>` goes last.
export function withServer(args: string[], url: string | undefined) {
  if (url === undefined) return args
  if (args.includes("$SERVER")) return args.map((arg) => (arg === "$SERVER" ? url : arg))
  return [...args, "--server", url]
}

export type Context = { server?: string; root: string }

// Plan 7.5: the values that differ between runs or between the clients for no user-visible reason.
export function normalize(text: string, context: Context) {
  return [
    ...(context.server ? [[context.server, "<server>"] as const] : []),
    [context.root, "<root>"] as const,
    [/\b(ses|msg|prt|per|frm|evt|prj|proj|wrk|pty|tool|call)_[A-Za-z0-9]{6,}\b/g, "<$1>"] as const,
    [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\b/g, "<time>"] as const,
    [/\bv?\d+\.\d+\.\d+(-[\w.]+)?\b/g, "<version>"] as const,
    [/\b\d+(\.\d+)?\s?(ms|s)\b/g, "<duration>"] as const,
    [/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>"] as const,
  ].reduce((current, [pattern, replacement]) => current.replaceAll(pattern, replacement), text)
}

export function nameOf(file: string) {
  const relative = path.relative(path.join(rs, "parity/scenarios"), file)
  return (relative.startsWith("..") ? path.basename(file) : relative).replace(/\.(cli|pty)\.ts$/, "")
}

export const parityRoot = path.join(rs, "parity")
