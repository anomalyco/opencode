import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

// The TUI cannot render with its own font - the terminal emulator owns text
// shaping and font selection. This module is the application-level bridge: it
// detects installed font families and writes the user's choice into the
// settings of the terminal that actually renders the cells (Windows Terminal
// or the VS Code integrated terminal), keeping a timestamped backup.

export const RECOMMENDED_ARABIC_FONTS = [
  "Cairo",
  "Noto Naskh Arabic",
  "IBM Plex Sans Arabic",
  "Amiri",
  "Tajawal",
  "Almarai",
  "Segoe UI",
  "Tahoma",
  "Arial",
] as const

export type FontChoice = { family: string; installed: boolean; recommended: boolean }

export type ApplyOutcome =
  | { ok: true; target: string; path: string; backup: string; hint: string }
  | { ok: false; message: string }

function timestamp() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

// JSON with comments (VS Code settings, Windows Terminal settings) is not
// valid JSON. Strip comments and trailing commas before parsing.
export function sanitizeJsonc(text: string) {
  let out = ""
  let inString = false
  let quote = ""
  let index = 0
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (inString) {
      out += char
      if (char === "\\") {
        out += next ?? ""
        index += 2
        continue
      }
      if (char === quote) inString = false
      index++
      continue
    }
    if (char === '"' || char === "'") {
      inString = true
      quote = char
      out += char
      index++
      continue
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index++
      continue
    }
    if (char === "/" && next === "*") {
      index += 2
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++
      index += 2
      continue
    }
    out += char
    index++
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

export function windowsTerminalSettingsPath(): string | undefined {
  if (!process.env.LOCALAPPDATA) return undefined
  const candidates = [
    path.join(
      process.env.LOCALAPPDATA,
      "Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json",
    ),
    path.join(
      process.env.LOCALAPPDATA,
      "Packages/Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe/LocalState/settings.json",
    ),
    path.join(process.env.LOCALAPPDATA, "Microsoft/Windows Terminal/settings.json"),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

export function vscodeSettingsPath(): string | undefined {
  if (!process.env.APPDATA) return undefined
  const candidates = [
    path.join(process.env.APPDATA, "Code/User/settings.json"),
    path.join(process.env.APPDATA, "Code - Insiders/User/settings.json"),
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

function backup(file: string) {
  const target = `${file}.opencode-backup-${timestamp()}`
  copyFileSync(file, target)
  return target
}

function readJsonc(file: string) {
  return JSON.parse(sanitizeJsonc(readFileSync(file, "utf8"))) as Record<string, unknown>
}

function writeJson(file: string, value: unknown) {
  writeFileSync(file, JSON.stringify(value, null, 4), { encoding: "utf8" })
}

// Windows Terminal resolves `font.face` as a CSS-like fallback chain
// ("Cascadia Mono, Cairo, ..."). There is no `font.fallbacks` setting;
// writing one is silently ignored, so the writer below always uses `face`.
export const DEFAULT_WINDOWS_TERMINAL_FACE = "Cascadia Mono"

export function splitFontFaces(face: string | undefined): string[] {
  return (face ?? "")
    .split(",")
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
}

// Builds the fallback chain: the user's current faces first (never reordered),
// then the chosen Arabic font plus the other recommended Arabic fonts.
export function buildFontFaceChain(existingFace: string | undefined, family: string) {
  const base = splitFontFaces(existingFace)
  if (base.length === 0) base.push(DEFAULT_WINDOWS_TERMINAL_FACE)
  const seen = new Set(base.map((name) => name.toLowerCase()))
  const out = [...base]
  for (const name of [family, ...RECOMMENDED_ARABIC_FONTS.filter((item) => item !== family)]) {
    if (seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out.join(", ")
}

export function readWindowsTerminalFont(): { face?: string; faces: string[] } | undefined {
  const file = windowsTerminalSettingsPath()
  if (!file) return undefined
  const json = readJsonc(file)
  const defaults = (json.profiles as Record<string, unknown> | undefined)?.defaults as
    | Record<string, unknown>
    | undefined
  const font = defaults?.font as { face?: unknown } | undefined
  const face = typeof font?.face === "string" ? font.face : undefined
  return { face, faces: splitFontFaces(face) }
}

export function writeWindowsTerminalFont(input: { face: string }): {
  path: string
  backup: string
} {
  const file = windowsTerminalSettingsPath()
  if (!file) throw new Error("Windows Terminal settings.json not found")
  const created = backup(file)
  const json = readJsonc(file)
  const profiles = (json.profiles ??= {}) as Record<string, unknown>
  const defaults = (profiles.defaults ??= {}) as Record<string, unknown>
  const font = (defaults.font ??= {}) as Record<string, unknown>
  font.face = input.face
  // A previous version of this tool wrote an unsupported `fallbacks` array;
  // remove it so the file only carries settings the terminal honors.
  delete font.fallbacks
  writeJson(file, json)
  return { path: file, backup: created }
}

export function appendFontFamily(existing: string | undefined, family: string) {
  const parts = (existing ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  const unquoted = (value: string) => value.replace(/^['"]|['"]$/g, "")
  if (parts.some((part) => unquoted(part) === family)) return parts.join(", ")
  const trailing = parts.length > 0 && unquoted(parts[parts.length - 1]).toLowerCase() === "monospace" ? parts.pop() : undefined
  parts.push(`'${family}'`)
  if (trailing !== undefined) parts.push(trailing)
  return parts.join(", ")
}

export function writeVSCodeFontFamily(family: string): { path: string; backup: string } {
  const file = vscodeSettingsPath()
  if (!file) throw new Error("VS Code settings.json not found")
  const created = backup(file)
  const json = readJsonc(file)
  const key = "terminal.integrated.fontFamily"
  const existing = typeof json[key] === "string" ? (json[key] as string) : undefined
  json[key] = appendFontFamily(existing, family)
  writeJson(file, json)
  return { path: file, backup: created }
}

export function installedFontFamilies(): string[] {
  if (process.platform !== "win32") return []
  const roots = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
  ]
  const found = new Set<string>()
  for (const root of roots) {
    const result = Bun.spawnSync(["reg", "query", root], { stdout: "pipe", stderr: "ignore" })
    if (result.exitCode !== 0) continue
    for (const line of result.stdout.toString().split(/\r?\n/)) {
      const match = line.match(/^\s+(.+?)\s+REG_SZ\s+/)
      if (!match) continue
      const family = match[1].replace(/\s+\((TrueType|OpenType|All res|Type 1)\)\s*$/i, "").trim()
      if (family) found.add(family)
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
}

export function isFontInstalled(family: string, installed = installedFontFamilies()) {
  return installed.some((name) => name === family || name.startsWith(`${family} `))
}

export function fontChoices(): FontChoice[] {
  const installed = installedFontFamilies()
  const recommended: FontChoice[] = RECOMMENDED_ARABIC_FONTS.map((family) => ({
    family,
    installed: isFontInstalled(family, installed),
    recommended: true,
  }))
  const others: FontChoice[] = installed
    .filter((name) => !recommended.some((choice) => name === choice.family || name.startsWith(`${choice.family} `)))
    .map((family) => ({ family, installed: true, recommended: false }))
  return [...recommended, ...others]
}

export type TerminalHost = "windows-terminal" | "vscode" | "other"

// Which terminal is actually hosting this process. Picking the settings file by
// presence alone is wrong when both Windows Terminal and VS Code are installed:
// the dialog must write the settings of the terminal that renders the cells.
export function detectTerminalHost(env: NodeJS.ProcessEnv = process.env): TerminalHost {
  if (env.WT_SESSION) return "windows-terminal"
  if (env.TERM_PROGRAM === "vscode" || env.VSCODE_INJECTION || env.VSCODE_IPC_HOOK_CLI) return "vscode"
  return "other"
}

export function applyArabicFont(family: string): ApplyOutcome {
  const host = detectTerminalHost()
  const windowsTerminal = windowsTerminalSettingsPath()
  const vscode = vscodeSettingsPath()

  if (host === "windows-terminal" && windowsTerminal) return applyWindowsTerminalFont(family)
  if (host === "vscode" && vscode) return applyVSCodeFont(family)
  if (windowsTerminal) return applyWindowsTerminalFont(family)
  if (vscode) return applyVSCodeFont(family)
  return { ok: false, message: "No supported terminal settings found (Windows Terminal or VS Code)." }
}

function applyWindowsTerminalFont(family: string): ApplyOutcome {
  const face = buildFontFaceChain(readWindowsTerminalFont()?.face, family)
  const written = writeWindowsTerminalFont({ face })
  return {
    ok: true,
    target: "Windows Terminal",
    path: written.path,
    backup: written.backup,
    hint: "Close every Windows Terminal window and reopen it for the font to take effect.",
  }
}

function applyVSCodeFont(family: string): ApplyOutcome {
  const written = writeVSCodeFontFamily(family)
  return {
    ok: true,
    target: "VS Code integrated terminal",
    path: written.path,
    backup: written.backup,
    hint: "Open a new terminal in VS Code for the font to take effect.",
  }
}
