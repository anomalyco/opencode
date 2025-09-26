import { Reminder } from "./reminder"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import { Bus } from "../bus"

import { Session } from "../session"

import { Permission } from "../permission"

export namespace ReminderManager {
  const log = Log.create({ service: "reminder.manager" })

  // Project-scoped state using existing Instance.state pattern
  const state = Instance.state(
    () => ({
      reminders: new Map<string, Reminder.Info>(),
      timers: new Map<string, NodeJS.Timeout>(),
    }),
    async (state) => {
      // Cleanup all timers on disposal
      for (const timer of state.timers.values()) {
        clearTimeout(timer)
      }
    },
  )

  export async function schedule(reminder: Reminder.Info): Promise<void> {
    const projectState = await state()

    // Store reminder in memory and persist to storage
    projectState.reminders.set(reminder.id, reminder)
    await Storage.write(["reminder", Instance.project.id, reminder.id], reminder)

    // Schedule timer
    await scheduleTimer(reminder)

    Bus.publish(Reminder.Event.Created, { info: reminder })
    log.info("scheduled reminder", {
      id: reminder.id,
      type: reminder.type,
      interval: reminder.interval,
      sessionID: reminder.sessionID,
    })
  }

  export async function cancel(reminderID: string): Promise<boolean> {
    const projectState = await state()
    const reminder = projectState.reminders.get(reminderID)

    if (!reminder) return false

    // Clear timer if exists
    const timer = projectState.timers.get(reminderID)
    if (timer) {
      clearTimeout(timer)
      projectState.timers.delete(reminderID)
    }

    // Update status and clean up
    reminder.status = "cancelled"
    projectState.reminders.delete(reminderID)
    await Storage.remove(["reminder", Instance.project.id, reminderID])

    Bus.publish(Reminder.Event.Cancelled, { info: reminder })
    log.info("cancelled reminder", { id: reminderID })

    return true
  }

  export async function list(sessionID?: string): Promise<Reminder.Info[]> {
    const projectState = await state()
    const reminders = Array.from(projectState.reminders.values())

    if (sessionID) {
      return reminders.filter((r) => r.sessionID === sessionID && r.status === "active")
    }

    return reminders.filter((r) => r.status === "active")
  }

  export async function execute(reminderID: string): Promise<void> {
    const projectState = await state()
    const reminder = projectState.reminders.get(reminderID)

    if (!reminder || reminder.status !== "active") {
      log.warn("attempted to execute non-active reminder", { id: reminderID })
      return
    }

    try {
      // Check if session is currently active (not busy/pending)
      const { SessionPrompt } = await import("../session/prompt")
      const isCurrentSession = !SessionPrompt.isBusy(reminder.sessionID)

      if (!isCurrentSession) {
        log.info("reminder cancelled: session not current", {
          reminderID,
          sessionID: reminder.sessionID,
        })

        // For non-current sessions, cancel the reminder but continue if recurring
        if (reminder.type === "recurring") {
          // Reschedule for next time
          reminder.time.nextExecution = Date.now() + reminder.interval
          await scheduleTimer(reminder)
          log.info("recurring reminder rescheduled", { reminderID })
        } else {
          // Cancel one-time reminders
          await cancel(reminderID)
        }
        return
      }

      // Post reminder message as agent message to originating session
      await SessionPrompt.prompt({
        sessionID: reminder.sessionID,
        messageID: Identifier.ascending("message"),
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text: reminder.originalPrompt,
          },
        ],
      })

      // Update execution tracking
      reminder.time.lastExecution = Date.now()
      await Storage.write(["reminder", Instance.project.id, reminder.id], reminder)

      if (reminder.type === "recurring") {
        // Schedule next execution
        reminder.time.nextExecution = Date.now() + reminder.interval
        await scheduleTimer(reminder)
        log.info("recurring reminder executed and rescheduled", { reminderID })
      } else {
        // Remove one-time reminder
        await cancel(reminder.id)
        log.info("one-time reminder executed and removed", { reminderID })
      }

