import { Log } from "../util/log"
import { $ } from "bun"
import { Config } from "../config/config"

export namespace Checkpoint {
  const log = Log.create({ service: "checkpoint" })

  let ENABLED = false

  /**
   * Load configuration
   */
  async function loadConfig() {
    const config = await Config.get()
    ENABLED = config.safety?.checkpoints?.enabled ?? false

    log.info("config loaded", { enabled: ENABLED })
  }

  loadConfig().catch((err) => {
    log.error("failed to load config, using defaults", { error: err })
  })

  /**
   * Create a checkpoint at current state
   */
  export async function create(input: { sessionID: string; message: string }) {
    if (!ENABLED) return null

    try {
      // Check if in git repo
      const isRepo = await $`git rev-parse --git-dir`
        .quiet()
        .nothrow()
        .then(() => true)
        .catch(() => false)

      if (!isRepo) {
        log.warn("not a git repository, skipping checkpoint")
        return null
      }

      // Create checkpoint branch name
      const branchName = `checkpoint/${input.sessionID}/${Date.now()}`

      // Stash current changes
      await $`git add -A`.quiet()
      const stashResult = await $`git stash push -m "Checkpoint: ${input.message}"`.quiet().text()

      // Create checkpoint branch from stash
      if (stashResult.includes("No local changes")) {
        log.info("no changes to checkpoint")
        return null
      }

      const commit = await $`git rev-parse stash@{0}`
        .quiet()
        .text()
        .then((s) => s.trim())

      // Create lightweight tag for checkpoint
      const tagName = `checkpoint-${input.sessionID}-${Date.now()}`
      await $`git tag ${tagName} ${commit}`.quiet()

      // Pop the stash to restore working directory
      await $`git stash pop`.quiet()

      log.info("checkpoint created", {
        sessionID: input.sessionID,
        tag: tagName,
        commit: commit.slice(0, 8),
      })

      return {
        tag: tagName,
        commit,
        message: input.message,
        timestamp: Date.now(),
      }
    } catch (error) {
      log.error("failed to create checkpoint", { error })
      return null
    }
  }

  /**
   * List all checkpoints for a session
   */
  export async function list(sessionID: string) {
    if (!ENABLED) return []

    try {
      const tags = await $`git tag -l "checkpoint-${sessionID}-*"`.quiet().text()

      return tags
        .split("\n")
        .filter(Boolean)
        .map((tag) => {
          const timestamp = parseInt(tag.split("-").pop() || "0")
          return { tag, timestamp }
        })
        .sort((a, b) => b.timestamp - a.timestamp)
    } catch (error) {
      log.error("failed to list checkpoints", { error })
      return []
    }
  }

  /**
   * Restore to a checkpoint
   */
  export async function restore(tag: string) {
    if (!ENABLED) {
      throw new Error("Checkpoints not enabled")
    }

    try {
      // Stash current changes
      await $`git add -A`.quiet()
      await $`git stash`.quiet()

      // Checkout the checkpoint tag
      await $`git checkout ${tag}`.quiet()

      log.info("checkpoint restored", { tag })

      return { success: true, tag }
    } catch (error) {
      log.error("failed to restore checkpoint", { error })
      throw error
    }
  }

  /**
   * Delete old checkpoints
   */
  export async function cleanup(sessionID: string, keepLast = 10) {
    if (!ENABLED) return

    try {
      const checkpoints = await list(sessionID)

      // Keep only the last N checkpoints
      const toDelete = checkpoints.slice(keepLast)

      for (const checkpoint of toDelete) {
        await $`git tag -d ${checkpoint.tag}`.quiet()
        log.info("checkpoint deleted", { tag: checkpoint.tag })
      }
    } catch (error) {
      log.error("failed to cleanup checkpoints", { error })
    }
  }

  /**
   * Auto-checkpoint before risky operations
   */
  export async function autoCheckpoint(input: { sessionID: string; operation: string }) {
    if (!ENABLED) return null

    return create({
      sessionID: input.sessionID,
      message: `Auto checkpoint before: ${input.operation}`,
    })
  }

  /**
   * Reload configuration (useful for testing and hot-reloading)
   */
  export async function reloadConfig() {
    await loadConfig()
  }

  /**
   * Manually set enabled flag (for testing)
   */
  export function setEnabled(enabled: boolean) {
    ENABLED = enabled
    log.info("manually set enabled", { enabled: ENABLED })
  }
}
