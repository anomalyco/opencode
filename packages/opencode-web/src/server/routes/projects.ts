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
import {
  SkillService,
  ToolService,
  AgentService,
  ConfigService,
  ProviderService,
  VcsService,
  CommandService,
  getProjectInfo,
} from "../../opencode"

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

    // ==========================================
    // OpenCode Integration Endpoints
    // ==========================================

    // Get project info (comprehensive)
    .get("/:id/info", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const info = await getProjectInfo(project.workspaceVolume)
        return c.json({ project, ...info })
      } catch (error) {
        console.error("Failed to get project info:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to get project info",
        })
      }
    })

    // List skills
    .get("/:id/skills", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const skills = await SkillService.list(project.workspaceVolume)
        return c.json({ skills })
      } catch (error) {
        console.error("Failed to list skills:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to list skills",
        })
      }
    })

    // Get specific skill
    .get("/:id/skills/:name", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")
      const skillName = c.req.param("name")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const skill = await SkillService.get(project.workspaceVolume, skillName)
        if (!skill) {
          throw new HTTPException(404, { message: "Skill not found" })
        }
        return c.json({ skill })
      } catch (error) {
        if (error instanceof HTTPException) throw error
        console.error("Failed to get skill:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to get skill",
        })
      }
    })

    // List tools
    .get("/:id/tools", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const tools = await ToolService.list(project.workspaceVolume)
        return c.json({ tools })
      } catch (error) {
        console.error("Failed to list tools:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to list tools",
        })
      }
    })

    // List tool IDs only
    .get("/:id/tools/ids", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const ids = await ToolService.listIds(project.workspaceVolume)
        return c.json({ tools: ids })
      } catch (error) {
        console.error("Failed to list tool IDs:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to list tool IDs",
        })
      }
    })

    // List agents
    .get("/:id/agents", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const agents = await AgentService.list(project.workspaceVolume)
        return c.json({ agents })
      } catch (error) {
        console.error("Failed to list agents:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to list agents",
        })
      }
    })

    // Get specific agent
    .get("/:id/agents/:name", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")
      const agentName = c.req.param("name")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const agent = await AgentService.get(project.workspaceVolume, agentName)
        if (!agent) {
          throw new HTTPException(404, { message: "Agent not found" })
        }
        return c.json({ agent })
      } catch (error) {
        if (error instanceof HTTPException) throw error
        console.error("Failed to get agent:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to get agent",
        })
      }
    })

    // Get default agent
    .get("/:id/agents/default", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const agent = await AgentService.getDefault(project.workspaceVolume)
        return c.json({ agent })
      } catch (error) {
        console.error("Failed to get default agent:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to get default agent",
        })
      }
    })

    // Get project config
    .get("/:id/config", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const config = await ConfigService.get(project.workspaceVolume)
        return c.json({ config })
      } catch (error) {
        console.error("Failed to get config:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to get config",
        })
      }
    })

    // Get config directories
    .get("/:id/config/directories", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const directories = await ConfigService.directories(project.workspaceVolume)
        return c.json({ directories })
      } catch (error) {
        console.error("Failed to get config directories:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to get config directories",
        })
      }
    })

    // List providers
    .get("/:id/providers", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const providers = await ProviderService.list(project.workspaceVolume)
        return c.json({ providers })
      } catch (error) {
        console.error("Failed to list providers:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to list providers",
        })
      }
    })

    // Get default model
    .get("/:id/providers/default-model", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const model = await ProviderService.getDefaultModel(project.workspaceVolume)
        return c.json({ model })
      } catch (error) {
        console.error("Failed to get default model:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to get default model",
        })
      }
    })

    // Get VCS info
    .get("/:id/vcs", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const branch = await VcsService.branch(project.workspaceVolume)
        return c.json({ vcs: { branch } })
      } catch (error) {
        console.error("Failed to get VCS info:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to get VCS info",
        })
      }
    })

    // List commands
    .get("/:id/commands", async (c) => {
      const { userId } = c.get("user")
      const projectId = c.req.param("id")

      const project = await db.query.projects.findFirst({
        where: and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
      })

      if (!project) {
        throw new HTTPException(404, { message: "Project not found" })
      }

      if (!project.workspaceVolume) {
        throw new HTTPException(400, { message: "Project has no workspace volume" })
      }

      try {
        const commands = await CommandService.list(project.workspaceVolume)
        return c.json({ commands })
      } catch (error) {
        console.error("Failed to list commands:", error)
        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : "Failed to list commands",
        })
      }
    })
}
