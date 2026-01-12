import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import z from "zod"
import * as fs from "fs/promises"
import * as path from "path"

export namespace Plan {
  const log = Log.create({ service: "plan" })

  /** Directory where plan files are stored (global, not project-local) */
  export const DIR = path.join(Global.Path.data, "plan")

  export const Status = z.enum(["draft", "pending_review", "approved", "rejected"])
  export type Status = z.infer<typeof Status>

  export const Info = z
    .object({
      id: Identifier.schema("plan"),
      sessionID: Identifier.schema("session"),
      filePath: z.string(), // Absolute path, e.g., "/home/user/.local/share/opencode/plan/{sessionID}.md"
      status: Status,
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
    })
    .meta({
      ref: "PlanInfo",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: BusEvent.define("plan.created", z.object({ info: Info })),
    Updated: BusEvent.define("plan.updated", z.object({ info: Info })),
    StatusChanged: BusEvent.define(
      "plan.status.changed",
      z.object({
        planID: z.string(),
        sessionID: z.string(),
        status: Status,
      }),
    ),
  }

  /**
   * Get the plan file path for a session.
   * Uses the session ID to create a unique, session-scoped file path.
   * Returns the absolute path in the global plan directory.
   */
  export function getFilePath(sessionID: string): string {
    return path.join(DIR, `${sessionID}.md`)
  }

  /**
   * Get existing plan or create a new one for the session.
   */
  export async function getOrCreate(sessionID: string): Promise<Info> {
    try {
      return await get(sessionID)
    } catch (e) {
      if (Storage.NotFoundError.isInstance(e)) {
        return create(sessionID)
      }
      throw e
    }
  }

  /**
   * Create a new plan for a session.
   */
  export async function create(sessionID: string): Promise<Info> {
    const id = Identifier.ascending("plan")
    const filePath = getFilePath(sessionID)
    const now = Date.now()

    const info: Info = {
      id,
      sessionID,
      filePath,
      status: "draft",
      time: {
        created: now,
        updated: now,
      },
    }

    await Storage.write(["plan", sessionID], info)
    log.info("created", { id, sessionID, filePath })
    Bus.publish(Event.Created, { info })

    return info
  }

  /**
   * Get the plan for a session.
   */
  export async function get(sessionID: string): Promise<Info> {
    return Storage.read<Info>(["plan", sessionID])
  }

  /**
   * Update plan info.
   */
  export async function update(sessionID: string, updates: Partial<Pick<Info, "status">>): Promise<Info> {
    const info = await get(sessionID)
    const updated: Info = {
      ...info,
      ...updates,
      time: {
        ...info.time,
        updated: Date.now(),
      },
    }

    await Storage.write(["plan", sessionID], updated)
    log.info("updated", { id: info.id, sessionID, updates })
    Bus.publish(Event.Updated, { info: updated })

    return updated
  }

  /**
   * Set the status of a plan.
   */
  export async function setStatus(sessionID: string, status: Status): Promise<Info> {
    const info = await update(sessionID, { status })

    log.info("status changed", { id: info.id, sessionID, status })
    Bus.publish(Event.StatusChanged, {
      planID: info.id,
      sessionID,
      status,
    })

    return info
  }

  /**
   * Read the content of a plan file.
   * Returns null if the file doesn't exist.
   */
  export async function readContent(sessionID: string): Promise<string | null> {
    const filePath = getFilePath(sessionID)
    try {
      return await fs.readFile(filePath, "utf-8")
    } catch (e: any) {
      if (e.code === "ENOENT") {
        return null
      }
      throw e
    }
  }

  /**
   * Ensure the plan directory exists.
   */
  export async function ensureDirectory(): Promise<void> {
    await fs.mkdir(DIR, { recursive: true })
  }

  /**
   * Check if a plan exists for a session.
   */
  export async function exists(sessionID: string): Promise<boolean> {
    try {
      await get(sessionID)
      return true
    } catch (e) {
      if (Storage.NotFoundError.isInstance(e)) {
        return false
      }
      throw e
    }
  }

  /**
   * Delete a plan (storage only, does not delete the file).
   */
  export async function remove(sessionID: string): Promise<void> {
    await Storage.remove(["plan", sessionID])
    log.info("removed", { sessionID })
  }

  /**
   * Delete a plan completely (both storage and file).
   */
  export async function deletePlan(sessionID: string): Promise<void> {
    const filePath = getFilePath(sessionID)
    await fs.unlink(filePath).catch(() => {})
    await Storage.remove(["plan", sessionID]).catch(() => {})
    log.info("deleted", { sessionID, filePath })
  }

  /**
   * Write content to a plan file.
   * Also ensures the plan exists in storage.
   */
  export async function writeContent(sessionID: string, content: string): Promise<void> {
    await ensureDirectory()
    const filePath = getFilePath(sessionID)
    await fs.writeFile(filePath, content, "utf-8")

    // Ensure plan exists in storage
    try {
      await get(sessionID)
    } catch (e) {
      if (Storage.NotFoundError.isInstance(e)) {
        await create(sessionID)
      } else {
        throw e
      }
    }

    log.info("wrote content", { sessionID, filePath, length: content.length })
  }
}
