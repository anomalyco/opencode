import { Session } from "."
import { Log } from "../util/log"

/**
 * Task Hierarchy Management
 *
 * Production-grade hierarchical task orchestration system.
 * Manages parent-child relationships between sessions for complex workflows.
 * Enables context isolation and result passing between tasks.
 *
 * @module TaskHierarchy
 */
export namespace TaskHierarchy {
  const log = Log.create({ service: "task-hierarchy" })

  export type TaskStatus = "active" | "paused" | "completed" | "failed"

  export type OrchestrationState = {
    depth: number
    status: TaskStatus
    pausedMode?: string
    pausedAt?: number
    completedAt?: number
    result?: string
  }

  /**
   * Create a subtask with isolated session context
   *
   * Creates a child session linked to parent, initializes orchestration state,
   * and pauses the parent session until child completes.
   *
   * @param parentSessionID - Parent session identifier
   * @param agentName - Agent to use for subtask
   * @param title - Optional title for subtask session
   * @returns Child session ID
   */
  export async function createSubtask(parentSessionID: string, agentName: string, title?: string): Promise<string> {
    log.info("creating subtask", { parentSessionID, agentName, title })

    // Get parent session to determine depth
    const parent = await Session.get(parentSessionID)
    const parentDepth = parent.orchestration?.depth ?? 0
    const parentMode =
      parent.orchestration?.currentAgent ??
      parent.orchestration?.rootAgent ??
      parent.orchestration?.pausedMode

    // Create new session for child
    const childSession = await Session.create({
      title: title ?? `${agentName} subtask`,
      parentID: parentSessionID,
    })
    const childSessionID = childSession.id

    // Initialize orchestration state for child
    await Session.update(childSessionID, (draft: Session.Info) => {
      draft.orchestration = {
        depth: parentDepth + 1,
        status: "active" as TaskStatus,
      }
    })

    // Pause parent and store its current mode
    await Session.update(parentSessionID, (draft) => {
      if (!draft.orchestration) {
        draft.orchestration = {
          depth: parentDepth,
          status: "paused" as TaskStatus,
          pausedAt: Date.now(),
        }
      } else {
        draft.orchestration.status = "paused" as TaskStatus
        draft.orchestration.pausedAt = Date.now()
      }
      // Store mode for resumption if provided
      if (parentMode) draft.orchestration.pausedMode = parentMode
    })

    log.info("subtask created", {
      parentSessionID,
      childSessionID,
      depth: parentDepth + 1,
    })

    return childSessionID
  }

  /**
   * Complete a subtask and resume parent
   *
   * Marks child as completed, stores result, resumes parent session.
   * Parent can then process the result through normal message flow.
   *
   * @param childSessionID - Child session identifier
   * @param result - Result summary to pass to parent
   */
  export async function completeSubtask(childSessionID: string, result: string): Promise<void> {
    log.info("completing subtask", { childSessionID })

    const child = await Session.get(childSessionID)
    if (!child.parentID) {
      log.warn("attempted to complete root task", { childSessionID })
      throw new Error("Cannot complete root task - no parent session exists")
    }

    // Update child status with result
    await Session.update(childSessionID, (draft) => {
      if (!draft.orchestration) {
        draft.orchestration = {
          depth: 0,
          status: "completed" as TaskStatus,
          completedAt: Date.now(),
          result,
        }
      } else {
        draft.orchestration.status = "completed" as TaskStatus
        draft.orchestration.completedAt = Date.now()
        draft.orchestration.result = result
      }
    })

    // Resume parent and restore paused mode if it exists
    await Session.update(child.parentID, (draft) => {
      if (draft.orchestration) {
        draft.orchestration.status = "active" as TaskStatus
        // CRITICAL FIX: Restore the paused mode when resuming from subtask
        if (draft.orchestration.pausedMode) {
          draft.orchestration.currentAgent = draft.orchestration.pausedMode
          log.info("restored parent mode", {
            parentID: child.parentID,
            restoredMode: draft.orchestration.pausedMode,
          })
          draft.orchestration.pausedMode = undefined
        }
        // ENHANCEMENT: Store subtask result in parent for programmatic access
        if (!draft.orchestration.subtaskResults) {
          draft.orchestration.subtaskResults = []
        }
        draft.orchestration.subtaskResults.push({
          sessionID: childSessionID,
          summary: result.substring(0, 200), // First 200 chars as summary
          result,
          completedAt: Date.now(),
        })
      }
    })

    log.info("subtask completed", {
      childSessionID,
      parentSessionID: child.parentID,
      resultLength: result.length,
    })
  }

