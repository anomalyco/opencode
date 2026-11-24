#!/usr/bin/env bun
// Captures the official product screenshots from the real product with demo data, in light and dark,
// at 2x, and writes a manifest (OpenCode version, date, size and hash of each file) next to them.
// See script/assets/README.md. Run from packages/console/app:
//   bun script/capture-assets.ts [--out ../../../../fresh-assets] [--surface terminal] [--surface terminal-film]
// Needs: opencode (or OPENCODE_BIN), vhs, bun, git, zip. Only the terminal surfaces are automated so far.
// Track the TUI on dev: OPENCODE_BIN=<a build of origin/dev's packages/cli> (bun run script/build.ts
// --single), plus --experiment for any TUI design behind a flag there.
// terminal-film records the same run as video at the product video sizes, with a fixed frame (no camera),
// for the locked-off product video cuts (see product-videos/cinematic next to the checkout).
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { prompt, startStubModel } from "./assets/stub-model"

const args = parseArgs({
  options: {
    // Outside the repo and outside the temp folder (a reboot wipes it): fresh-assets/ next to the checkout.
    out: {
      type: "string",
      default: process.env.FRESH_ASSETS_DIR ?? path.join(import.meta.dir, "../../../../../fresh-assets"),
    },
    surface: { type: "string", multiple: true, default: ["terminal"] },
    font: { type: "string", default: process.env.CAPTURE_FONT ?? "OpenTUI Mono" },
    // TUI experiments to turn on in the capture's cli.json, e.g. --experiment new-designs (the
    // muted-blue dialogs with the left key line on dev).
    experiment: { type: "string", multiple: true, default: [] },
    // The TUI theme. "opencode2" is the new-designs theme (offered only with that experiment on).
    theme: { type: "string", default: "opencode" },
  },
}).values
const out = path.resolve(args.out)
const opencode = process.env.OPENCODE_BIN ?? "opencode"
const modes = ["dark", "light"] as const

// Logical window 1600x1000, rendered at 2x.
const size = { width: 1600, height: 1000, scale: 2, fontSize: 20 }

const surfaces: Record<string, () => Promise<Asset[]>> = {
  terminal: captureTerminal,
  "terminal-film": captureTerminalFilm,
}

// The product video slots: carousel card (4:5), product hero (16:9) and feature clip (16:10), each
// with a font size that reads at the size the slot is shown.
const films = [
  { id: "portrait", width: 1080, height: 1350, fontSize: 30 },
  { id: "landscape", width: 1920, height: 1080, fontSize: 30 },
  { id: "feature", width: 1600, height: 1000, fontSize: 26 },
]

type Asset = { surface: string; id: string; mode: string; file: string; width?: number; height?: number }

await mkdir(out, { recursive: true })
const version = (await $`${opencode} --version`.text()).trim().replace(/^opencode\s+/, "")
const assets = (
  await Array.fromAsync(args.surface, (surface) => {
    const capture = surfaces[surface]
    if (!capture) throw new Error(`No capture for surface "${surface}" yet. See script/assets/README.md.`)
    return capture()
  })
).flat()

const manifest = {
  schema: 1,
  opencodeVersion: version.replace(/^v/, ""),
  capturedAt: new Date().toISOString(),
  generator: {
    script: "packages/console/app/script/capture-assets.ts",
    commit: (await $`git rev-parse --short HEAD`.nothrow().text()).trim(),
    vhs: (await $`vhs --version`.nothrow().text()).trim(),
  },
  window: size,
  assets: await Promise.all(
    assets.map(async (asset) => {
      const file = Bun.file(path.join(out, asset.file))
      const bytes = await file.bytes()
      // PNG IHDR: width and height are big-endian at bytes 16 and 20. Films carry their own size.
      const header = new DataView(bytes.buffer)
      const png = asset.file.endsWith(".png")
      return {
        ...asset,
        width: png ? header.getUint32(16) : asset.width,
        height: png ? header.getUint32(20) : asset.height,
        bytes: file.size,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      }
    }),
  ),
}
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
await Promise.all(
  args.surface.map(async (surface) => {
    await rm(path.join(out, `opencode-${surface}-screenshots.zip`), { force: true })
    if (surface === "terminal-film") return
    await $`zip -q -X -j opencode-${surface}-screenshots.zip ${surface}/*.png manifest.json`.cwd(out)
  }),
)
console.log(`Captured ${manifest.assets.length} files from OpenCode ${manifest.opencodeVersion} into ${out}`)

