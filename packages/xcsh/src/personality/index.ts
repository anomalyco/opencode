import z from "zod"
import path from "path"
import { Filesystem } from "../util/filesystem"
import DEFAULT_SOUL from "./default-soul.txt"
import { Global } from "../global"
import { BUILTIN_PRESETS } from "./presets"

export namespace Personality {
  export const Info = z.object({
    description: z.string().optional(),
    system_prompt: z.string(),
    tone: z.string().optional(),
    style: z.string().optional(),
  })

  export type Info = z.infer<typeof Info>

  // Accepts either a plain string (shorthand) or a full Info object
  export const Spec = z.union([z.string(), Info])

  export type Spec = z.infer<typeof Spec>

  /**
   * Resolve a Spec to a final system prompt string.
   * For dict format, tone/style are appended as guidance when present.
   */
  // --- Session state (ephemeral, in-memory only) ---

  const sessionMap = new Map<string, string>()

  export function setSession(sessionID: string, name: string): void {
    sessionMap.set(sessionID, name)
  }

  export function getSession(sessionID: string): string | undefined {
    return sessionMap.get(sessionID)
  }

  export function clearSession(sessionID: string): void {
    sessionMap.delete(sessionID)
  }

  // --- Command handler ---

  export type CommandResult = { ok: boolean; message: string }

  const CLEAR_ALIASES = new Set(["none", "default", "neutral"])

  /**
   * Handle a /personality command invocation.
   * arg: the argument after /personality (trimmed), or "" for listing.
   */
  export function handleCommand(sessionID: string, arg: string, config: PersonalityConfig): CommandResult {
    const trimmed = arg.trim().toLowerCase()

    // List personalities
    if (trimmed === "") {
      const items = list(config)
      const active = getSession(sessionID)
      const lines = items.map((i) => {
        const marker = i.name === active ? " (active)" : ""
        const src = i.source === "custom" ? " [custom]" : ""
        const desc = i.description ? ` — ${i.description}` : ""
        return `  ${i.name}${marker}${src}${desc}`
      })
      return {
        ok: true,
        message: ["Available personalities:", ...lines].join("\n"),
      }
    }

    // Show current
    if (trimmed === "show") {
      const active = getSession(sessionID)
      return {
        ok: true,
        message: active ? `Active personality: ${active}` : "No active personality (using default soul)",
      }
    }

    // Clear
    if (CLEAR_ALIASES.has(trimmed)) {
      clearSession(sessionID)
      return { ok: true, message: "Personality cleared. Using default soul." }
    }

    // Set
    const p = resolve(trimmed, config)
    if (!p) {
      const available = list(config)
        .map((i) => i.name)
        .join(", ")
      return {
        ok: false,
        message: `Unknown personality: "${trimmed}". Available: ${available}`,
      }
    }

    setSession(sessionID, trimmed)
    return { ok: true, message: `Personality set to: ${trimmed}` }
  }

  export type LoadSoulOptions = {
    configDir?: string
    projectDir?: string
  }

  async function readSoulFile(filepath: string): Promise<string> {
    return Filesystem.readText(filepath).catch(() => "")
  }

  /**
   * Load the soul identity from SOUL.md files.
   * Priority: global config dir + project .xcsh/ (concatenated).
   * Falls back to built-in default if no non-empty SOUL.md found.
   */
  export async function loadSoul(options?: LoadSoulOptions): Promise<string> {
    const configDir = options?.configDir ?? Global.Path.config
    const projectDir = options?.projectDir

    const parts: string[] = []

    // 1. Global SOUL.md
    const globalSoul = await readSoulFile(path.join(configDir, "SOUL.md"))
    if (globalSoul.trim()) parts.push(globalSoul.trim())

    // 2. Project SOUL.md
    if (projectDir) {
      const projectSoul = await readSoulFile(path.join(projectDir, ".xcsh", "SOUL.md"))
      if (projectSoul.trim()) parts.push(projectSoul.trim())
    }

    // Fall back to built-in default
    if (parts.length === 0) return DEFAULT_SOUL.trim()

    return parts.join("\n\n")
  }

  export type ListItem = {
    name: string
    description: string
    source: "builtin" | "custom"
  }

  /** Return all built-in personality presets. */
  export function presets(): Record<string, Info> {
    return BUILTIN_PRESETS
  }

  type PersonalityConfig = {
    personality?: {
      active?: string
      custom?: Record<string, Spec>
    }
  }

  /**
   * Resolve a personality by name.
   * Custom personalities in config take precedence over built-ins.
   */
  export function resolve(name: string, config: PersonalityConfig): Info | undefined {
    const custom = config.personality?.custom?.[name]
    if (custom !== undefined) {
      if (typeof custom === "string") return { system_prompt: custom }
      return custom
    }
    return BUILTIN_PRESETS[name]
  }

  /**
   * List all personalities (builtins + custom), sorted alphabetically.
   */
  export function list(config: PersonalityConfig): ListItem[] {
    const items: ListItem[] = []

    for (const [name, p] of Object.entries(BUILTIN_PRESETS)) {
      items.push({ name, description: p.description ?? "", source: "builtin" })
    }

    for (const [name, spec] of Object.entries(config.personality?.custom ?? {})) {
      const existing = items.findIndex((i) => i.name === name)
      const description = typeof spec === "string" ? "" : (spec.description ?? "")
      if (existing >= 0) {
        items[existing] = { name, description, source: "custom" }
      } else {
        items.push({ name, description, source: "custom" })
      }
    }

    return items.sort((a, b) => a.name.localeCompare(b.name))
  }

  export function resolvePrompt(spec: Spec): string {
    if (typeof spec === "string") return spec
    const parts = [spec.system_prompt]
    if (spec.tone || spec.style) {
      const modifiers = [spec.tone && `Tone: ${spec.tone}`, spec.style && `Style: ${spec.style}`]
        .filter(Boolean)
        .join(". ")
      parts.push(modifiers)
    }
    return parts.join("\n")
  }
}