      Bus.publish(Reminder.Event.Executed, { info: reminder })
    } catch (error) {
      log.error("reminder execution failed", {
        reminderID,
        error: error instanceof Error ? error.message : String(error),
      })

      // If permission was rejected and session is not current, cancel reminder
      if (error instanceof Permission.RejectedError) {
        if (reminder.type === "recurring") {
          // Reschedule recurring reminders even if permission denied
          reminder.time.nextExecution = Date.now() + reminder.interval
          await scheduleTimer(reminder)
          log.info("recurring reminder permission denied, rescheduled", { reminderID })
        } else {
          // Cancel one-time reminders on permission denial
          await cancel(reminderID)
          log.info("one-time reminder cancelled due to permission denial", { reminderID })
        }
      } else {
        // For other errors, cancel the reminder
        await cancel(reminderID)
        log.error("reminder cancelled due to execution error", { reminderID, error })
      }
    }
  }

  async function scheduleTimer(reminder: Reminder.Info): Promise<void> {
    const projectState = await state()

    // Clear existing timer if any
    const existingTimer = projectState.timers.get(reminder.id)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const delay = Math.max(0, reminder.time.nextExecution - Date.now())
    const timer = setTimeout(async () => {
      projectState.timers.delete(reminder.id)
      await execute(reminder.id)
    }, delay)

    projectState.timers.set(reminder.id, timer)
    log.debug("timer scheduled", {
      reminderID: reminder.id,
      delay,
      nextExecution: new Date(reminder.time.nextExecution).toISOString(),
    })
  }

  export function init() {
    log.info("init")

    // Subscribe to session deletion events for cleanup
    Bus.subscribe(Session.Event.Deleted, async ({ properties }) => {
      await cleanupSession(properties.info.id)
    })

    // Initialize reminders from storage asynchronously
    Storage.list(["reminder", Instance.project.id])
      .then(async (reminderKeys) => {
        const projectState = await state()
        let restoredCount = 0
        let cancelledCount = 0
        let healthyCount = 0

        for (const key of reminderKeys) {
          try {
            const reminder = await Storage.read<Reminder.Info>(key)
            if (reminder && reminder.status === "active") {
              projectState.reminders.set(reminder.id, reminder)

              // Validate session still exists
              try {
                const session = await Session.get(reminder.sessionID)
                if (!session) {
                  await cancel(reminder.id)
                  cancelledCount++
                  log.info("cancelled reminder: session no longer exists", {
                    id: reminder.id,
                    sessionID: reminder.sessionID,
                  })
                  continue
                }
              } catch (error) {
                await cancel(reminder.id)
                cancelledCount++
                log.info("cancelled reminder: session validation failed", {
                  id: reminder.id,
                  error: error instanceof Error ? error.message : String(error),
                })
                continue
              }

              // Only reschedule if not expired by too much (1 hour grace period)
              const now = Date.now()
              const gracePeriod = 60 * 60 * 1000 // 1 hour

              if (reminder.time.nextExecution + gracePeriod > now) {
                await scheduleTimer(reminder)

                // Validate timer was actually created
                const isHealthy = projectState.timers.has(reminder.id)
                if (isHealthy) {
                  restoredCount++
                  healthyCount++
                  log.info("restored and validated reminder from storage", { id: reminder.id })
                } else {
                  await cancel(reminder.id)
                  cancelledCount++
                  log.warn("timer restoration failed, cancelled reminder", { id: reminder.id })
                }
              } else {
                // Remove expired reminders
                await cancel(reminder.id)
                cancelledCount++
                log.info("removed expired reminder", { id: reminder.id })
              }
            }
          } catch (error) {
            cancelledCount++
            log.warn("failed to restore reminder", { key, error })
            await Storage.remove(key)
          }
        }

        log.info("timer persistence validation completed", {
          total: reminderKeys.length,
          restored: restoredCount,
          cancelled: cancelledCount,
          healthy: healthyCount,
        })
      })
      .catch((error) => {
        log.warn("failed to initialize reminders", { error })
      })
  }

  // Clean up reminders for a deleted session
  export async function cleanupSession(sessionID: string): Promise<void> {
    const reminders = await list(sessionID)

    for (const reminder of reminders) {
      await cancel(reminder.id)
    }

    log.info("cleaned up reminders for deleted session", {
      sessionID,
      count: reminders.length,
    })
  }
}