// Terminal: the real TUI in VHS (ttyd + headless Chrome), with an isolated HOME, a fixture repo and the
// scripted model. Three beats per mode: the home screen with the prompt typed, the diff with the
// permission prompt, and the finished run.
async function captureTerminal() {
  const work = path.join(out, ".work", "terminal")
  const home = path.join(work, "home")
  const model = startStubModel()
  const port = model.port ?? 0
  await mkdir(path.join(out, "terminal"), { recursive: true })
  const shots = await Array.fromAsync(modes, async (mode) => {
    await rm(work, { recursive: true, force: true })
    await writeTerminalFixture(home, mode, port)
    const tape = path.join(work, `${mode}.tape`)
    const file = (id: string) => path.join(out, "terminal", `terminal-${id}-${mode}@2x.png`)
    await Bun.write(tape, terminalTape(home, mode, file))
    // The tape exports the isolated environment itself; VHS keeps the real HOME to find its browser.
    const result = await $`vhs ${tape}`.cwd(work).nothrow().quiet()
    if (result.exitCode !== 0) throw new Error(`vhs failed (${mode}):\n${result.stderr}`)
    return ["home", "permission", "done"].map((id) => ({
      surface: "terminal",
      id,
      mode,
      file: path.relative(out, file(id)),
    }))
  })
  model.stop(true)
  await rm(path.join(out, ".work"), { recursive: true, force: true })
  return shots.flat()
}

// The same run recorded as video in dark mode, once per product video slot: the prompt typed under
// the wordmark, the agent reading and editing, the permission prompt, the tests and the summary.
async function captureTerminalFilm() {
  const work = path.join(out, ".work", "terminal-film")
  const home = path.join(work, "home")
  const model = startStubModel()
  const port = model.port ?? 0
  await mkdir(path.join(out, "terminal-film"), { recursive: true })
  const takes = await Array.fromAsync(films, async (film) => {
    await rm(work, { recursive: true, force: true })
    await writeTerminalFixture(home, "dark", port)
    const tape = path.join(work, `${film.id}.tape`)
    const file = path.join(out, "terminal-film", `terminal-${film.id}-dark.mp4`)
    await Bun.write(tape, filmTape(home, film, file))
    const result = await $`vhs ${tape}`.cwd(work).nothrow().quiet()
    if (result.exitCode !== 0) throw new Error(`vhs failed (${film.id}):\n${result.stderr}`)
    return {
      surface: "terminal-film",
      id: film.id,
      mode: "dark",
      file: path.relative(out, file),
      width: film.width,
      height: film.height,
    }
  })
  model.stop(true)
  await rm(path.join(out, ".work"), { recursive: true, force: true })
  return takes
}

function filmTape(home: string, film: (typeof films)[number], file: string) {
  const env = Object.entries(isolatedEnv(home))
    .map(([key, value]) => `${key}='${value}'`)
    .join(" ")
  return [
    `Output "${file}"`,
    `Set Shell bash`,
    `Set FontFamily "${args.font}"`,
    `Set FontSize ${film.fontSize}`,
    `Set Width ${film.width}`,
    `Set Height ${film.height}`,
    `Set Padding 0`,
    `Set Framerate 30`,
    `Set Theme ${JSON.stringify({ background: "#0a0a0a", foreground: "#eeeeee" })}`,
    `Set CursorBlink false`,
    `Set TypingSpeed 55ms`,
    `Hide`,
    `Type "export ${env} && cd ~/my-app && clear && ${opencode} --standalone"`,
    `Enter`,
    `Wait+Screen@60s /Claude Opus 5.5/`,
    `Sleep 1200ms`,
    `Show`,
    `Sleep 1200ms`,
    `Type "${prompt}"`,
    `Sleep 900ms`,
    `Enter`,
    `Wait+Screen@120s /Allow once/`,
    `Sleep 2500ms`,
    `Enter`,
    `Wait+Screen@120s /tok\\/s/`,
    `Sleep 3500ms`,
    // The feature clips also show the theme picker: /themes, then a few themes previewed live.
    ...(film.id === "feature"
      ? [
          `Type "/themes"`,
          `Sleep 700ms`,
          `Enter`,
          `Sleep 1500ms`,
          // Below opencode2 in the list is "orng", the old orange: step past it in one burst.
          ...(args.theme === "opencode2" ? [`Down@10ms 2`, `Sleep 900ms`] : ["Down", "Sleep 900ms"]),
          ...Array(5).fill(["Down", "Sleep 900ms"]).flat(),
          `Sleep 600ms`,
        ]
      : []),
    "",
  ].join("\n")
}

