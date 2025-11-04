/**
 * Global SkillSystem singleton instance
 * Similar to Config.state, provides a single shared instance across the application
 */

import { SkillSystem } from "./skill-system"
import type { SkillMetadata, LoadedSkill } from "./types"

export namespace SkillInstance {
  let system: SkillSystem | null = null
  let initPromise: Promise<SkillSystem> | null = null
  let initialized = false

  /**
   * Initialize the skill system (async, happens once)
   */
  async function ensureInitialized() {
    if (initialized && system) return system

    if (initPromise) return initPromise

    initPromise = (async () => {
      console.log("[SkillInstance] Initializing skill system...")
      system = new SkillSystem({
        debug: true,
      })
      await system.initialize()
      initialized = true
      console.log("[SkillInstance] Skill system initialized")
      return system
    })()

    return initPromise
  }

  /**
   * Get the global skill system instance (async)
   */
  export async function get() {
    return ensureInitialized()
  }

  /**
   * List all discovered skills (sync - returns empty array if not initialized yet)
   */
  export function list(): SkillMetadata[] {
    if (!initialized || !system) {
      // Start initialization in background if not started
      ensureInitialized().catch(console.error)
      return []
    }
    return system.getAllSkills()
  }

  /**
   * Get active skills (sync)
   */
  export function getActive(): LoadedSkill[] {
    if (!initialized || !system) return []
    return system.getActiveSkills()
  }

  /**
   * Check if initialized
   */
  export function isReady(): boolean {
    return initialized && system !== null
  }

  /**
   * Reload the skill system (re-discover skills)
   */
  export async function reload() {
    const sys = await ensureInitialized()
    await sys.reload()
    return sys
  }
}
