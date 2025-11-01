/**
 * Global SkillSystem singleton instance
 * Similar to Config.state, provides a single shared instance across the application
 */

import { SkillSystem } from "./skill-system"
import { lazy } from "../util/lazy"

export namespace SkillInstance {
  /**
   * Lazy-initialized singleton SkillSystem instance
   */
  export const state = lazy(async () => {
    const system = new SkillSystem({
      debug: true, // Enable debug logging to diagnose issues
    })

    console.log("[SkillInstance] Initializing skill system...")
    await system.initialize()
    console.log("[SkillInstance] Skill system initialized")

    return system
  })

  /**
   * Get the global skill system instance
   */
  export async function get() {
    return state()
  }

  /**
   * Reload the skill system (re-discover skills)
   */
  export async function reload() {
    const system = await state()
    await system.reload()
    return system
  }
}