function terminalTape(home: string, mode: (typeof modes)[number], file: (id: string) => string) {
  const env = Object.entries(isolatedEnv(home))
    .map(([key, value]) => `${key}='${value}'`)
    .join(" ")
  return [
    `Set Shell bash`,
    `Set FontFamily "${args.font}"`,
    `Set FontSize ${size.fontSize * size.scale}`,
    `Set Width ${size.width * size.scale}`,
    `Set Height ${size.height * size.scale}`,
    `Set Padding 0`,
    // Matches the TUI background, so the rows VHS leaves below the last cell line do not show.
    `Set Theme ${JSON.stringify({ background: mode === "dark" ? "#0a0a0a" : "#ffffff", foreground: mode === "dark" ? "#eeeeee" : "#1a1a1a" })}`,
    `Set CursorBlink false`,
    `Set TypingSpeed 15ms`,
    `Hide`,
    `Type "export ${env} && cd ~/my-app && clear && ${opencode} --standalone"`,
    `Enter`,
    `Wait+Screen@60s /Claude Opus 5.5/`,
    `Sleep 1500ms`,
    `Type "${prompt}"`,
    `Sleep 500ms`,
    `Show`,
    `Screenshot "${file("home")}"`,
    `Enter`,
    `Wait+Screen@120s /Allow once/`,
    `Sleep 1500ms`,
    `Screenshot "${file("permission")}"`,
    `Enter`,
    `Wait+Screen@120s /tok\\/s/`,
    `Sleep 2000ms`,
    `Screenshot "${file("done")}"`,
    `Sleep 300ms`,
    "",
  ].join("\n")
}

function isolatedEnv(home: string) {
  return {
    HOME: home,
    XDG_CONFIG_HOME: `${home}/.config`,
    XDG_DATA_HOME: `${home}/.local/share`,
    XDG_STATE_HOME: `${home}/.local/state`,
    XDG_CACHE_HOME: `${home}/.cache`,
    SHELL: "/bin/bash",
    PS1: "$ ",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    BASH_SILENCE_DEPRECATION_WARNING: "1",
    TZ: "UTC",
    LANG: "en_US.UTF-8",
  }
}

async function writeTerminalFixture(home: string, mode: string, port: number) {
  const repo = path.join(home, "my-app")
  const files: Record<string, string> = {
    ".config/opencode/opencode.json": JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        autoupdate: false,
        model: "demo/claude-opus-5-5",
        providers: {
          demo: {
            name: "OpenCode",
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "demo" },
            models: { "claude-opus-5-5": { name: "Claude Opus 5.5" } },
          },
        },
      },
      null,
      2,
    ),
    ".config/opencode/cli.json": JSON.stringify(
      {
        $schema: "https://opencode.ai/v2/cli.json",
        theme: { name: args.theme, mode },
        ...(args.experiment.length
          ? { experimental: Object.fromEntries(args.experiment.map((name) => [name, true])) }
          : {}),
      },
      null,
      2,
    ),
    // Dismisses the sidebar's "Getting started" card (it shows while no real provider is connected).
    ".local/state/opencode/latest/tui/plugin.opencode.sidebar.footer.getting-started.json": JSON.stringify({
      dismissed: true,
    }),
    "my-app/opencode.json": JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      permissions: [{ action: "shell", resource: "*", effect: "ask" }],
    }),
    "my-app/AGENTS.md": "- Keep changes small and focused.\n- Run `bun test` once, after editing.\n",
    "my-app/README.md": "# my-app\n\nA tiny shop cart.\n",
    "my-app/package.json": JSON.stringify(
      { name: "my-app", version: "0.1.0", type: "module", scripts: { test: "bun test" } },
      null,
      2,
    ),
    "my-app/src/cart.ts": [
      "export type Item = { name: string; price: number; qty: number }",
      "",
      "export function subtotal(items: Item[]) {",
      "  return items.reduce((sum, item) => sum + item.price * item.qty, 0)",
      "}",
      "",
      "export function total(items: Item[], code?: string) {",
      "  return subtotal(items)",
      "}",
      "",
    ].join("\n"),
    "my-app/src/cart.test.ts": [
      'import { expect, test } from "bun:test"',
      'import { subtotal, total } from "./cart"',
      "",
      "const items = [",
      '  { name: "Mug", price: 12, qty: 2 },',
      '  { name: "Tee", price: 26, qty: 1 },',
      "]",
      "",
      'test("subtotal adds up items", () => expect(subtotal(items)).toBe(50))',
      'test("no code means no discount", () => expect(total(items)).toBe(50))',
      'test("SAVE10 takes 10% off", () => expect(total(items, "SAVE10")).toBe(45))',
      'test("codes are case-insensitive", () => expect(total(items, "save10")).toBe(45))',
      'test("unknown codes are ignored", () => expect(total(items, "FREE")).toBe(50))',
      "",
    ].join("\n"),
  }
  await Promise.all(Object.entries(files).map(([file, text]) => Bun.write(path.join(home, file), text)))
  const date = "2026-01-01T12:00:00Z"
  await $`git init -q -b main && git add -A && git -c user.name=Demo -c user.email=demo@example.com commit -q -m init`
    .cwd(repo)
    .env({ ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
}