  /**
   * Fail a subtask and propagate error to parent
   *
   * Marks child as failed, stores error message, resumes parent.
   * Parent receives error info through orchestration state.
   *
   * @param childSessionID - Child session identifier
   * @param error - Error message or description
   */
  export async function failSubtask(childSessionID: string, error: string): Promise<void> {
    log.error("subtask failed", { childSessionID, error })

    const child = await Session.get(childSessionID)
    if (!child.parentID) {
      log.warn("attempted to fail root task", { childSessionID })
      return
    }

    // Update child status with error
    await Session.update(childSessionID, (draft) => {
      if (!draft.orchestration) {
        draft.orchestration = {
          depth: 0,
          status: "failed" as TaskStatus,
          result: `Error: ${error}`,
        }
      } else {
        draft.orchestration.status = "failed" as TaskStatus
        draft.orchestration.result = `Error: ${error}`
      }
    })

    // Resume parent (it will handle the failure) and restore paused mode
    await Session.update(child.parentID, (draft) => {
      if (draft.orchestration) {
        draft.orchestration.status = "active" as TaskStatus
        // CRITICAL FIX: Restore the paused mode when resuming after failure
        if (draft.orchestration.pausedMode) {
          draft.orchestration.currentAgent = draft.orchestration.pausedMode
          log.info("restored parent mode after failure", {
            parentID: child.parentID,
            restoredMode: draft.orchestration.pausedMode,
          })
          draft.orchestration.pausedMode = undefined
        }
      }
    })
  }

  /**
   * Get current task depth for a session
   *
   * @param sessionID - Session identifier
   * @returns Depth in task hierarchy (0 = root)
   */
  export async function getDepth(sessionID: string): Promise<number> {
    const session = await Session.get(sessionID)
    return session.orchestration?.depth ?? 0
  }

  /**
   * Check if session is a subtask
   *
   * @param sessionID - Session identifier
   * @returns True if session has a parent
   */
  export async function isSubtask(sessionID: string): Promise<boolean> {
    const session = await Session.get(sessionID)
    return !!session.parentID
  }

  /**
   * Get all ancestor session IDs
   *
   * Walks up the hierarchy from child to root, collecting all parent IDs.
   *
   * @param sessionID - Starting session identifier
   * @returns Array of ancestor IDs (immediate parent first, root last)
   */
  export async function getAncestors(sessionID: string): Promise<string[]> {
    const ancestors: string[] = []
    let currentID: string | undefined = sessionID

    while (currentID) {
      const session = await Session.get(currentID)
      if (session.parentID) {
        ancestors.push(session.parentID)
        currentID = session.parentID
      } else {
        break
      }
    }

    return ancestors
  }

  /**
   * Get orchestration state for a session
   *
   * @param sessionID - Session identifier
   * @returns Orchestration state or undefined if none
   */
  export async function getState(sessionID: string): Promise<OrchestrationState | undefined> {
    const session = await Session.get(sessionID)
    return session.orchestration
  }

  /**
   * Pause a session (for mode switching or subtask creation)
   *
   * @param sessionID - Session identifier
   * @param mode - Current mode to resume later
   */
  export async function pauseSession(sessionID: string, mode?: string): Promise<void> {
    await Session.update(sessionID, (draft) => {
      if (!draft.orchestration) {
        draft.orchestration = {
          depth: 0,
          status: "paused" as TaskStatus,
          pausedAt: Date.now(),
        }
      } else {
        draft.orchestration.status = "paused" as TaskStatus
        draft.orchestration.pausedAt = Date.now()
      }
      if (mode) {
        draft.orchestration.pausedMode = mode
      }
    })
  }

  /**
   * Resume a paused session
   *
   * @param sessionID - Session identifier
   * @returns Paused mode to resume (if any)
   */
  export async function resumeSession(sessionID: string): Promise<string | undefined> {
    const session = await Session.get(sessionID)
    const pausedMode = session.orchestration?.pausedMode

    await Session.update(sessionID, (draft) => {
      if (draft.orchestration) {
        draft.orchestration.status = "active" as TaskStatus
        draft.orchestration.pausedMode = undefined
        draft.orchestration.pausedAt = undefined
      }
    })

    return pausedMode
  }

  /**
   * Get all child sessions for a parent
   *
   * @param parentSessionID - Parent session identifier
   * @returns Array of child session info
   */
  export async function getChildren(parentSessionID: string): Promise<Session.Info[]> {
    return Session.children(parentSessionID)
  }
}
