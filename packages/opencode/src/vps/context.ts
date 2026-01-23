import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import { VpsConnection } from "./connection"

export namespace VpsContext {
  const log = Log.create({ service: "vps.context" })

  export const Info = z
    .object({
      type: z.enum(["local", "vps"]),
      vpsId: z.string().optional(),
      configKey: z.string().optional(),
      nickname: z.string().optional(),
      directory: z.string().optional(),
    })
    .meta({ ref: "VpsContextInfo" })

  export type Info = z.infer<typeof Info>

  export const Event = {
    Switched: BusEvent.define(
      "vps.context.switched",
      z.object({
        from: Info,
        to: Info,
      })
    ),
  }

  interface ContextState {
    current: Info
    history: Info[]
  }

  const state = Instance.state(
    (): ContextState => ({
      current: { type: "local" },
      history: [],
    }),
    async () => {
      // Cleanup - nothing needed
    }
  )

  /**
   * Get the current context
   */
  export function getCurrent(): Info {
    return state().current
  }

  /**
   * Switch to a new context
   */
  export function switchTo(context: Info): void {
    const from = state().current
    state().history.push(from)
    state().current = context

    log.info("Context switched", { from, to: context })
    Bus.publish(Event.Switched, { from, to: context })
  }

  /**
   * Switch to local context
   */
  export function switchToLocal(): void {
    switchTo({
      type: "local",
      directory: Instance.directory,
    })
  }

  /**
   * Switch to VPS context
   */
  export function switchToVps(vpsId: string, configKey: string, nickname: string, directory?: string): void {
    const vpsInfo = VpsConnection.get(vpsId)
    switchTo({
      type: "vps",
      vpsId,
      configKey,
      nickname,
      directory: directory || vpsInfo?.defaultDirectory || "~",
    })
  }

  /**
   * Get context history
   */
  export function getHistory(): Info[] {
    return [...state().history]
  }

  /**
   * Go back to previous context
   */
  export function goBack(): Info | null {
    const history = state().history
    if (history.length === 0) return null

    const previous = history.pop()!
    const from = state().current
    state().current = previous

    log.info("Context reverted", { from, to: previous })
    Bus.publish(Event.Switched, { from, to: previous })

    return previous
  }

  /**
   * Check if currently in local context
   */
  export function isLocal(): boolean {
    return state().current.type === "local"
  }

  /**
   * Check if currently in VPS context
   */
  export function isVps(): boolean {
    return state().current.type === "vps"
  }

  /**
   * Get the current VPS ID (if in VPS context)
   */
  export function getCurrentVpsId(): string | undefined {
    return state().current.vpsId
  }

  /**
   * Get the current config key (if in VPS context)
   */
  export function getCurrentConfigKey(): string | undefined {
    return state().current.configKey
  }

  /**
   * Get the current working directory (local or remote)
   */
  export function getCurrentDirectory(): string {
    const current = state().current
    if (current.type === "local") {
      return Instance.directory
    }
    return current.directory || "~"
  }

  /**
   * Set the current directory (for VPS context)
   */
  export function setDirectory(directory: string): void {
    const current = state().current
    if (current.type === "vps") {
      state().current = { ...current, directory }
    }
  }

  /**
   * Get context display name
   */
  export function getDisplayName(): string {
    const current = state().current
    if (current.type === "local") {
      return "local"
    }
    return current.nickname || current.configKey || "VPS"
  }

  /**
   * Parse context switching command (e.g., "cd vps1", "cd local")
   * Returns the target context key or null if not a context switch
   */
  export function parseContextCommand(command: string): { type: "local" | "vps"; key?: string } | null {
    const trimmed = command.trim().toLowerCase()

    // Match: cd local
    if (trimmed === "cd local" || trimmed === "local") {
      return { type: "local" }
    }

    // Match: cd vps <name> or cd vps:<name>
    const vpsMatch = trimmed.match(/^(?:cd\s+)?vps[:\s]+(\S+)$/i)
    if (vpsMatch) {
      return { type: "vps", key: vpsMatch[1] }
    }

    // Match: cd <name> where name is a known VPS config
    const cdMatch = trimmed.match(/^cd\s+(\S+)$/i)
    if (cdMatch) {
      const key = cdMatch[1]
      // Will be validated against config later
      if (key !== "local" && !key.startsWith("/") && !key.startsWith(".") && !key.startsWith("~")) {
        return { type: "vps", key }
      }
    }

    return null
  }
}
