import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  RECOMMENDED_ARABIC_FONTS,
  appendFontFamily,
  applyArabicFont,
  buildFontFaceChain,
  detectTerminalHost,
  isFontInstalled,
  sanitizeJsonc,
  splitFontFaces,
} from "../../src/util/terminal-font"

const roots: string[] = []
const env = {
  local: process.env.LOCALAPPDATA,
  appdata: process.env.APPDATA,
  term: process.env.TERM_PROGRAM,
  wt: process.env.WT_SESSION,
}

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "oc-font-"))
  roots.push(dir)
  return dir
}

afterEach(() => {
  process.env.LOCALAPPDATA = env.local
  process.env.APPDATA = env.appdata
  if (env.term === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = env.term
  if (env.wt === undefined) delete process.env.WT_SESSION
  else process.env.WT_SESSION = env.wt
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("sanitizeJsonc", () => {
  test("removes line, block comments and trailing commas", () => {
    const input = `{
      // a comment
      "a": 1, /* inline */
      "b": [1, 2,],
    }`
    expect(JSON.parse(sanitizeJsonc(input))).toEqual({ a: 1, b: [1, 2] })
  })

  test("does not touch comment markers inside strings", () => {
    const input = `{ "url": "https://example.com//x", "a": 1 }`
    expect(JSON.parse(sanitizeJsonc(input))).toEqual({ url: "https://example.com//x", a: 1 })
  })
})

describe("appendFontFamily", () => {
  test("appends and keeps monospace last", () => {
    expect(appendFontFamily("'Cascadia Mono', monospace", "Cairo")).toBe("'Cascadia Mono', 'Cairo', monospace")
  })

  test("is idempotent", () => {
    expect(appendFontFamily("'Cairo', monospace", "Cairo")).toBe("'Cairo', monospace")
  })

  test("starts a list when unset", () => {
    expect(appendFontFamily(undefined, "Noto Naskh Arabic")).toBe("'Noto Naskh Arabic'")
  })
})

describe("isFontInstalled", () => {
  test("matches exact names and named instances", () => {
    const installed = ["Cairo", "Cairo Black", "Tahoma"]
    expect(isFontInstalled("Cairo", installed)).toBe(true)
    expect(isFontInstalled("Tahoma", installed)).toBe(true)
    expect(isFontInstalled("Amiri", installed)).toBe(false)
  })
})

describe("detectTerminalHost", () => {
  test("detects Windows Terminal from WT_SESSION", () => {
    expect(detectTerminalHost({ WT_SESSION: "abc" })).toBe("windows-terminal")
  })

  test("detects the VS Code integrated terminal", () => {
    expect(detectTerminalHost({ TERM_PROGRAM: "vscode" })).toBe("vscode")
    expect(detectTerminalHost({ VSCODE_INJECTION: "1" })).toBe("vscode")
  })

  test("falls back to other", () => {
    expect(detectTerminalHost({})).toBe("other")
  })
})

describe("splitFontFaces", () => {
  test("splits a comma chain and drops quotes and blanks", () => {
    expect(splitFontFaces(`'Cascadia Mono', Cairo ,, "Segoe UI"`)).toEqual(["Cascadia Mono", "Cairo", "Segoe UI"])
  })

  test("returns an empty list when unset", () => {
    expect(splitFontFaces(undefined)).toEqual([])
  })
})

describe("buildFontFaceChain", () => {
  test("keeps the current faces first, then the chosen Arabic font", () => {
    expect(buildFontFaceChain("Cascadia Mono", "Cairo")).toBe(
      ["Cascadia Mono", "Cairo", ...RECOMMENDED_ARABIC_FONTS.filter((f) => f !== "Cairo")].join(", "),
    )
  })

  test("defaults to Cascadia Mono when no face is set", () => {
    expect(buildFontFaceChain(undefined, "Amiri").startsWith("Cascadia Mono, Amiri")).toBe(true)
  })

  test("never reorders or duplicates the user's faces", () => {
    expect(buildFontFaceChain("Cascadia Mono, Segoe UI", "Cairo")).toBe(
      ["Cascadia Mono", "Segoe UI", "Cairo", ...RECOMMENDED_ARABIC_FONTS.filter((f) => f !== "Cairo" && f !== "Segoe UI")].join(
        ", ",
      ),
    )
  })
})

describe("applyArabicFont", () => {
  test("writes a Windows Terminal face chain and keeps a backup", () => {
    const root = tempDir()
    const settings = path.join(root, "Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json")
    mkdirSync(path.dirname(settings), { recursive: true })
    writeFileSync(settings, JSON.stringify({ profiles: { defaults: { font: { face: "Cascadia Mono" } } } }))
    process.env.LOCALAPPDATA = root
    process.env.APPDATA = path.join(root, "no-vscode")

    const result = applyArabicFont("Amiri")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.target).toBe("Windows Terminal")

    const written = JSON.parse(readFileSync(settings, "utf8"))
    const faces = String(written.profiles.defaults.font.face)
      .split(",")
      .map((part: string) => part.trim())
    expect(faces[0]).toBe("Cascadia Mono")
    expect(faces[1]).toBe("Amiri")
    for (const font of RECOMMENDED_ARABIC_FONTS) {
      if (font === "Amiri") continue
      expect(faces).toContain(font)
    }
    expect(written.profiles.defaults.font.fallbacks).toBeUndefined()
    expect(readFileSync(result.backup, "utf8")).toContain("Cascadia Mono")
  })

  test("removes a stale unsupported fallbacks array", () => {
    const root = tempDir()
    const settings = path.join(root, "Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json")
    mkdirSync(path.dirname(settings), { recursive: true })
    writeFileSync(
      settings,
      JSON.stringify({ profiles: { defaults: { font: { fallbacks: ["Bauhaus 93", "Cairo"] } } } }),
    )
    process.env.LOCALAPPDATA = root
    process.env.APPDATA = path.join(root, "no-vscode")

    const result = applyArabicFont("Cairo")
    expect(result.ok).toBe(true)
    const written = JSON.parse(readFileSync(settings, "utf8"))
    expect(String(written.profiles.defaults.font.face).startsWith("Cascadia Mono, Cairo")).toBe(true)
    expect(written.profiles.defaults.font.fallbacks).toBeUndefined()
  })

  test("targets VS Code when hosted by VS Code even if Windows Terminal is installed", () => {
    const root = tempDir()
    const wtSettings = path.join(root, "Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json")
    mkdirSync(path.dirname(wtSettings), { recursive: true })
    writeFileSync(wtSettings, JSON.stringify({ profiles: { defaults: { font: { face: "Cascadia Mono" } } } }))

    const appdata = path.join(root, "appdata")
    const vscode = path.join(appdata, "Code/User/settings.json")
    mkdirSync(path.dirname(vscode), { recursive: true })
    writeFileSync(vscode, JSON.stringify({}))

    process.env.LOCALAPPDATA = root
    process.env.APPDATA = appdata
    process.env.TERM_PROGRAM = "vscode"
    delete process.env.WT_SESSION

    const result = applyArabicFont("Cairo")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.target).toBe("VS Code integrated terminal")
    expect(JSON.parse(readFileSync(vscode, "utf8"))["terminal.integrated.fontFamily"]).toContain("Cairo")
    expect(JSON.parse(readFileSync(wtSettings, "utf8")).profiles.defaults.font.fallbacks).toBeUndefined()
  })

  test("reports failure when no supported terminal exists", () => {
    const root = tempDir()
    process.env.LOCALAPPDATA = path.join(root, "missing")
    process.env.APPDATA = path.join(root, "missing2")
    const result = applyArabicFont("Cairo")
    expect(result.ok).toBe(false)
  })
})
