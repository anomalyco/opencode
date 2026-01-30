import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { HTTPException } from "hono/http-exception"
import { eq, and, desc } from "drizzle-orm"
import { nanoid } from "nanoid"
import { db, schema } from "../../db/client"
import { authMiddleware } from "../../auth/middleware"
import { config } from "../../config"
import * as fs from "fs/promises"
import * as path from "path"

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  repositoryUrl: z.string().url().optional(),
  defaultBranch: z.string().max(255).default("main"),
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  repositoryUrl: z.string().url().optional(),
  defaultBranch: z.string().max(255).optional(),
})

export function ProjectRoutes() {
  return new Hono()
    .use(authMiddleware)

    // List projects
    .get("/", async (c) => {
      const { userId } = c.get("user")

      const projects = await db.query.projects.findMany({
        where: eq(schema.projects.userId, userId),
        orderBy: desc(schema.projects.updatedAt),
      })

      return c.json({ projects })
    })

    // Create project
    .post("/", zValidator("json", createProjectSchema), async (c) => {
      const { userId } = c.get("user")
      const data = c.req.valid("json")

      // Create workspace volume directory
      const volumeId = nanoid(12)
      const workspaceVolume = path.join(config.WORKSPACE_BASE_PATH, userId, volumeId)

      try {
        await fs.mkdir(workspaceVolume, { recursive: true })
      } catch (error) {
        console.error("Failed to create workspace directory:", error)
        throw new HTTPException(500, { message: "Failed to create workspace" })
      }

      const [project] = await db
        .insert(schema.projects)
        .values({
          userId,
          name: data.name,
          description: data.description,
          repositoryUrl: data.repositoryUrl,
          defaultBranch: data.defaultBranch,
          workspaceVolume,
        })
        .returning()

      return c.json({ project }, 201)
    })

    // Get project by ID
    .get("/:id", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      return c.json({ project })
    })

    // Update project
    .put("/:id", zValidator("json", updateProjectSchema), async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")
      const data = c.req.valid("json")

      const [project] = await db
        .update(schema.projects)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
        .returning()

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      return c.json({ project })
    })

    // Delete project
    .delete("/:id", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      // Get project first to get workspace volume
      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      // Delete project from database (cascades to sessions)
      await db
        .delete(schema.projects)
        .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))

      // Clean up workspace volume (async, don't wait)
      if (project.workspaceVolume) {
        fs.rm(project.workspaceVolume, { recursive: true, force: true }).catch((error) => {
          console.error("Failed to delete workspace:", error)
        })
      }

      return c.json({ success: true })
    })

    // Clone repository to project workspace
    .post("/:id/clone", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.repositoryUrl) {
        throw new HTTPException(400, { message: "Project has no repository URL" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      // Clone repository using git
      const proc = Bun.spawn(
        ["git", "clone", "--branch", project.defaultBranch ?? "main", project.repositoryUrl, "."],
        {
          cwd: project.workspaceVolume,
          stdout: "pipe",
          stderr: "pipe",
        }
      )

      const exitCode = await proc.exited

      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text()
        throw new HTTPException(500, { message: `Git clone failed: ${stderr}` })
      }

      return c.json({ success: true, message: "Repository cloned successfully" })
    })
}
